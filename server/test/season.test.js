import test from 'node:test';
import assert from 'node:assert/strict';
import { parseStartingRosters, decodeEntities } from '../src/lib/yahooRosters.js';
import { buildSeason, makeMatcher, seatOrder, guessMyTeam, seasonTotals, rankTotals } from '../src/lib/season.js';
import { normalizePosList } from '../src/lib/mapPlayer.js';

// A cut-down Starting Rosters page with the same hooks Yahoo's has: the team
// link above each table, `Tst-team-N` table ids, the name link carrying
// data-ys-playerid, "TEAM - POS" under it, and the injury tag beside it.
function seat(slot, player) {
  if (!player) return `<tr class="odd"><td class="pos first">${slot}</td><td class="player last"><div>(Empty)</div></td></tr>`;
  const status = player.status
    ? `<span class="ysf-player-status Nowrap F-injury Fz-xxs"><span class="Pstart-sm" title="x">${player.status}</span></span>`
    : '';
  return `<tr class="even"><td class="pos first">${slot}</td><td class="player last">
    <img alt="${player.name}" src="x.png" />
    <a class="Nowrap name F-link playernote" href="https://sports.yahoo.com/nhl/players/${player.id}" data-ys-playerid="${player.id}" title="${player.name}">${player.name}</a>${status}
    <span class="D-b"><span class="Fz-xxs">${player.team} - ${player.pos}</span> </span>
  </td></tr>`;
}

function page(teams) {
  const tables = teams
    .map(
      (t) => `<div><p class="W-100"><a href="/hockey/18292/${t.num}">${t.name}</a> <a title="Propose Trade" href="/hockey/18292/proposetrade?stage=1&mid2=${t.num}">T</a></p>
      <table cellpadding="0" id="Tst-team-${t.num}" class="Table"><thead><tr><th class="pos first">Pos</th><th>Player</th></tr></thead>
      <tbody>${t.seats.join('')}</tbody></table></div>`
    )
    .join('');
  return `<html><body><li class="Navitem first Selected"><a class="Navtarget" href="/hockey/18292/startingrosters?date=2026-09-29" title="Current Date">Tue, Sep 29</a></li>${tables}</body></html>`;
}

const SAMPLE = page([
  {
    num: 1,
    name: 'Commillionaires',
    seats: [
      seat('C', { id: 5980, name: 'Nathan MacKinnon', team: 'COL', pos: 'C' }),
      seat('RW', null),
      seat('BN', { id: 7516, name: 'Nico Hischier', team: 'NJ', pos: 'C' }),
      seat('IR', { id: 6377, name: 'Kevin Fiala', team: 'LA', pos: 'LW', status: 'IR' }),
      seat('IR+', { id: 8653, name: 'Seth Jarvis', team: 'CAR', pos: 'LW,RW', status: 'IR-NR' }),
    ],
  },
  {
    num: 10,
    name: 'Mike&#39;s Mind-Blowing Team',
    seats: [seat('C', { id: 6369, name: 'Leon Draisaitl', team: 'EDM', pos: 'C,LW' })],
  },
]);

test('every team, every seat, IR and IR+ included', () => {
  const parsed = parseStartingRosters(SAMPLE);
  assert.equal(parsed.leagueId, '18292');
  assert.equal(parsed.rosterDate, '2026-09-29');
  assert.deepEqual(
    parsed.teams.map((t) => [t.num, t.name, t.rows.length]),
    [
      [1, 'Commillionaires', 5],
      [10, "Mike's Mind-Blowing Team", 1],
    ]
  );
  assert.deepEqual(
    parsed.teams[0].rows.map((r) => r.slot),
    ['C', 'RW', 'BN', 'IR', 'IR+']
  );
});

test('a seat carries the player, his NHL team, his positions and his injury tag', () => {
  const [team] = parseStartingRosters(SAMPLE).teams;
  assert.deepEqual(team.rows[0].player, { yahooId: '5980', name: 'Nathan MacKinnon', nhlTeam: 'COL', pos: 'C', status: null });
  assert.equal(team.rows[1].player, null, 'an empty seat is still a seat');
  assert.equal(team.rows[3].player.status, 'IR');
  assert.equal(team.rows[4].player.pos, 'LW,RW');
});

test('the wrong page is refused rather than read as ten empty teams', () => {
  assert.throws(() => parseStartingRosters('<html><body>Standings</body></html>'), /Starting Rosters/);
});

test('entities decode, named and numbered', () => {
  assert.equal(decodeEntities('Mike&#39;s &amp; Juraj Slafkovsk&#xfd;'), "Mike's & Juraj Slafkovský");
});

function poolPlayer(id, name, pos, team, extra = {}) {
  return { id, name, pos, posList: normalizePosList(pos), team, flag: null, overallRank: id, mine: false, g: 30, a: 40, p: 70, ...extra };
}

test('the matcher reads accents, full names and a shared name by team', () => {
  const pool = [
    poolPlayer(1, 'Juraj Slafkovsky', 'LW,RW', 'MTL'),
    poolPlayer(2, 'Sebastian Aho', 'C', 'CAR'),
    poolPlayer(3, 'Sebastian Aho', 'D', 'NYI'),
  ];
  const match = makeMatcher(pool);
  assert.equal(match({ name: 'Juraj Slafkovský', team: 'MTL', pos: 'LW,RW' })?.id, 1);
  assert.equal(match({ name: 'Sebastian Aho', team: 'NYI', pos: 'D' })?.id, 3);
  assert.equal(match({ name: 'Nobody Special', team: 'SJ', pos: 'C' }), null);
});

test('seats read starters, then bench, then the injury lists', () => {
  const seats = [
    { slot: 'IR', seat: 15 },
    { slot: 'BN', seat: 12 },
    { slot: 'C', seat: 0 },
    { slot: 'BN', seat: 17 },
    { slot: 'IR+', seat: 16 },
  ].sort(seatOrder);
  assert.deepEqual(
    seats.map((s) => s.slot + s.seat),
    ['C0', 'BN12', 'BN17', 'IR15', 'IR+16']
  );
});

function rosterRow(id, teamNum, seatNum, slot, playerId, name, pos) {
  return { id, team_num: teamNum, team_name: `T${teamNum}`, seat: seatNum, slot, player_id: playerId, yahoo_player_id: String(1000 + id), player_name: name, nhl_team: 'EDM', pos, status: null };
}

test('owners, unranked rostered players and stats-only free agents all land in one list', () => {
  const pool = [poolPlayer(1, 'Leon Draisaitl', 'C,LW', 'EDM'), poolPlayer(2, 'Evan Bouchard', 'D', 'EDM')];
  const rosterRows = [
    rosterRow(1, 10, 0, 'C', 1, 'Leon Draisaitl', 'C,LW'),
    rosterRow(2, 10, 1, 'BN', null, 'Unranked Guy', 'RW'),
  ];
  const statsRows = [
    { id: 1, player_id: 1, name: 'Leon Draisaitl', team: 'EDM', pos: 'C,LW', g: 5, a: 7, p: 12 },
    { id: 2, player_id: null, name: 'Unranked Guy', team: 'EDM', pos: 'RW', g: 1, a: 0, p: 1 },
    { id: 3, player_id: null, name: 'Waiver Wire', team: 'SJ', pos: 'C', g: 4, a: 4, p: 8 },
  ];
  const { players } = buildSeason({ pool, rosterRows, statsRows, teamNames: new Map([[10, 'Mike']]) });
  const byName = Object.fromEntries(players.map((p) => [p.name, p]));

  assert.equal(byName['Leon Draisaitl'].ownerName, 'Mike');
  assert.equal(byName['Leon Draisaitl'].act.p, 12);
  assert.equal(byName['Leon Draisaitl'].proj.p, 70);
  assert.equal(byName['Evan Bouchard'].owner, null, 'in my pool, on nobody’s roster');
  assert.equal(byName['Unranked Guy'].ownerName, 'Mike');
  assert.equal(byName['Unranked Guy'].act.g, 1, 'stats reach a rostered player I never ranked');
  assert.equal(byName['Waiver Wire'].owner, null);
  assert.equal(byName['Waiver Wire'].act.p, 8);
  assert.equal(players.length, 4);
});

test('actual totals skip IR; projected count the bench at the draft’s weight', () => {
  const pool = [
    poolPlayer(1, 'Starter One', 'C', 'EDM', { g: 40 }),
    poolPlayer(2, 'Bench Two', 'C', 'EDM', { g: 20 }),
    poolPlayer(3, 'Hurt Three', 'C', 'EDM', { g: 30 }),
  ];
  const rosterRows = [
    rosterRow(1, 1, 0, 'C', 1, 'Starter One', 'C'),
    rosterRow(2, 1, 1, 'BN', 2, 'Bench Two', 'C'),
    rosterRow(3, 1, 2, 'IR', 3, 'Hurt Three', 'C'),
  ];
  const statsRows = [
    { id: 1, player_id: 1, name: 'Starter One', g: 4 },
    { id: 2, player_id: 2, name: 'Bench Two', g: 2 },
    { id: 3, player_id: 3, name: 'Hurt Three', g: 3 },
  ];
  const { teams } = buildSeason({ pool, rosterRows, statsRows, teamNames: new Map([[1, 'Mine']]), myTeamNum: 1 });
  assert.equal(teams[0].isMine, true);
  assert.equal(teams[0].actual.g, 6, 'starter and bench in full, IR out');
  assert.equal(teams[0].projected.g, 55, '40 + 20 × 0.75, IR out');
  assert.deepEqual(
    teams[0].rows.map((r) => r.slot),
    ['C', 'BN', 'IR']
  );
});

test('category ranks share a place on a tie', () => {
  const pool = [poolPlayer(1, 'A One', 'C', 'X', { g: 10 }), poolPlayer(2, 'B Two', 'C', 'X', { g: 10 }), poolPlayer(3, 'C Three', 'C', 'X', { g: 5 })];
  const rosterRows = [rosterRow(1, 1, 0, 'C', 1, 'A One', 'C'), rosterRow(2, 2, 0, 'C', 2, 'B Two', 'C'), rosterRow(3, 3, 0, 'C', 3, 'C Three', 'C')];
  const { teams } = buildSeason({ pool, rosterRows, statsRows: [], teamNames: new Map([[1, 'a'], [2, 'b'], [3, 'c']]) });
  assert.deepEqual(
    teams.map((t) => t.projectedRanks.g),
    [1, 1, 3]
  );
});

test('season totals: points add up, GAA is the goalies’ average by games played', () => {
  const skater = { posList: ['C'], g: 10, a: 20, p: 30 };
  const starter = { posList: ['G'], gp: 30, gaa: 2.0, w: 18, saves: 800 };
  const backup = { posList: ['G'], gp: 10, gaa: 3.0, w: 4, saves: 250 };
  const idle = { posList: ['G'], gp: 0, gaa: 0, w: 0, saves: 0 };
  const totals = seasonTotals([skater, starter, backup, idle], []);
  assert.equal(totals.p, 30);
  assert.equal(totals.w, 22);
  assert.equal(totals.gaa, 2.25, '(2.0 × 30 + 3.0 × 10) / 40; the goalie with no games is left out');
  assert.equal(totals.g, 10, 'goalies never add to skater categories');

  const benched = seasonTotals([starter], [backup], 0.5);
  assert.equal(benched.gaa, (2.0 * 30 + 3.0 * 5) / 35, 'the bench weighs in at its weight');
  assert.equal(benched.saves, 925);

  assert.equal(seasonTotals([skater], []).gaa, null, 'no goalie, no GAA');
});

test('GAA ranks lowest first, and a team without one ranks last', () => {
  const teams = [
    { num: 1, actual: { gaa: 2.8 } },
    { num: 2, actual: { gaa: 2.1 } },
    { num: 3, actual: { gaa: null } },
    { num: 4, actual: { gaa: 2.1 } },
  ].map((t) => ({ ...t, actual: { g: 0, a: 0, p: 0, ppp: 0, shots: 0, blocks: 0, w: 0, saves: 0, ...t.actual } }));
  const ranks = rankTotals(teams, 'actual');
  assert.deepEqual(
    teams.map((t) => ranks[t.num].gaa),
    [3, 1, 4, 1]
  );
});

test('buildSeason totals carry points and a rounded GAA', () => {
  const pool = [
    poolPlayer(1, 'Skater One', 'C', 'EDM', { p: 70 }),
    poolPlayer(2, 'Goalie Two', 'G', 'EDM', { g: null, a: null, p: null, gp: 50, gaa: 2.456, w: 30 }),
  ];
  const rosterRows = [rosterRow(1, 1, 0, 'C', 1, 'Skater One', 'C'), rosterRow(2, 1, 1, 'G', 2, 'Goalie Two', 'G')];
  const statsRows = [{ id: 1, player_id: 2, name: 'Goalie Two', gp: 4, gaa: 3.14159, w: 2 }];
  const { teams } = buildSeason({ pool, rosterRows, statsRows, teamNames: new Map([[1, 'Mine']]) });
  assert.equal(teams[0].projected.p, 70);
  assert.equal(teams[0].projected.gaa, 2.46);
  assert.equal(teams[0].actual.gaa, 3.14);
  assert.equal(teams[0].actual.p, 0, 'no skater stats imported');
});

test('players carry ADP and the reputation profile from the pool', () => {
  const pool = [
    poolPlayer(1, 'With Profile', 'C', 'EDM', { adp: 12, g3y: 38.5, yown: 99, shsv: 1042 }),
    poolPlayer(2, 'Without', 'D', 'EDM'),
  ];
  const { players } = buildSeason({ pool, rosterRows: [], statsRows: [], teamNames: new Map() });
  const [a, b] = players;
  assert.equal(a.adp, 12);
  assert.equal(a.profile.g3y, 38.5);
  assert.equal(a.profile.shsv, 1042);
  assert.equal(a.profile.cIpp, null);
  assert.equal(b.profile, null, 'no sheet columns, no profile');
});

test('my team is the one holding most of the players I drafted', () => {
  const pool = [poolPlayer(1, 'A', 'C', 'X', { mine: true }), poolPlayer(2, 'B', 'C', 'X', { mine: true }), poolPlayer(3, 'C', 'C', 'X')];
  const teams = [
    { num: 4, rows: [{ player: { id: 3 } }, { player: { id: 1 } }] },
    { num: 7, rows: [{ player: { id: 1 } }, { player: { id: 2 } }, { player: null }] },
  ];
  assert.equal(guessMyTeam(teams, pool), 7);
  assert.equal(guessMyTeam([{ num: 1, rows: [{ player: { id: 3 } }] }], pool), null);
});
