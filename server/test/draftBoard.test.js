import test from 'node:test';
import assert from 'node:assert/strict';
import {
  visibleTiers,
  classifyRemaining,
  waitStatus,
  defaultRiskMargin,
  detectCliff,
  topCategories,
  offNightShare,
  priceBand,
  pickWindow,
  cardVerdict,
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

test('waitStatus: an ADP already in the past is simply gone', () => {
  // This used to be 'overdue' and carried the board's loudest value styling.
  // Whether a player is a value is the drafter's call now, not the market's —
  // see priceBand. Availability is all this function claims.
  assert.equal(waitStatus(28, 89, 104), 'gone');
  assert.equal(waitStatus(89, 89, 104), 'gone');
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

test('defaultRiskMargin never exceeds half a round', () => {
  // Slot 1 on the clock at pick 1, next turn at 20: half the gap is 9.5, which
  // stretched "risky" out to ADP 29 purely because of where the seat sits.
  assert.equal(defaultRiskMargin(1, 20, 10), 5);
  // Mid-round the gap is already the smaller of the two, so nothing moves.
  assert.equal(defaultRiskMargin(89, 95, 10), 3);
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

test('fixture: a full position still prices a bargain', () => {
  const players = [
    // Four D on my roster in a four-D league: the position is full.
    ...Array.from({ length: 4 }, (_, i) =>
      player({ id: 100 + i, posList: ['D'], drafted: true, mine: true, overallRank: i + 1 })
    ),
    // ...and a T1 D I rate four rounds above where the room takes him.
    player({ id: 200, name: 'Quinn Hughes', posList: ['D'], overallRank: 20, adp: 60, tier: 1, diff: -4 }),
    player({ id: 201, name: 'Filler D', posList: ['D'], overallRank: 90, adp: 150, tier: 3, diff: -6 }),
  ];
  const myPlayers = players.filter((p) => p.mine);

  const board = buildBoard({
    players,
    positions: ['D'],
    rosterSlots: { D: 4 },
    myPlayers,
    currentPick: 89,
    nextPick: 104,
    teamCount: 10,
  });

  const col = board.columns[0];
  assert.equal(col.sub.kind, 'roster');
  assert.equal(col.sub.text, 'Roster: 4/4 filled — full');

  const hughes = col.cards[0];
  assert.equal(hughes.name, 'Quinn Hughes');
  // A full position does not suppress the price reading — bench and trade
  // value are still value.
  assert.equal(hughes.band, 'steal');
  assert.equal(hughes.diff, -4);
  assert.equal(hughes.suggested, false, 'the position is already full');
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
  assert.deepEqual(col.counts.tiers, [
    { tier: 1, count: 1 },
    { tier: 2, count: 1 }, // the other T2 is off the board
  ]);
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

// --- price, window and verdict -------------------------------------------
// `diff` is (myRank - adp) / teamCount, in rounds: negative means I rate him
// above where the room takes him.

test('priceBand: inside half a round you and the room agree', () => {
  assert.equal(priceBand(0), 'fair');
  assert.equal(priceBand(-0.5), 'fair');
  assert.equal(priceBand(0.5), 'fair');
});

test('priceBand: past half a round it counts, past 0.8 it counts loudly', () => {
  assert.equal(priceBand(-0.6), 'value');
  assert.equal(priceBand(-0.8), 'steal');
  assert.equal(priceBand(-1.8), 'steal');
  assert.equal(priceBand(0.6), 'rich');
  assert.equal(priceBand(0.8), 'overpay');
  assert.equal(priceBand(1.3), 'overpay');
});

test('priceBand: no diff, no opinion', () => {
  assert.equal(priceBand(null), null);
  assert.equal(priceBand(undefined), null);
});

// Slot 1 of ten: picks 1, 20, 21, 40, 41 — the seat that produced the report.
const SLOT_1 = [1, 20, 21, 40, 41];

test('pickWindow: a bargain names the last pick before the room takes him', () => {
  // Ranked 12th, taken by the room around 30. Don't burn pick 1 on him, and
  // don't still be waiting at 40.
  const win = pickWindow({ overallRank: 12, adp: 30 }, SLOT_1);
  assert.equal(win.floor, 20);
  assert.equal(win.ceiling, 21);
  assert.equal(win.open, true);
});

test('pickWindow: the reported case — the window is shut', () => {
  // Hellebuyck: my rank 37, ADP 24. My last pick before 24 is 21, but the
  // first at which he's worth his rank is 40. No pick of mine is both.
  const win = pickWindow({ overallRank: 37, adp: 24 }, SLOT_1);
  assert.equal(win.ceiling, 21);
  assert.equal(win.floor, 40);
  assert.equal(win.open, false);
});

test('pickWindow: no claim without a rank, an ADP and a schedule', () => {
  assert.equal(pickWindow({ overallRank: 12, adp: null }, SLOT_1), null);
  assert.equal(pickWindow({ overallRank: null, adp: 30 }, SLOT_1), null);
  assert.equal(pickWindow({ overallRank: 12, adp: 30 }, []), null);
});

test('cardVerdict: a window closing on this very pick is the last call', () => {
  const win = { floor: 1, ceiling: 1, open: true };
  assert.equal(cardVerdict({ status: 'gone', band: 'fair', window: win, currentPick: 1, horizon: 21 }), 'lastcall');
});

test('cardVerdict: a window closing later names that pick', () => {
  const win = { floor: 20, ceiling: 21, open: true };
  assert.equal(cardVerdict({ status: 'safe', band: 'steal', window: win, currentPick: 1, horizon: 21 }), 'takeat');
});

test('cardVerdict: a shut window on an overpriced player says let him go', () => {
  const win = { floor: 40, ceiling: 21, open: false };
  assert.equal(cardVerdict({ status: 'gone', band: 'overpay', window: win, currentPick: 1, horizon: 21 }), 'letgo');
  assert.equal(cardVerdict({ status: 'gone', band: 'rich', window: win, currentPick: 1, horizon: 21 }), 'letgo');
});

test('cardVerdict: a shut window on a bargain keeps the plain reading', () => {
  // You'd have to reach, but he really is worth more to you than to the room.
  // The board states the fact and leaves the call where it belongs.
  const win = { floor: 20, ceiling: 1, open: false };
  assert.equal(cardVerdict({ status: 'gone', band: 'steal', window: win, currentPick: 1, horizon: 21 }), 'gone');
});

test('cardVerdict: a window closing beyond the horizon is not announced', () => {
  const win = { floor: 40, ceiling: 41, open: true };
  assert.equal(cardVerdict({ status: 'safe', band: 'steal', window: win, currentPick: 1, horizon: 21 }), 'safe');
});

test('buildBoard: the reported case, end to end', () => {
  // Slot 1 of ten, on the clock at pick 1 — exactly the board that prompted
  // this. Hellebuyck was shouting LIKELY GONE at a player ranked 37th.
  const players = [
    player({ id: 1, name: 'Hellebuyck', posList: ['G'], overallRank: 37, adp: 24, diff: 1.3, tier: 2 }),
    player({ id: 2, name: 'Bouchard', posList: ['D'], overallRank: 12, adp: 30, diff: -1.8, tier: 2 }),
  ];
  const board = buildBoard({
    players,
    positions: ['G', 'D'],
    rosterSlots: { G: 2, D: 4 },
    myPlayers: [],
    currentPick: 1,
    nextPick: 20,
    myPickNumbers: SLOT_1,
    teamCount: 10,
  });

  const hellebuyck = board.columns[0].cards[0];
  assert.equal(hellebuyck.band, 'overpay');
  assert.equal(hellebuyck.status, 'letgo', 'the room bids past my price');
  assert.equal(hellebuyck.takeAt, null);
  assert.equal(hellebuyck.suggested, false, 'never suggest a player you must overpay for');

  const bouchard = board.columns[1].cards[0];
  assert.equal(bouchard.band, 'steal');
  assert.equal(bouchard.status, 'takeat');
  assert.equal(bouchard.takeAt, 21, 'my last pick before his ADP');
});

// --- header tiers --------------------------------------------------------

test('visibleTiers shows the two shallowest tiers that still have anyone', () => {
  const counts = new Map([[1, 2], [2, 6], [3, 12]]);
  assert.deepEqual(visibleTiers(counts), [{ tier: 1, count: 2 }, { tier: 2, count: 6 }]);
});

test('visibleTiers drops an exhausted tier and promotes the next one', () => {
  const counts = new Map([[1, 0], [2, 0], [3, 4], [4, 9]]);
  assert.deepEqual(visibleTiers(counts), [{ tier: 3, count: 4 }, { tier: 4, count: 9 }]);
});

test('visibleTiers returns what it has when only one tier is left', () => {
  assert.deepEqual(visibleTiers(new Map([[1, 0], [5, 3]])), [{ tier: 5, count: 3 }]);
  assert.deepEqual(visibleTiers(new Map()), []);
});

test('a column header carries the live tiers and the ring denominator', () => {
  const players = [
    player({ id: 1, posList: ['C'], tier: 3, drafted: true }),
    player({ id: 2, posList: ['C'], tier: 3, drafted: true }),
    player({ id: 3, posList: ['C'], tier: 4, overallRank: 5 }),
    player({ id: 4, posList: ['C'], tier: 5, overallRank: 6 }),
  ];
  const col = buildBoard({ players, positions: ['C'], rosterSlots: { C: 2 }, currentPick: 9, nextPick: 12 }).columns[0];
  assert.equal(col.counts.total, 2, 'undrafted only');
  assert.equal(col.counts.taken, 2, 'drafted at this position — the ring drains against this');
  assert.deepEqual(col.counts.tiers, [{ tier: 4, count: 1 }, { tier: 5, count: 1 }]);
});
