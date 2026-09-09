import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeName,
  parseFeedName,
  matchPlayer,
  inferDraftOrder,
  planSync,
} from '../src/lib/pickFeed.js';

function pool(...specs) {
  return specs.map((s, i) => ({
    id: i + 1,
    name: s.name,
    team: s.team ?? null,
    pos: s.pos ?? 'C',
    posList: (s.pos ?? 'C').split(','),
  }));
}

// --- name normalising ----------------------------------------------------

test('normalizeName strips accents, punctuation and case', () => {
  assert.equal(normalizeName('J. Slafkovský'), 'j slafkovsky');
  assert.equal(normalizeName("T.J. Oshie"), 'tj oshie');
  assert.equal(normalizeName('  Cole   Caufield '), 'cole caufield');
});

test('parseFeedName splits an abbreviated and a full name the same way', () => {
  assert.deepEqual(parseFeedName('C. Caufield'), { initial: 'c', last: 'caufield', full: 'c caufield' });
  assert.deepEqual(parseFeedName('Cole Caufield'), { initial: 'c', last: 'caufield', full: 'cole caufield' });
});

test('parseFeedName keeps a compound surname whole and drops a suffix', () => {
  assert.equal(parseFeedName('T. van Riemsdyk').last, 'van riemsdyk');
  assert.equal(parseFeedName('B. Smith Jr.').last, 'smith');
});

// --- matching ------------------------------------------------------------

test('matchPlayer resolves an initial against a full-name pool', () => {
  const players = pool({ name: 'Cole Caufield', team: 'MTL', pos: 'LW,RW' });
  const m = matchPlayer({ player: 'C. Caufield', position: 'LW,RW', nhlTeam: 'MTL' }, players);
  assert.equal(m.player.name, 'Cole Caufield');
  assert.equal(m.confidence, 'exact');
});

test('matchPlayer uses the initial to separate two players sharing a surname', () => {
  // The real collision in the feed: both Thompsons went in the same draft.
  const players = pool(
    { name: 'Tage Thompson', team: 'BUF', pos: 'C,RW' },
    { name: 'Logan Thompson', team: 'WSH', pos: 'G' }
  );
  assert.equal(matchPlayer({ player: 'T. Thompson', nhlTeam: 'BUF', position: 'C,RW' }, players).player.name, 'Tage Thompson');
  assert.equal(matchPlayer({ player: 'L. Thompson', nhlTeam: 'WSH', position: 'G' }, players).player.name, 'Logan Thompson');
});

test('matchPlayer falls back to the NHL team when name and initial both collide', () => {
  const players = pool(
    { name: 'Sebastian Aho', team: 'CAR', pos: 'C' },
    { name: 'Sebastian Aho', team: 'NYI', pos: 'D' }
  );
  const m = matchPlayer({ player: 'S. Aho', nhlTeam: 'NYI', position: 'D' }, players);
  assert.equal(m.player.team, 'NYI');
  assert.equal(m.confidence, 'likely');
});

test('matchPlayer tolerates short and long NHL abbreviations', () => {
  const players = pool(
    { name: 'Brandon Hagel', team: 'TBL', pos: 'LW,RW' },
    { name: 'Brady Hagel', team: 'NJD', pos: 'C' }
  );
  // The feed writes TB, the pool says TBL.
  const m = matchPlayer({ player: 'B. Hagel', nhlTeam: 'TB', position: 'LW,RW' }, players);
  assert.equal(m.player.name, 'Brandon Hagel');
});

test('matchPlayer matches through accents in either direction', () => {
  const players = pool({ name: 'Juraj Slafkovsky', team: 'MTL', pos: 'LW,RW' });
  assert.equal(matchPlayer({ player: 'J. Slafkovský', nhlTeam: 'MTL' }, players).player.name, 'Juraj Slafkovsky');
});

test('matchPlayer returns null rather than guess when nothing separates two candidates', () => {
  const players = pool(
    { name: 'Sebastian Aho', team: 'CAR', pos: 'C' },
    { name: 'Simon Aho', team: 'CAR', pos: 'C' }
  );
  assert.equal(matchPlayer({ player: 'S. Aho', nhlTeam: 'CAR', position: 'C' }, players), null);
});

test('matchPlayer returns null for a player who is not in the pool at all', () => {
  assert.equal(matchPlayer({ player: 'N. Obody' }, pool({ name: 'Cole Caufield' })), null);
});

test('an alias overrides the name matching entirely', () => {
  const players = pool({ name: 'Alexander Wennberg', team: 'SJS', pos: 'C' });
  const aliases = new Map([['a wennburg', 'Alexander Wennberg']]);
  const m = matchPlayer({ player: 'A. Wennburg' }, players, aliases);
  assert.equal(m.player.name, 'Alexander Wennberg');
  assert.equal(m.reason, 'alias');
});

// --- draft order recovery ------------------------------------------------

// A 6-team snake: round 1 forward, round 2 back, round 3 forward.
const SIX_TEAM = ['A', 'B', 'C', 'D', 'E', 'F'];
function snakeFeed(teams, rounds, startPick = 1) {
  const out = [];
  const n = teams.length;
  for (let r = 1; r <= rounds; r++) {
    const order = r % 2 === 1 ? teams : [...teams].reverse();
    order.forEach((name, i) => {
      const pick = (r - 1) * n + i + 1;
      if (pick >= startPick) out.push({ pick, draftedBy: name, player: `P${pick}` });
    });
  }
  return out;
}

test('inferDraftOrder recovers the seating from a clean snake', () => {
  const order = inferDraftOrder(snakeFeed(SIX_TEAM, 3), { minTeams: 4 });
  assert.equal(order.teamCount, 6);
  assert.deepEqual(order.teams.map((t) => t.name), SIX_TEAM);
});

test('inferDraftOrder finds my own seat from the You label', () => {
  const teams = ['A', 'B', 'You', 'D', 'E', 'F'];
  assert.equal(inferDraftOrder(snakeFeed(teams, 3), { minTeams: 4 }).myTeamSlot, 3);
});

test('inferDraftOrder works when the feed starts mid-draft', () => {
  // Started at pick 9, i.e. part-way through round 2 — the reversal itself is
  // what makes the seating recoverable without ever seeing round 1.
  const order = inferDraftOrder(snakeFeed(SIX_TEAM, 4, 9), { minTeams: 4 });
  assert.equal(order.teamCount, 6);
  assert.deepEqual(order.teams.map((t) => t.name), SIX_TEAM);
});

test('inferDraftOrder refuses when a manager has not picked yet', () => {
  // Only five of six seats seen: a partial fit is not a fit.
  const partial = snakeFeed(SIX_TEAM, 3).filter((p) => p.draftedBy !== 'F');
  assert.equal(inferDraftOrder(partial, { minTeams: 4 }), null);
});

test('inferDraftOrder refuses a feed that is not a snake at all', () => {
  const picks = snakeFeed(SIX_TEAM, 3);
  picks[7].draftedBy = 'A'; // someone picked twice in one round
  assert.equal(inferDraftOrder(picks, { minTeams: 4 }), null);
});

test('inferDraftOrder refuses too short a feed to say anything', () => {
  assert.equal(inferDraftOrder(snakeFeed(SIX_TEAM, 1).slice(0, 3), { minTeams: 4 }), null);
});

// --- sync planning -------------------------------------------------------

const TEAMS = SIX_TEAM.map((name, i) => ({ id: `t${i + 1}`, name }));

test('planSync seats each pick by slot and flags a feed that disagrees', () => {
  const feed = snakeFeed(SIX_TEAM, 2);
  feed[3].draftedBy = 'Someone Else';
  const plan = planSync({ feedPicks: feed, players: [], teams: TEAMS, teamCount: 6, myTeamId: 't3' });
  assert.equal(plan.rows[3].team, 'D', 'the slot decides, not the feed string');
  assert.deepEqual(plan.teamMismatches, [{ pick: 4, expected: 'D', feed: 'Someone Else' }]);
});

test('planSync fills the picks before the feed started so numbering stays contiguous', () => {
  const plan = planSync({ feedPicks: snakeFeed(SIX_TEAM, 3, 9), players: [], teams: TEAMS, teamCount: 6 });
  assert.equal(plan.feedStart, 9);
  assert.equal(plan.gapBefore, 8);
  assert.equal(plan.rows.length, 18);
  assert.deepEqual(plan.rows.map((r) => r.pickNum).slice(0, 3), [1, 2, 3]);
  assert.equal(plan.rows[0].playerId, null);
  assert.equal(plan.rows[0].source, 'placeholder');
});

test('planSync keeps hand-entered picks that sit before the feed window', () => {
  const existing = [{ pick_num: 1, team: 'A', player_id: 42, player_name: 'Hand Entered', pos: 'C' }];
  const plan = planSync({
    feedPicks: snakeFeed(SIX_TEAM, 2, 3),
    players: [],
    teams: TEAMS,
    teamCount: 6,
    existingBefore: existing,
  });
  assert.equal(plan.rows[0].playerName, 'Hand Entered');
  assert.equal(plan.rows[0].playerId, 42);
  assert.equal(plan.rows[1].source, 'placeholder', 'pick 2 was never entered anywhere');
});

test('planSync records an unmatched pick without losing its place in the order', () => {
  const players = pool({ name: 'Cole Caufield', team: 'MTL', pos: 'LW' });
  const feed = [
    { pick: 1, draftedBy: 'A', player: 'C. Caufield', position: 'LW', nhlTeam: 'MTL' },
    { pick: 2, draftedBy: 'B', player: 'Q. Nonexistent', position: 'C', nhlTeam: 'TOR' },
  ];
  const plan = planSync({ feedPicks: feed, players, teams: TEAMS, teamCount: 6 });
  assert.equal(plan.rows.length, 2);
  assert.equal(plan.rows[1].playerId, null);
  assert.equal(plan.rows[1].playerName, 'Q. Nonexistent', 'the raw feed name is kept so it can be aliased');
  assert.deepEqual(plan.unmatched.map((u) => u.pick), [2]);
});

test('planSync marks my own picks', () => {
  const plan = planSync({ feedPicks: snakeFeed(SIX_TEAM, 2), players: [], teams: TEAMS, teamCount: 6, myTeamId: 't3' });
  assert.deepEqual(plan.rows.filter((r) => r.mine).map((r) => r.pickNum), [3, 10]);
});

test('planSync ignores a duplicated pick number in the file', () => {
  const feed = [...snakeFeed(SIX_TEAM, 1), { pick: 3, draftedBy: 'C', player: 'Dupe' }];
  const plan = planSync({ feedPicks: feed, players: [], teams: TEAMS, teamCount: 6 });
  assert.equal(plan.rows.length, 6);
});

test('planSync on an empty feed produces no rows at all', () => {
  // The route refuses to act on this rather than treating it as "delete
  // everything" — see the empty-feed guard in POST /draft/feed/sync.
  const plan = planSync({ feedPicks: [], players: [], teams: TEAMS, teamCount: 6 });
  assert.equal(plan.rows.length, 0);
  assert.equal(plan.feedStart, 1);
  assert.equal(plan.gapBefore, 0);
});
