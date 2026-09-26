import test from 'node:test';
import assert from 'node:assert/strict';
import { selectUrgencyCards, buildSlate, URGENCY_LINGER } from '../src/lib/urgencyRow.js';
import { slotForPick } from '../src/lib/draftMath.js';

const TEAMS = 10;

// A pool in my own rank order, which is the order the row reads it in.
function pool(overrides = {}) {
  return Array.from({ length: 30 }, (_, i) => ({
    id: i + 1,
    name: `Player ${i + 1}`,
    pos: 'C',
    overallRank: i + 1,
    adp: i + 1,
    drafted: false,
    draftedBy: null,
    ...(overrides[i + 1] ?? {}),
  }));
}

test('the row is my next targets in my own rank order', () => {
  const cards = selectUrgencyCards({ players: pool(), currentPick: 1, teamCount: TEAMS, limit: 5 });
  assert.deepEqual(
    cards.map((c) => c.myRank),
    [1, 2, 3, 4, 5]
  );
});

test('a player I never ranked has no ME number, so he never takes a card', () => {
  const players = pool({ 2: { overallRank: null } });
  const cards = selectUrgencyCards({ players, currentPick: 1, teamCount: TEAMS, limit: 3 });
  assert.deepEqual(
    cards.map((c) => c.id),
    [1, 3, 4]
  );
});

test('a drafted player stays up for five picks, then clears himself off', () => {
  const players = pool({ 3: { drafted: true, draftedBy: 'Five Hole' } });
  const picks = new Map([[3, 12]]);
  const at = (currentPick) =>
    selectUrgencyCards({ players, currentPick, teamCount: TEAMS, pickByPlayerId: picks, limit: 30 }).some((c) => c.id === 3);

  assert.equal(at(12), true, 'visible on the pick he was taken');
  assert.equal(at(12 + URGENCY_LINGER - 1), true, 'still visible one pick before he expires');
  assert.equal(at(12 + URGENCY_LINGER), false, 'gone five picks later');
});

test('a drafted card carries where he went, against both numbers', () => {
  const players = pool({ 3: { drafted: true, draftedBy: 'Blue Line', adp: 21 } });
  const [card] = selectUrgencyCards({
    players,
    currentPick: 13,
    teamCount: TEAMS,
    pickByPlayerId: new Map([[3, 12]]),
    limit: 1,
  }).filter((c) => c.id === 3);
  assert.deepEqual(card, { id: 3, name: 'Player 3', pos: 'C', myRank: 3, adp: 21, draftedAt: 12, draftedBy: 'Blue Line' });
});

test('an undrafted player drops off once both numbers are a full round past', () => {
  // Rank 3, ADP 8: the later of the two is 8, so he survives while the clock
  // is less than a full round past it — through pick 17, gone at 18.
  const players = pool({ 3: { adp: 8 } });
  const shows = (currentPick) =>
    selectUrgencyCards({ players, currentPick, teamCount: TEAMS, limit: 30 }).some((c) => c.id === 3);

  assert.equal(shows(17), true);
  assert.equal(shows(18), false);
});

test('the carousel runs one pick back through nine ahead', () => {
  const slate = buildSlate({
    currentPick: 22,
    teamCount: TEAMS,
    myDraftSlot: 1,
    totalPicks: 160,
    teamAtPick: (pk) => `slot ${slotForPick(pk, TEAMS)}`,
  });

  assert.equal(slate.length, 11);
  assert.equal(slate[0].pickNum, 21);
  assert.equal(slate[1].pickNum, 22);
  assert.equal(slate.at(-1).pickNum, 31);
  // Slot 1 picks at 21 and 40 in a ten-team snake, so only the first cell is mine.
  assert.deepEqual(
    slate.filter((s) => s.isMine).map((s) => s.pickNum),
    [21]
  );
});

test('picks outside the draft render as empty cells', () => {
  const slate = buildSlate({
    currentPick: 1,
    teamCount: TEAMS,
    myDraftSlot: 1,
    totalPicks: 6,
    teamAtPick: () => 'Some Team',
  });

  assert.equal(slate[0].team, null, 'pick 0 does not exist');
  assert.equal(slate[0].isMine, false);
  assert.equal(slate[6].pickNum, 6);
  assert.equal(slate[6].team, 'Some Team', 'the last real pick still has a team');
  assert.equal(slate[7].team, null, 'past the end of the draft');
});
