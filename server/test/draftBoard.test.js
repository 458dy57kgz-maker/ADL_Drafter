import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyRemaining,
  waitStatus,
  defaultRiskMargin,
  detectCliff,
  topCategories,
  offNightShare,
  buildBoard,
} from '../src/lib/draftBoard.js';

// A player as the board sees one: `posList` already parsed, `drafted` set.
function player(overrides = {}) {
  return {
    id: overrides.id ?? Math.random(),
    name: 'Player',
    posList: ['C'],
    drafted: false,
    overallRank: 1,
    adp: 50,
    tier: 1,
    g: 20, a: 20, ppp: 10, shots: 150, blocks: 30,
    ong: 30, gp: 82,
    ...overrides,
  };
}

// --- waitStatus ----------------------------------------------------------
// Implemented backwards once before, so every branch and both boundaries are
// pinned here. Reading: pick 89 on the clock, next turn at 104, margin 7.5.

test('waitStatus: adp already passed is overdue, not a warning', () => {
  assert.equal(waitStatus(28, 89, 104), 'overdue');
});

test('waitStatus: boundary adp === currentPick is overdue', () => {
  assert.equal(waitStatus(89, 89, 104), 'overdue');
});

test('waitStatus: adp inside my gap is gone', () => {
  assert.equal(waitStatus(96, 89, 104), 'gone');
});

test('waitStatus: boundary adp === nextPick is gone, not risky', () => {
  assert.equal(waitStatus(104, 89, 104), 'gone');
});

test('waitStatus: just past my next pick is risky', () => {
  // margin = (104 - 89) / 2 = 7.5, so 105..111.5 is risky
  assert.equal(waitStatus(105, 89, 104), 'risky');
  assert.equal(waitStatus(111, 89, 104), 'risky');
});

test('waitStatus: boundary adp === nextPick + margin is still risky', () => {
  assert.equal(waitStatus(111.5, 89, 104), 'risky');
});

test('waitStatus: real room past the margin is safe', () => {
  assert.equal(waitStatus(112, 89, 104), 'safe');
  assert.equal(waitStatus(145, 89, 104), 'safe');
});

test('waitStatus: an explicit riskMargin overrides the default', () => {
  assert.equal(waitStatus(120, 89, 104, 30), 'risky');
  assert.equal(waitStatus(120, 89, 104), 'safe');
});

test('waitStatus: unknown ADP yields no claim at all', () => {
  assert.equal(waitStatus(null, 89, 104), null);
  assert.equal(waitStatus(undefined, 89, 104), null);
});

test('defaultRiskMargin is half the gap, and never negative', () => {
  assert.equal(defaultRiskMargin(89, 104), 7.5);
  assert.equal(defaultRiskMargin(104, 89), 0);
});

// --- classifyRemaining ---------------------------------------------------

test('classifyRemaining counts undrafted players at a position by tier', () => {
  const players = [
    player({ id: 1, tier: 1 }),
    player({ id: 2, tier: 1, drafted: true }),
    player({ id: 3, tier: 2 }),
    player({ id: 4, tier: 3 }),
    player({ id: 5, tier: 1, posList: ['D'] }),
    player({ id: 6, tier: null }),
  ];
  const counts = classifyRemaining(players, 'C', 40);
  assert.equal(counts.t1, 1);
  assert.equal(counts.t2, 1);
  // total is the whole undrafted count at C, tiers included or not
  assert.equal(counts.total, 4);
  assert.equal(counts.byTier.get(3), 1);
});

test('classifyRemaining counts a dual-eligible player in both positions', () => {
  const players = [player({ id: 1, posList: ['C', 'LW'], tier: 1 })];
  assert.equal(classifyRemaining(players, 'C', 1).total, 1);
  assert.equal(classifyRemaining(players, 'LW', 1).total, 1);
});

// --- detectCliff ---------------------------------------------------------

test('detectCliff marks the last player of a nearly exhausted tier', () => {
  const list = [
    player({ id: 1, tier: 1 }),
    player({ id: 2, tier: 2 }),
    player({ id: 3, tier: 3 }),
  ];
  // Two T2s left in the pool, so the T2 -> T3 step is a cliff.
  const counts = classifyRemaining(
    [...list, player({ id: 4, tier: 2 })],
    'C',
    1
  );
  assert.equal(counts.t2, 2);
  assert.equal(detectCliff(list, counts), 1); // divider after index 1
});

test('detectCliff stays quiet while a tier is still deep', () => {
  const list = [player({ id: 1, tier: 2 }), player({ id: 2, tier: 3 })];
  const deep = [...list, ...Array.from({ length: 5 }, (_, i) => player({ id: 10 + i, tier: 2 }))];
  const counts = classifyRemaining(deep, 'C', 1);
  assert.equal(counts.t2, 6);
  assert.equal(detectCliff(list, counts), null);
});

test('detectCliff ignores a step to a BETTER tier', () => {
  const list = [player({ id: 1, tier: 3 }), player({ id: 2, tier: 2 })];
  const counts = classifyRemaining(list, 'C', 1);
  assert.equal(detectCliff(list, counts), null);
});

test('detectCliff ignores players with no tier', () => {
  const list = [player({ id: 1, tier: null }), player({ id: 2, tier: 3 })];
  assert.equal(detectCliff(list, classifyRemaining(list, 'C', 1)), null);
});

// --- topCategories -------------------------------------------------------

test('topCategories ranks within the position pool and shows raw totals', () => {
  const pool = [
    player({ id: 1, g: 45, a: 30, ppp: 20, shots: 300, blocks: 20 }),
    player({ id: 2, g: 20, a: 30, ppp: 20, shots: 150, blocks: 20 }),
    player({ id: 3, g: 18, a: 30, ppp: 20, shots: 140, blocks: 20 }),
  ];
  const tags = topCategories(pool[0], pool);
  assert.equal(tags.length, 2);
  // g and shots are the only categories with any spread in this pool
  assert.deepEqual(tags.map((t) => t.key).sort(), ['g', 'shots']);
  assert.equal(tags.find((t) => t.key === 'g').text, '45 G');
});

test('topCategories treats a low GAA as a strength and prints it un-negated', () => {
  const pool = [
    player({ id: 1, posList: ['G'], w: 30, saves: 1500, gaa: 2.1 }),
    player({ id: 2, posList: ['G'], w: 30, saves: 1500, gaa: 3.4 }),
    player({ id: 3, posList: ['G'], w: 30, saves: 1500, gaa: 3.3 }),
  ];
  const tags = topCategories(pool[0], pool);
  const gaa = tags.find((t) => t.key === 'gaa');
  assert.ok(gaa, 'GAA should tag');
  assert.equal(gaa.text, '2.10 GAA');
  assert.ok(gaa.z > 0, 'the best GAA in the pool should score positively');
});

test('topCategories skips categories the player has no value for', () => {
  const pool = [
    player({ id: 1, g: null, a: 60, shots: 300 }),
    player({ id: 2, g: 20, a: 20, shots: 150 }),
    player({ id: 3, g: 18, a: 18, shots: 140 }),
  ];
  assert.ok(!topCategories(pool[0], pool).some((t) => t.key === 'g'));
});

// --- offNightShare -------------------------------------------------------

test('offNightShare divides off-night games by games played', () => {
  assert.equal(offNightShare(player({ ong: 30, gp: 60 })), 0.5);
});

test('offNightShare falls back to a full season when gp is missing', () => {
  assert.equal(offNightShare(player({ ong: 41, gp: null })), 0.5);
});

test('offNightShare returns null rather than a fabricated share', () => {
  assert.equal(offNightShare(player({ ong: null, gp: 82 })), null);
  assert.equal(offNightShare(player({ ong: null, gp: null })), null);
});

// --- buildBoard: the two fixtures the brief calls for --------------------

test('fixture: a full position still flags an overdue player as VALUE', () => {
  const players = [
    // Four D on my roster in a four-D league: the position is full.
    ...Array.from({ length: 4 }, (_, i) =>
      player({ id: 100 + i, posList: ['D'], drafted: true, mine: true, overallRank: i + 1 })
    ),
    // ...and a T1 D who has fallen 61 picks past his ADP.
    player({ id: 200, name: 'Quinn Hughes', posList: ['D'], overallRank: 20, adp: 28, tier: 1 }),
    player({ id: 201, name: 'Filler D', posList: ['D'], overallRank: 90, adp: 150, tier: 3 }),
  ];
  const myPlayers = players.filter((p) => p.mine);

  const board = buildBoard({
    players,
    positions: ['D'],
    rosterSlots: { D: 4 },
    myPlayers,
    currentPick: 89,
    nextPick: 104,
  });

  const col = board.columns[0];
  assert.equal(col.sub.kind, 'roster');
  assert.equal(col.sub.text, 'Roster: 4/4 filled — full');

  const hughes = col.cards[0];
  assert.equal(hughes.name, 'Quinn Hughes');
  // The whole point: a full position does not suppress the value signal.
  assert.equal(hughes.status, 'overdue');
  assert.equal(hughes.picksAgo, 61);
  assert.equal(hughes.suggested, false, 'gold beats green — no double badge');
});

test('fixture: the cliff divider lands between the two tiers it separates', () => {
  const players = [
    player({ id: 1, name: 'Kaprizov', posList: ['LW'], overallRank: 1, tier: 1, adp: 62 }),
    player({ id: 2, name: 'Tkachuk', posList: ['LW'], overallRank: 2, tier: 2, adp: 88 }),
    player({ id: 3, name: 'Other T2', posList: ['LW'], overallRank: 3, tier: 2, adp: 90, drafted: true }),
    player({ id: 4, name: 'Guentzel', posList: ['LW'], overallRank: 4, tier: 3, adp: 145 }),
    player({ id: 5, name: 'Deep T3', posList: ['LW'], overallRank: 5, tier: 3, adp: 160 }),
  ];

  const board = buildBoard({
    players,
    positions: ['LW'],
    rosterSlots: { LW: 2 },
    myPlayers: [],
    currentPick: 89,
    nextPick: 104,
  });

  const col = board.columns[0];
  assert.equal(col.counts.t1, 1);
  assert.equal(col.counts.t2, 1); // the other T2 is off the board
  assert.equal(col.cliffAfter, 1, 'divider sits after Tkachuk, before Guentzel');
  assert.equal(col.cards[1].name, 'Tkachuk');
  assert.equal(col.cards[2].name, 'Guentzel');
  assert.equal(col.sub.text, 'Cliff after next 2 picks');
});

test('buildBoard: a cliff deeper than the visible cards is not drawn', () => {
  const players = [
    ...Array.from({ length: 5 }, (_, i) =>
      player({ id: i + 1, posList: ['C'], overallRank: i + 1, tier: 2, adp: 200 })
    ),
    player({ id: 99, posList: ['C'], overallRank: 99, tier: 3, adp: 300 }),
  ];
  const board = buildBoard({
    players,
    positions: ['C'],
    rosterSlots: { C: 2 },
    myPlayers: [],
    currentPick: 89,
    nextPick: 104,
    depth: 4,
  });
  assert.equal(board.columns[0].cliffAfter, null);
  assert.equal(board.columns[0].sub.text, 'No cliff before pick 104');
});

test('buildBoard: the top card at a position with a need is suggested', () => {
  const players = [player({ id: 1, posList: ['C'], overallRank: 1, adp: 200 })];
  const board = buildBoard({
    players,
    positions: ['C'],
    rosterSlots: { C: 2 },
    myPlayers: [],
    currentPick: 89,
    nextPick: 104,
  });
  assert.equal(board.columns[0].cards[0].suggested, true);
  assert.equal(board.columns[0].cards[0].status, 'safe');
});
