import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeReports, currentSeasonId, nhlRefreshDue, fetchSeasonStats } from '../src/lib/nhlStats.js';
import { sameTeam } from '../src/lib/pickFeed.js';

// Trimmed rows in the shape NHL.com's stats service returns.
const skaters = [
  { playerId: 8478402, skaterFullName: 'Connor McDavid', positionCode: 'C', teamAbbrevs: 'EDM', gamesPlayed: 20, goals: 11, assists: 38, points: 49, ppPoints: 20, plusMinus: 25, shots: 55 },
  { playerId: 8477346, skaterFullName: 'MacKenzie Weegar', positionCode: 'D', teamAbbrevs: 'CGY', gamesPlayed: 19, goals: 2, assists: 6, points: 8, ppPoints: 1, plusMinus: -3, shots: 30 },
  { playerId: 8480000, skaterFullName: 'Traded Winger', positionCode: 'L', teamAbbrevs: 'TOR,EDM', gamesPlayed: 12, goals: 3, assists: 2, points: 5, ppPoints: 0, plusMinus: 1, shots: 21 },
];
const realtime = [
  { playerId: 8477346, blockedShots: 55 },
  { playerId: 8478402, blockedShots: 4 },
];
const goalies = [{ playerId: 8476932, goalieFullName: 'Anthony Stolarz', teamAbbrevs: 'TOR', gamesPlayed: 8, wins: 5, goalsAgainstAverage: 2.89702, saves: 208 }];

test('three reports become one row per player in the stats-import shape', () => {
  const rows = mergeReports({ skaters, realtime, goalies });
  const by = Object.fromEntries(rows.map((r) => [r.name, r]));
  assert.equal(rows.length, 4);
  assert.deepEqual(by['Connor McDavid'], {
    nhlId: 8478402, name: 'Connor McDavid', team: 'EDM', pos: 'C', gp: 20, g: 11, a: 38, p: 49, ppp: 20, plusMinus: 25, shots: 55, blocks: 4,
  });
  assert.equal(by['MacKenzie Weegar'].blocks, 55, 'blocks joined from the realtime report');
  assert.equal(by['Traded Winger'].pos, 'LW', 'NHL position letters become the app’s');
  assert.equal(by['Traded Winger'].team, 'EDM', 'the last team listed is his team now');
  assert.equal(by['Traded Winger'].blocks, null, 'missing from realtime: unknown, not zero');
  assert.deepEqual(by['Anthony Stolarz'], { nhlId: 8476932, name: 'Anthony Stolarz', team: 'TOR', pos: 'G', gp: 8, w: 5, gaa: 2.89702, saves: 208 });
});

test('the season id rolls over in September', () => {
  assert.equal(currentSeasonId(new Date(2026, 10, 14)), 20262027);
  assert.equal(currentSeasonId(new Date(2027, 2, 1)), 20262027);
  assert.equal(currentSeasonId(new Date(2027, 8, 1)), 20272028);
});

test('fetchSeasonStats asks for all three reports, every row, regular season only', async () => {
  const asked = [];
  const fake = async (url) => {
    asked.push(url);
    const data = url.includes('goalie/summary') ? goalies : url.includes('realtime') ? realtime : skaters;
    return { ok: true, json: async () => ({ data, total: data.length }) };
  };
  const { seasonId, rows } = await fetchSeasonStats({ seasonId: 20262027, fetchImpl: fake });
  assert.equal(seasonId, 20262027);
  assert.equal(rows.length, 4);
  assert.equal(asked.length, 3);
  for (const url of asked) {
    const q = new URL(url).searchParams;
    assert.equal(q.get('limit'), '-1');
    assert.equal(q.get('cayenneExp'), 'seasonId=20262027 and gameTypeId=2');
  }
});

test('a failed report surfaces as an error, not an empty league', async () => {
  const fake = async () => ({ ok: false, status: 503, statusText: 'Service Unavailable' });
  await assert.rejects(fetchSeasonStats({ seasonId: 20262027, fetchImpl: fake }), /503/);
});

test('the daily refresh runs once a day, after 6 a.m. local, unless switched off', () => {
  const tz = 'America/Toronto';
  // 11:00 UTC on Nov 14 is 6:00 in Toronto.
  const at = (iso) => new Date(iso);
  const season = (extra) => ({ autoNhl: true, statsSource: 'nhl', statsImportedAt: '2026-11-13T12:00:00Z', nhlError: null, ...extra });

  assert.equal(nhlRefreshDue({ now: at('2026-11-14T10:59:00Z'), timeZone: tz, season: season() }), false, 'before 6 a.m.');
  assert.equal(nhlRefreshDue({ now: at('2026-11-14T11:01:00Z'), timeZone: tz, season: season() }), true, 'after 6, last run yesterday');
  assert.equal(nhlRefreshDue({ now: at('2026-11-14T15:00:00Z'), timeZone: tz, season: season({ statsImportedAt: '2026-11-14T11:05:00Z' }) }), false, 'already ran today');
  assert.equal(
    nhlRefreshDue({ now: at('2026-11-14T15:00:00Z'), timeZone: tz, season: season({ statsSource: 'file', statsImportedAt: '2026-11-14T13:00:00Z' }) }),
    false,
    'a sheet imported today counts for today'
  );
  assert.equal(nhlRefreshDue({ now: at('2026-11-14T15:00:00Z'), timeZone: tz, season: season({ statsImportedAt: null }) }), true, 'never imported');
  assert.equal(nhlRefreshDue({ now: at('2026-11-14T15:00:00Z'), timeZone: tz, season: season({ autoNhl: false }) }), false, 'switched off');
  assert.equal(
    nhlRefreshDue({ now: at('2026-11-14T15:00:00Z'), timeZone: tz, season: season({ nhlError: { at: '2026-11-14T14:30:00Z' } }) }),
    false,
    'failed half an hour ago: wait'
  );
  assert.equal(
    nhlRefreshDue({ now: at('2026-11-14T15:00:00Z'), timeZone: tz, season: season({ nhlError: { at: '2026-11-14T13:30:00Z' } }) }),
    true,
    'failed over an hour ago: try again'
  );
});

test('team codes match across sources, including a traded player’s list', () => {
  assert.ok(sameTeam('TBL', 'TB'));
  assert.ok(sameTeam('T.B', 'TBL'));
  assert.ok(sameTeam('TOR,EDM', 'EDM'));
  assert.ok(sameTeam('NJ', 'TOR, NJD'));
  assert.ok(!sameTeam('TOR,EDM', 'CGY'));
  assert.ok(!sameTeam('', 'EDM'));
});
