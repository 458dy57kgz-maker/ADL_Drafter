// Season-to-date stats for every NHL player, straight from NHL.com's own
// stats service (api.nhle.com/stats/rest) — the API behind the tables on
// NHL.com. No key, no sign-in. Three reports cover all of the league's
// categories:
//
//   skater/summary   GP, G, A, P, PPP, shots, +/-, position, team
//   skater/realtime  blocked shots (joined to the summary on playerId)
//   goalie/summary   GP, W, saves, GAA
//
// `limit=-1` returns every player in one response, so the whole league is
// three requests. The service is unofficial and undocumented; if it ever
// changes shape, the error surfaces on the Players page and the CSV import
// still works.

const BASE = 'https://api.nhle.com/stats/rest/en';
const REGULAR_SEASON = 2;

// The NHL season that's running (or about to) on `date`: from September a
// new one, before that the one that started last autumn. 20262027 style.
export function currentSeasonId(date = new Date()) {
  const y = date.getFullYear();
  const start = date.getMonth() >= 8 ? y : y - 1;
  return Number(`${start}${start + 1}`);
}

function reportUrl(report, seasonId) {
  const params = new URLSearchParams({
    isAggregate: 'false',
    isGame: 'false',
    start: '0',
    limit: '-1',
    cayenneExp: `seasonId=${seasonId} and gameTypeId=${REGULAR_SEASON}`,
  });
  return `${BASE}/${report}?${params}`;
}

async function fetchReport(report, seasonId, fetchImpl) {
  const url = reportUrl(report, seasonId);
  const res = await fetchImpl(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`NHL ${report} answered ${res.status} ${res.statusText}`);
  const json = await res.json();
  if (!Array.isArray(json?.data)) throw new Error(`NHL ${report} came back without a data list`);
  return json.data;
}

// NHL's position letters, in the app's terms.
const POSITION = { C: 'C', L: 'LW', R: 'RW', D: 'D', G: 'G' };

// A traded player's teams come as "TOR,EDM", oldest first; the last is where
// he plays now.
function currentTeam(abbrevs) {
  const list = String(abbrevs ?? '')
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
  return list.length ? list[list.length - 1] : null;
}

/**
 * Three raw reports in, one row per player out, in the shape the stats
 * import takes ({ nhlId, name, team, pos, gp, g, a, p, ppp, plusMinus,
 * shots, blocks, w, gaa, saves }).
 */
export function mergeReports({ skaters = [], realtime = [], goalies = [] }) {
  const blocks = new Map(realtime.map((r) => [r.playerId, r.blockedShots]));
  const rows = skaters.map((s) => ({
    nhlId: s.playerId,
    name: s.skaterFullName,
    team: currentTeam(s.teamAbbrevs),
    pos: POSITION[s.positionCode] ?? s.positionCode ?? null,
    gp: s.gamesPlayed ?? null,
    g: s.goals ?? null,
    a: s.assists ?? null,
    p: s.points ?? null,
    ppp: s.ppPoints ?? null,
    plusMinus: s.plusMinus ?? null,
    shots: s.shots ?? null,
    blocks: blocks.get(s.playerId) ?? null,
  }));
  for (const g of goalies) {
    rows.push({
      nhlId: g.playerId,
      name: g.goalieFullName,
      team: currentTeam(g.teamAbbrevs),
      pos: 'G',
      gp: g.gamesPlayed ?? null,
      w: g.wins ?? null,
      gaa: g.goalsAgainstAverage ?? null,
      saves: g.saves ?? null,
    });
  }
  return rows.filter((r) => r.name && r.nhlId != null);
}

// The whole league's season so far. `fetchImpl` is only there for tests.
export async function fetchSeasonStats({ seasonId = currentSeasonId(), fetchImpl = fetch } = {}) {
  const [skaters, realtime, goalies] = await Promise.all([
    fetchReport('skater/summary', seasonId, fetchImpl),
    fetchReport('skater/realtime', seasonId, fetchImpl),
    fetchReport('goalie/summary', seasonId, fetchImpl),
  ]);
  return { seasonId, rows: mergeReports({ skaters, realtime, goalies }) };
}

// The calendar date and hour at `now` in `timeZone`, e.g. { date:
// '2026-11-14', hour: 6 }. The NAS may run in UTC; "6 a.m." means mine.
function localParts(now, timeZone) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' })
      .formatToParts(now)
      .map((p) => [p.type, p.value])
  );
  return { date: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) };
}

// Whether the daily refresh should run now: past `hour` local time, and no
// stats imported yet today — from NHL.com or from a sheet, so a sheet I
// imported this morning isn't overwritten until tomorrow. A failure waits an
// hour before trying again, so a down NHL.com isn't hit every few minutes.
export function nhlRefreshDue({ now = new Date(), timeZone = 'America/Toronto', hour = 6, season }) {
  if (!season?.autoNhl) return false;
  const today = localParts(now, timeZone);
  if (today.hour < hour) return false;
  const lastError = season.nhlError?.at ? new Date(season.nhlError.at) : null;
  if (lastError && now - lastError < 60 * 60 * 1000) return false;
  if (!season.statsImportedAt) return true;
  return localParts(new Date(season.statsImportedAt), timeZone).date !== today.date;
}
