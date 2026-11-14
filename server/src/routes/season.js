import { Router } from 'express';
import { db, getSetting, setSetting, logDebug } from '../db/index.js';
import { mapPlayerRow } from '../lib/mapPlayer.js';
import { normalizeName } from '../lib/pickFeed.js';
import { myTeamName } from '../lib/league.js';
import { parseStartingRosters } from '../lib/yahooRosters.js';
import { fetchSeasonStats } from '../lib/nhlStats.js';
import { buildSeason, makeMatcher, guessMyTeam, STAT_KEYS, SEASON_CATEGORIES } from '../lib/season.js';
import { buildTradeModel, scanTrades, targetTrades, sellList, mergeWeights, DEFAULT_WEIGHTS } from '../lib/trade.js';

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
      const out = { id: row.id, player_id: row.player_id, nhl_id: row.nhl_id, name: row.name, team: row.team, pos: row.pos };
      for (const [key, column] of Object.entries(STAT_COLUMNS)) out[key] = row[column];
      return out;
    });
}

function loadSeason() {
  const season = getSetting('season');
  const rosterRows = db.prepare('SELECT * FROM season_rosters').all();
  const teamNames = new Map();
  for (const r of rosterRows) teamNames.set(r.team_num, r.team_name);
  const statsRows = loadStats();
  const built = buildSeason({
    pool: loadPool(),
    rosterRows,
    statsRows,
    teamNames,
    myTeamNum: season.myTeamNum,
    aliases: aliasMap(),
  });
  return { season, statsCount: statsRows.length, ...built };
}

const CATEGORIES = SEASON_CATEGORIES.map(({ key, label, lowerIsBetter = false, decimals = 0 }) => ({ key, label, lowerIsBetter, decimals }));

seasonRouter.get('/', (req, res) => {
  const { season, statsCount, teams, players, benchWeight } = loadSeason();
  res.json({
    meta: {
      leagueId: season.leagueId,
      rosterDate: season.rosterDate,
      rostersImportedAt: season.rostersImportedAt,
      statsImportedAt: season.statsImportedAt,
      statsFile: season.statsFile,
      statsSource: season.statsSource,
      autoNhl: season.autoNhl,
      nhlError: season.nhlError,
      statsCount,
      myTeamNum: season.myTeamNum,
    },
    categories: CATEGORIES,
    benchWeight,
    teams,
    players,
  });
});

// The trade finder, weighed with whatever I've set in the trade settings.
// Without ?target it's the open scan across the league; with ?target=<player
// key> it's every package for that one player, plus the near misses.
seasonRouter.get('/trade', (req, res) => {
  const loaded = loadSeason();
  const { weights = {}, locked = [] } = getSetting('trade') ?? {};
  const base = { categories: CATEGORIES, weights: mergeWeights(weights), defaults: DEFAULT_WEIGHTS, locked };
  if (!loaded.teams.length) return res.json({ ...base, ready: false, reason: 'rosters' });
  if (!loaded.teams.some((t) => t.isMine)) return res.json({ ...base, ready: false, reason: 'myTeam' });

  const model = buildTradeModel(loaded, weights);
  const me = model.teams.find((t) => t.isMine);
  const teamName = new Map(model.teams.map((t) => [t.num, t.name]));
  // What the page needs to know about a player, and no more.
  const summary = (key) => {
    const p = model.players.get(key);
    return {
      key,
      name: p.name,
      pos: p.pos,
      team: p.team,
      slot: p.slot,
      status: p.status,
      adp: p.adp,
      owner: p.owner,
      ownerName: p.owner != null ? teamName.get(p.owner) : null,
      myValue: p.myValue,
      marketValue: p.marketValue,
      gap: p.gap,
      luck: p.luck,
    };
  };
  const side = (s) => ({ delta: s.delta, byCat: s.byCat, dropped: s.dropped.map(summary) });
  const proposal = (t) => ({
    shape: t.shape,
    team: { num: t.team, name: teamName.get(t.team) },
    give: t.give.map(summary),
    get: t.get.map(summary),
    me: side(t.me),
    them: side(t.them),
    accept: t.accept,
    premium: model.weights.premium,
    score: t.score,
    edge: t.edge,
    surplus: t.surplus,
    bench: t.bench,
  });

  const targetKey = typeof req.query.target === 'string' ? req.query.target : null;
  const target = targetKey ? model.players.get(targetKey) : null;
  const targetable = target && target.owner != null && target.owner !== me.num;
  const targetPos = targetable ? target.posList?.[0] ?? null : null;

  const body = {
    ...base,
    ready: true,
    meta: { rosterDate: loaded.season.rosterDate, statsImportedAt: loaded.season.statsImportedAt, statsCount: loaded.statsCount },
    me: { num: me.num, name: me.name, need: me.need, surplus: me.surplus, slots: model.slots },
    sell: sellList(model, { targetPos }).map((s) => ({
      ...summary(s.key),
      score: s.score,
      surplus: s.surplus,
      samePos: s.samePos,
      injured: s.injured,
      locked: locked.includes(s.key),
    })),
    // Everyone on another team, for targeted mode's search.
    targets: model.teams
      .filter((t) => !t.isMine)
      .flatMap((t) => [...t.active, ...t.inactive])
      .map((p) => ({ key: p.key, name: p.name, pos: p.pos, team: p.team, ownerName: teamName.get(p.owner) })),
  };

  if (targetKey) {
    if (!targetable) return res.json({ ...body, target: { key: targetKey, missing: true } });
    const found = targetTrades(model, targetKey, { locked });
    return res.json({
      ...body,
      target: { player: summary(targetKey), viable: found.viable.map(proposal), closest: found.closest.map(proposal) },
    });
  }
  res.json({ ...body, proposals: scanTrades(model, { locked }).map(proposal) });
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

// Replaces every actual-stats row with `rows` — a season-to-date snapshot,
// not a delta — whether they came from my sheet or from NHL.com. A row with
// an NHL ID links to the pool player carrying the same one; anyone else is
// matched by name.
function saveStats(rows, { fileName = null, source = 'file' } = {}) {
  const pool = loadPool();
  const byNhlId = new Map(pool.filter((p) => p.nhlId != null).map((p) => [Number(p.nhlId), p]));
  const match = makeMatcher(pool, aliasMap());
  const columns = ['player_id', 'nhl_id', 'name', 'team', 'pos', ...Object.values(STAT_COLUMNS)];
  const insert = db.prepare(`INSERT INTO season_stats (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`);
  const num = (v) => (v === '' || v == null || !Number.isFinite(Number(v)) ? null : Number(v));

  let matched = 0;
  let byId = 0;
  db.transaction(() => {
    db.exec('DELETE FROM season_stats');
    for (const r of rows) {
      const name = r.name.trim();
      const nhlId = num(r.nhlId);
      const idHit = nhlId != null ? byNhlId.get(nhlId) : null;
      const hit = idHit ?? match({ name, team: r.team, pos: r.pos });
      if (hit) matched += 1;
      if (idHit) byId += 1;
      const stats = STAT_KEYS.map((k) => num(r[k]));
      // Points is goals plus assists; a sheet that leaves it out still gets it.
      const pIdx = STAT_KEYS.indexOf('p');
      if (stats[pIdx] == null && num(r.g) != null && num(r.a) != null) stats[pIdx] = num(r.g) + num(r.a);
      insert.run(hit?.id ?? null, nhlId, name, r.team ?? null, r.pos ?? null, ...stats);
    }
  })();

  setSetting('season', { statsImportedAt: new Date().toISOString(), statsFile: fileName, statsSource: source });
  return { rows: rows.length, matched, byId };
}

// My actual-stats sheet, already mapped to fields by the client.
seasonRouter.post('/stats', (req, res) => {
  const rows = req.body?.rows;
  if (!Array.isArray(rows) || !rows.length) return res.status(400).json({ error: 'rows must be a non-empty array' });
  const named = rows.filter((r) => typeof r?.name === 'string' && r.name.trim());
  if (!named.length) return res.status(400).json({ error: 'no row has a player name' });

  const result = saveStats(named, { fileName: req.body.fileName ?? null, source: 'file' });
  logDebug(`Season stats imported: ${result.rows} players, ${result.matched} matched to my pool`, 'OK', 'app');
  res.json(result);
});

// Every NHL player's season so far, from NHL.com. Used by the Refresh button
// and by the daily refresh. A failure is kept in the season settings so the
// Players page can say why the numbers are stale.
export async function syncFromNhl({ reason = 'manual' } = {}) {
  try {
    const { seasonId, rows } = await fetchSeasonStats();
    if (!rows.length) throw new Error(`NHL.com has no regular-season stats for ${seasonId} yet`);
    const result = saveStats(rows, { fileName: 'NHL.com', source: 'nhl' });
    setSetting('season', { nhlError: null });
    logDebug(
      `NHL stats refreshed (${reason}): ${result.rows} players, ${result.matched} matched to my pool (${result.byId} by NHL ID)`,
      'OK',
      'app'
    );
    return { ok: true, seasonId, ...result };
  } catch (err) {
    setSetting('season', { nhlError: { message: err.message, at: new Date().toISOString() } });
    logDebug(`NHL stats refresh failed (${reason}): ${err.message}`, 'ERROR', 'app');
    return { ok: false, error: err.message };
  }
}

seasonRouter.post('/stats/nhl', async (req, res) => {
  const result = await syncFromNhl({ reason: 'manual' });
  res.status(result.ok ? 200 : 502).json(result);
});
