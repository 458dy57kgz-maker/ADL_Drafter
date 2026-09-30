import { Router } from 'express';
import { db, getSetting, setSetting, logDebug } from '../db/index.js';
import { mapPlayerRow } from '../lib/mapPlayer.js';
import { normalizeName } from '../lib/pickFeed.js';
import { myTeamName } from '../lib/league.js';
import { parseStartingRosters } from '../lib/yahooRosters.js';
import { buildSeason, makeMatcher, guessMyTeam, STAT_KEYS, SEASON_CATEGORIES } from '../lib/season.js';

// Season mode: Yahoo's rosters and my actual-stats sheet, joined to the
// draft pool. One read endpoint feeds all three season pages (War Room,
// Teams, Players) so they can never disagree about who owns whom.
export const seasonRouter = Router();

// camelCase stat key -> season_stats column
const STAT_COLUMNS = Object.fromEntries(STAT_KEYS.map((k) => [k, k === 'plusMinus' ? 'plus_minus' : k]));

function aliasMap() {
  const map = new Map();
  for (const row of db.prepare('SELECT from_name, to_name FROM name_aliases').all()) {
    map.set(normalizeName(row.from_name), row.to_name);
  }
  return map;
}

function loadPool() {
  const teamCount = getSetting('league').teamCount;
  return db
    .prepare('SELECT * FROM players ORDER BY overall_rank IS NULL, overall_rank ASC')
    .all()
    .map((row) => mapPlayerRow(row, teamCount));
}

function loadStats() {
  return db
    .prepare('SELECT * FROM season_stats ORDER BY id ASC')
    .all()
    .map((row) => {
      const out = { id: row.id, player_id: row.player_id, name: row.name, team: row.team, pos: row.pos };
      for (const [key, column] of Object.entries(STAT_COLUMNS)) out[key] = row[column];
      return out;
    });
}

seasonRouter.get('/', (req, res) => {
  const season = getSetting('season');
  const rosterRows = db.prepare('SELECT * FROM season_rosters').all();
  const teamNames = new Map();
  for (const r of rosterRows) teamNames.set(r.team_num, r.team_name);
  const statsRows = loadStats();

  const { teams, players, benchWeight } = buildSeason({
    pool: loadPool(),
    rosterRows,
    statsRows,
    teamNames,
    myTeamNum: season.myTeamNum,
    aliases: aliasMap(),
  });

  res.json({
    meta: {
      leagueId: season.leagueId,
      rosterDate: season.rosterDate,
      rostersImportedAt: season.rostersImportedAt,
      statsImportedAt: season.statsImportedAt,
      statsFile: season.statsFile,
      statsCount: statsRows.length,
      myTeamNum: season.myTeamNum,
    },
    categories: SEASON_CATEGORIES.map(({ key, label, lowerIsBetter = false, decimals = 0 }) => ({ key, label, lowerIsBetter, decimals })),
    benchWeight,
    teams,
    players,
  });
});

// The saved Starting Rosters page, posted as text. Replaces every roster.
seasonRouter.post('/rosters', (req, res) => {
  const html = req.body?.html;
  if (typeof html !== 'string' || !html.trim()) {
    return res.status(400).json({ error: 'Send the saved page as { html }.' });
  }

  let parsed;
  try {
    parsed = parseStartingRosters(html);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  const pool = loadPool();
  const match = makeMatcher(pool, aliasMap());
  const insert = db.prepare(
    `INSERT INTO season_rosters (team_num, team_name, seat, slot, player_id, yahoo_player_id, player_name, nhl_team, pos, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  const unmatched = [];
  let seats = 0;
  let rostered = 0;
  // Parsed teams with each seat's pool id, for guessing which team is mine.
  const matchedTeams = parsed.teams.map((t) => ({ num: t.num, name: t.name, rows: [] }));

  db.transaction(() => {
    db.exec('DELETE FROM season_rosters');
    parsed.teams.forEach((team, ti) => {
      team.rows.forEach((row, seat) => {
        const p = row.player;
        const hit = p ? match({ name: p.name, team: p.nhlTeam, pos: p.pos }) : null;
        insert.run(team.num, team.name, seat, row.slot, hit?.id ?? null, p?.yahooId ?? null, p?.name ?? null, p?.nhlTeam ?? null, p?.pos ?? null, p?.status ?? null);
        seats += 1;
        if (p) rostered += 1;
        if (p && !hit) unmatched.push(p.name);
        matchedTeams[ti].rows.push({ player: hit ? { id: hit.id } : null });
      });
    });
  })();

  // Which team is mine: kept if it's still in the league, otherwise the
  // one whose name matches my draft team, otherwise the one holding most
  // of the players I drafted.
  const season = getSetting('season');
  let myTeamNum = matchedTeams.some((t) => t.num === season.myTeamNum) ? season.myTeamNum : null;
  if (myTeamNum == null) {
    const draftName = normalizeName(myTeamName(getSetting('league')) ?? '');
    myTeamNum = (draftName && matchedTeams.find((t) => normalizeName(t.name) === draftName)?.num) || guessMyTeam(matchedTeams, pool);
  }

  setSetting('season', {
    leagueId: parsed.leagueId,
    rosterDate: parsed.rosterDate,
    rostersImportedAt: new Date().toISOString(),
    myTeamNum: myTeamNum ?? null,
  });
  logDebug(`Season rosters imported: ${parsed.teams.length} teams, ${rostered} players, ${unmatched.length} not in my pool`, 'OK', 'app');

  res.json({
    teams: parsed.teams.length,
    seats,
    rostered,
    matched: rostered - unmatched.length,
    unmatched,
    rosterDate: parsed.rosterDate,
    myTeamNum: myTeamNum ?? null,
  });
});

// My actual-stats sheet, already mapped to fields by the client. Replaces
// every row: a sheet is a season-to-date snapshot, not a delta.
seasonRouter.post('/stats', (req, res) => {
  const rows = req.body?.rows;
  if (!Array.isArray(rows) || !rows.length) return res.status(400).json({ error: 'rows must be a non-empty array' });
  const named = rows.filter((r) => typeof r?.name === 'string' && r.name.trim());
  if (!named.length) return res.status(400).json({ error: 'no row has a player name' });

  const match = makeMatcher(loadPool(), aliasMap());
  const columns = ['player_id', 'name', 'team', 'pos', ...Object.values(STAT_COLUMNS)];
  const insert = db.prepare(`INSERT INTO season_stats (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`);
  const num = (v) => (v === '' || v == null || !Number.isFinite(Number(v)) ? null : Number(v));

  let matched = 0;
  db.transaction(() => {
    db.exec('DELETE FROM season_stats');
    for (const r of named) {
      const name = r.name.trim();
      const hit = match({ name, team: r.team, pos: r.pos });
      if (hit) matched += 1;
      const stats = STAT_KEYS.map((k) => num(r[k]));
      // Points is goals plus assists; a sheet that leaves it out still gets it.
      const pIdx = STAT_KEYS.indexOf('p');
      if (stats[pIdx] == null && num(r.g) != null && num(r.a) != null) stats[pIdx] = num(r.g) + num(r.a);
      insert.run(hit?.id ?? null, name, r.team ?? null, r.pos ?? null, ...stats);
    }
  })();

  setSetting('season', { statsImportedAt: new Date().toISOString(), statsFile: req.body.fileName ?? null });
  logDebug(`Season stats imported: ${named.length} players, ${matched} matched to my pool`, 'OK', 'app');
  res.json({ rows: named.length, matched });
});
