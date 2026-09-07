import { Router } from 'express';
import { db, getSetting, logDebug } from '../db/index.js';
import { mapPlayerRow, normalizePosList } from '../lib/mapPlayer.js';
import { suggestClosestName } from '../lib/textMatch.js';

export const playersRouter = Router();

// DIFF is derived from the league's team count, so every read of a player
// has to carry it through — otherwise the column comes back null.
function teamCount() {
  return getSetting('league').teamCount;
}

// Fields the app degrades silently on rather than erroring, so the import has
// to say so out loud. `tier` and `adp` are what the Best Available board is
// built out of — no tier means empty T1/T2 pills and no talent cliff, no ADP
// means no wait-status chip at all. Blocks is a scoring category that lives
// almost entirely in defencemen. Goalies are excluded from the skater-stat
// denominators.
export function poolCoverage() {
  const rows = db.prepare('SELECT pos, blocks, vorp, gp, ong, tier, adp FROM players').all();
  const skaters = rows.filter((r) => !normalizePosList(r.pos).includes('G'));
  const pct = (n, d) => (d ? Math.round((n / d) * 100) : 100);
  const share = (key) => pct(rows.filter((r) => r[key] != null).length, rows.length);

  const blocks = pct(skaters.filter((r) => r.blocks != null).length, skaters.length);
  const coverage = {
    blocks,
    tier: share('tier'),
    adp: share('adp'),
    ong: share('ong'),
    gp: share('gp'),
    vorp: share('vorp'),
    skaters: skaters.length,
    players: rows.length,
  };

  const warnings = [];
  if (skaters.length && blocks < 90) {
    warnings.push(`Blocks are set on only ${blocks}% of skaters — blocks is a scoring category, and the totals are wrong without it.`);
  }
  if (rows.length && coverage.tier < 90) {
    warnings.push(`Tier is set on only ${coverage.tier}% of players — the board's T1/T2 counts and talent cliffs come from it, and it can only be set by you, in the import or the Players grid.`);
  }
  if (rows.length && coverage.adp < 90) {
    warnings.push(`ADP is set on only ${coverage.adp}% of players — without it a card can't say whether he'll last until your next pick.`);
  }
  return { ...coverage, warnings };
}

playersRouter.get('/', (req, res) => {
  const rows = db.prepare('SELECT * FROM players ORDER BY overall_rank ASC').all();
  const teams = teamCount();
  res.json(rows.map((row) => mapPlayerRow(row, teams)));
});

// --- Player list import ----------------------------------------------------
//
// One import covers all three cases, keyed on player name (case-insensitive,
// honouring the alias table): rows matching an existing player update it,
// rows that don't are added, and players absent from the file are offered
// for removal. That's why there's no separate "replace" vs "rankings
// overlay" import — "replace everything" is just this import with every
// existing player missing from the file.
//
// A field only overwrites when the file actually carries a value for it, so
// importing a file with just names and ranks won't blank out the stats
// already stored against those players.

const STAT_FIELDS = ['adp', 'tier', 'g', 'a', 'p', 'ppp', 'plusMinus', 'shots', 'blocks', 'ong', 'gp', 'vorp', 'w', 'gaa', 'saves'];
const COLUMN_FOR = { plusMinus: 'plus_minus' };

function loadMatchIndex() {
  const existing = db.prepare('SELECT id, name, drafted FROM players').all();
  const byName = new Map(existing.map((p) => [p.name.trim().toLowerCase(), p]));
  const aliases = db.prepare('SELECT from_name, to_name FROM name_aliases').all();
  // An alias maps a name as it appears in one source to the name stored
  // here, so an import spelling it differently updates the right player
  // instead of quietly creating a duplicate.
  for (const a of aliases) {
    const target = byName.get(String(a.to_name).trim().toLowerCase());
    if (target) byName.set(String(a.from_name).trim().toLowerCase(), target);
  }
  return { existing, byName };
}

function partition(rows) {
  const { existing, byName } = loadMatchIndex();
  const toUpdate = [];
  const toAdd = [];
  const matchedIds = new Set();
  const skipped = [];

  for (const row of rows) {
    const name = String(row.name ?? '').trim();
    if (!name) continue;
    const target = byName.get(name.toLowerCase());
    if (target) {
      matchedIds.add(target.id);
      toUpdate.push({ row, target });
    } else if (row.pos) {
      toAdd.push(row);
    } else {
      // Nothing to match and no position to create a record from.
      skipped.push(name);
    }
  }

  const missing = existing.filter((p) => !matchedIds.has(p.id));
  return { toAdd, toUpdate, missing, skipped };
}

// Positional rank can't be carried in from a file (one column can't hold a
// player's rank at C and at LW), so it's recomputed across the whole pool
// after any import, walking overall-rank order.
function recomputePositionalRanks() {
  const rows = db.prepare('SELECT id, pos FROM players ORDER BY overall_rank ASC, id ASC').all();
  const update = db.prepare('UPDATE players SET rank = ? WHERE id = ?');
  const counters = {};
  for (const row of rows) {
    const posList = normalizePosList(row.pos);
    for (const pos of posList) counters[pos] = (counters[pos] ?? 0) + 1;
    update.run(posList.length ? counters[posList[0]] : null, row.id);
  }
}

playersRouter.post('/import/preview', (req, res) => {
  const { players } = req.body;
  if (!Array.isArray(players) || players.length === 0) {
    return res.status(400).json({ error: 'players array is required' });
  }

  const { toAdd, toUpdate, missing, skipped } = partition(players);
  res.json({
    add: toAdd.length,
    update: toUpdate.length,
    skipped: skipped.length,
    missing: {
      count: missing.length,
      examples: missing.slice(0, 3).map((p) => p.name),
      draftedCount: missing.filter((p) => p.drafted).length,
    },
    coverage: poolCoverage(),
  });
});

playersRouter.post('/import', (req, res) => {
  const { players, removeMissing } = req.body;
  if (!Array.isArray(players) || players.length === 0) {
    return res.status(400).json({ error: 'players array is required' });
  }

  const { toAdd, toUpdate, missing, skipped } = partition(players);
  if (toAdd.length === 0 && toUpdate.length === 0) {
    return res.status(400).json({ error: 'no usable rows — new players need a name and a position' });
  }

  const insertPlayer = db.prepare(`
    INSERT INTO players
      (name, pos, team, rank, overall_rank, adp, tier, g, a, p, ppp, plus_minus, shots, blocks, ong, gp, vorp, w, gaa, saves, drafted, drafted_by, mine, tracked)
    VALUES
      (@name, @pos, @team, NULL, @overallRank, @adp, @tier, @g, @a, @p, @ppp, @plusMinus, @shots, @blocks, @ong, @gp, @vorp, @w, @gaa, @saves, 0, NULL, 0, 0)
  `);
  const deletePlayer = db.prepare('DELETE FROM players WHERE id = ?');
  const deletePicksFor = db.prepare('DELETE FROM draft_picks WHERE player_id = ?');
  const maxRank = db.prepare('SELECT COALESCE(MAX(overall_rank), 0) AS n FROM players').get().n;
  // Captured before the insert pass, so a freshly added name can't be
  // suggested as the near-match for itself.
  const existingNamesBefore = db.prepare('SELECT name FROM players').all().map((r) => r.name);

  const apply = db.transaction(() => {
    for (const { row, target } of toUpdate) {
      const sets = [];
      const values = { id: target.id };
      if (row.pos) {
        sets.push('pos = @pos');
        values.pos = normalizePosList(row.pos).join(',');
      }
      if (row.team) {
        sets.push('team = @team');
        values.team = row.team;
      }
      if (row.rank != null) {
        sets.push('overall_rank = @overallRank');
        values.overallRank = row.rank;
      }
      for (const field of STAT_FIELDS) {
        if (row[field] != null) {
          const column = COLUMN_FOR[field] ?? field;
          sets.push(`${column} = @${field}`);
          values[field] = row[field];
        }
      }
      if (sets.length) db.prepare(`UPDATE players SET ${sets.join(', ')} WHERE id = @id`).run(values);
    }

    toAdd.forEach((row, i) => {
      insertPlayer.run({
        name: String(row.name).trim(),
        pos: normalizePosList(row.pos).join(','),
        team: row.team || null,
        overallRank: row.rank ?? maxRank + i + 1,
        adp: row.adp ?? null,
        tier: row.tier ?? null,
        g: row.g ?? null,
        a: row.a ?? null,
        p: row.p ?? null,
        ppp: row.ppp ?? null,
        plusMinus: row.plusMinus ?? null,
        shots: row.shots ?? null,
        blocks: row.blocks ?? null,
        ong: row.ong ?? null,
        gp: row.gp ?? null,
        vorp: row.vorp ?? null,
        w: row.w ?? null,
        gaa: row.gaa ?? null,
        saves: row.saves ?? null,
      });
    });

    if (removeMissing) {
      for (const p of missing) {
        // Drop any pick referencing the player too, so the feed can't point
        // at a row that no longer exists.
        deletePicksFor.run(p.id);
        deletePlayer.run(p.id);
      }
    }

    recomputePositionalRanks();
  });
  apply();

  // A newly added name that closely resembles one already in the pool is
  // usually a spelling variant rather than a genuinely new player, and has
  // just become a duplicate. Flag those for review instead of blocking the
  // import — accepting one records an alias so the next import matches it.
  const priorNames = existingNamesBefore;
  const insertUnmatched = db.prepare('INSERT INTO unmatched_players (rankings_name, suggestion) VALUES (?, ?)');
  let flagged = 0;
  for (const row of toAdd) {
    const name = String(row.name).trim();
    const suggestion = suggestClosestName(name, priorNames);
    if (suggestion) {
      insertUnmatched.run(name, suggestion);
      flagged++;
    }
  }

  const removed = removeMissing ? missing.length : 0;
  logDebug(
    `Player import: ${toAdd.length} added, ${toUpdate.length} updated, ${removed} removed, ${skipped.length} skipped, ${flagged} flagged as possible duplicates`,
    'OK',
    'app'
  );
  const coverage = poolCoverage();
  for (const w of coverage.warnings) logDebug(w, 'WARN', 'app');
  res.json({ added: toAdd.length, updated: toUpdate.length, removed, skipped: skipped.length, flagged, coverage });
});

// Everything the Players grid lets you edit in place, so a small correction
// doesn't mean re-importing the whole file. `name` is deliberately absent —
// it's the key imports match on, so renaming here would quietly detach a
// player from every future import. `drafted`/`drafted_by`/`mine` are absent
// too: those are draft state, owned by the pick/undo/reset routes, and
// setting them directly would leave players and draft_picks disagreeing.
const PATCHABLE_FIELDS = {
  pos: 'pos',
  team: 'team',
  rank: 'rank',
  overallRank: 'overall_rank',
  adp: 'adp',
  tier: 'tier',
  g: 'g',
  a: 'a',
  p: 'p',
  ppp: 'ppp',
  plusMinus: 'plus_minus',
  shots: 'shots',
  blocks: 'blocks',
  ong: 'ong',
  gp: 'gp',
  vorp: 'vorp',
  w: 'w',
  gaa: 'gaa',
  saves: 'saves',
  tracked: 'tracked',
};

playersRouter.patch('/:id', (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM players WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'player not found' });

  const sets = [];
  const values = {};
  for (const [key, column] of Object.entries(PATCHABLE_FIELDS)) {
    if (key in req.body) {
      let value = req.body[key];
      if (typeof value === 'boolean') value = value ? 1 : 0;
      // Keep hand-typed positions in the same canonical shape the importer
      // writes, so "c/lw" still matches the C and LW lanes.
      if (key === 'pos') {
        const posList = normalizePosList(value);
        if (posList.length === 0) return res.status(400).json({ error: 'position cannot be empty' });
        value = posList.join(',');
      }
      sets.push(`${column} = @${column}`);
      values[column] = value;
    }
  }
  if (sets.length === 0) return res.status(400).json({ error: 'no patchable fields provided' });

  db.prepare(`UPDATE players SET ${sets.join(', ')} WHERE id = @id`).run({ ...values, id });
  const updated = db.prepare('SELECT * FROM players WHERE id = ?').get(id);
  logDebug(`Player ${updated.name} updated (${Object.keys(req.body).join(', ')})`, 'OK', 'app');
  res.json(mapPlayerRow(updated, teamCount()));
});
