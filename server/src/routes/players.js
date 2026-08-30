import { Router } from 'express';
import { db, logDebug } from '../db/index.js';
import { mapPlayerRow, normalizePosList } from '../lib/mapPlayer.js';

export const playersRouter = Router();

playersRouter.get('/', (req, res) => {
  const rows = db.prepare('SELECT * FROM players ORDER BY overall_rank ASC').all();
  res.json(rows.map(mapPlayerRow));
});

// Replaces the entire player pool (mock or otherwise) with an uploaded list —
// wipes any in-progress draft along with it, since picks reference players
// that are about to stop existing. Overall rank follows upload order (a
// rankings export is assumed sorted best-to-worst); positional rank is
// recomputed per position group from that same order, since a typical
// rankings CSV only carries one overall-rank column, not a per-position one.
playersRouter.post('/replace', (req, res) => {
  const { players } = req.body;
  if (!Array.isArray(players) || players.length === 0) {
    return res.status(400).json({ error: 'players array is required' });
  }
  // A real bulk export will often have a stray blank cell somewhere — skip
  // those rows rather than rejecting the whole upload over one bad row.
  const valid = players.filter((p) => p.name && p.pos);
  const skipped = players.length - valid.length;
  if (valid.length === 0) {
    return res.status(400).json({ error: 'no rows had both a name and a position after mapping' });
  }

  db.exec('DELETE FROM draft_picks; DELETE FROM players;');

  const insertPlayer = db.prepare(`
    INSERT INTO players
      (name, pos, team, rank, overall_rank, adp, tier, g, a, p, ppp, plus_minus, shots, w, gaa, saves, drafted, drafted_by, mine, tracked)
    VALUES
      (@name, @pos, @team, @rank, @overallRank, @adp, @tier, @g, @a, @p, @ppp, @plusMinus, @shots, @w, @gaa, @saves, 0, NULL, 0, 0)
  `);
  const insertMany = db.transaction((rows) => {
    // Every position a player is eligible for gets its own running rank
    // counter (a C/LW player advances both), but the single `rank` column
    // can only hold one number — it takes whichever position is listed
    // first in the cell (e.g. "C,LW" treats C as primary).
    const posCounters = {};
    rows.forEach((p, i) => {
      const posList = normalizePosList(p.pos);
      posList.forEach((pos) => {
        posCounters[pos] = (posCounters[pos] ?? 0) + 1;
      });
      insertPlayer.run({
        name: p.name,
        pos: posList.join(','),
        team: p.team || null,
        rank: posCounters[posList[0]] ?? null,
        overallRank: p.rank ?? i + 1,
        adp: p.adp ?? null,
        tier: p.tier ?? null,
        g: p.g ?? null,
        a: p.a ?? null,
        p: p.p ?? null,
        ppp: p.ppp ?? null,
        plusMinus: p.plusMinus ?? null,
        shots: p.shots ?? null,
        w: p.w ?? null,
        gaa: p.gaa ?? null,
        saves: p.saves ?? null,
      });
    });
  });
  insertMany(valid);

  logDebug(`Player pool replaced with ${valid.length} uploaded players (${skipped} skipped)`, 'OK', 'app');
  res.json({ playerCount: valid.length, skipped });
});

const PATCHABLE_FIELDS = { tier: 'tier', tracked: 'tracked' };

playersRouter.patch('/:id', (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM players WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'player not found' });

  const sets = [];
  const values = {};
  for (const [key, column] of Object.entries(PATCHABLE_FIELDS)) {
    if (key in req.body) {
      sets.push(`${column} = @${column}`);
      values[column] = typeof req.body[key] === 'boolean' ? (req.body[key] ? 1 : 0) : req.body[key];
    }
  }
  if (sets.length === 0) return res.status(400).json({ error: 'no patchable fields provided' });

  db.prepare(`UPDATE players SET ${sets.join(', ')} WHERE id = @id`).run({ ...values, id });
  const updated = db.prepare('SELECT * FROM players WHERE id = ?').get(id);
  logDebug(`Player ${updated.name} updated (${Object.keys(req.body).join(', ')})`, 'OK', 'app');
  res.json(mapPlayerRow(updated));
});
