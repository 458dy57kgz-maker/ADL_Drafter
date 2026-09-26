import test from 'node:test';
import assert from 'node:assert/strict';
import { assignRoster, canSit } from '../src/lib/roster.js';

const SLOTS = { C: 2, LW: 2, RW: 2, D: 4, G: 2, BENCH: 4 };

function p(id, posList, rosterSlot = null) {
  return { id, name: `P${id}`, posList, rosterSlot };
}

const seatOf = (rows, id) => rows.find((r) => r.player?.id === id)?.pos ?? null;

test('without any hand-picked seats, the fill is unchanged', () => {
  const { rows } = assignRoster([p(1, ['C', 'RW']), p(2, ['RW'])], SLOTS);
  assert.equal(seatOf(rows, 1), 'C', 'a C/RW takes C first, as before');
  assert.equal(seatOf(rows, 2), 'RW');
});

test('a hand-picked seat beats the fill — the Nylander case', () => {
  // C/RW, filled into C automatically; I'd rather have him at RW.
  const { rows, starters } = assignRoster([p(1, ['C', 'RW'], 'RW')], SLOTS);
  assert.equal(seatOf(rows, 1), 'RW');
  assert.equal(rows.filter((r) => r.pos === 'C' && !r.player).length, 2, 'both C seats now open');
  assert.equal(starters.length, 1);
});

test('a player pinned to the bench stays there and counts as bench', () => {
  const { rows, bench, starters } = assignRoster([p(1, ['C'], 'BN'), p(2, ['C'])], SLOTS);
  assert.equal(seatOf(rows, 1), 'BN');
  assert.equal(seatOf(rows, 2), 'C');
  assert.deepEqual(bench.map((x) => x.id), [1]);
  assert.deepEqual(starters.map((x) => x.id), [2]);
});

test('a pin he is no longer eligible for is ignored', () => {
  const { rows } = assignRoster([p(1, ['C'], 'D')], SLOTS);
  assert.equal(seatOf(rows, 1), 'C');
});

test('pins past a seat count that has shrunk fall back into the fill', () => {
  const players = [p(1, ['G'], 'G'), p(2, ['G'], 'G'), p(3, ['G'], 'G')];
  const { rows } = assignRoster(players, { ...SLOTS, G: 2 });
  assert.equal(rows.filter((r) => r.pos === 'G' && r.player).length, 2);
  assert.equal(seatOf(rows, 3), 'BN', 'the third goalie still shows up — on the bench');
});

test('new picks fill whatever is left around the pinned seats', () => {
  // RW pinned for #1, so the one RW seat left goes to the next RW.
  const players = [p(1, ['C', 'RW'], 'RW'), p(2, ['RW']), p(3, ['RW'])];
  const { rows } = assignRoster(players, SLOTS);
  assert.equal(seatOf(rows, 1), 'RW');
  assert.equal(seatOf(rows, 2), 'RW');
  assert.equal(seatOf(rows, 3), 'BN');
});

test('canSit: any eligible position, or the bench', () => {
  assert.equal(canSit(p(1, ['C', 'RW']), 'RW'), true);
  assert.equal(canSit(p(1, ['C', 'RW']), 'LW'), false);
  assert.equal(canSit(p(1, ['G']), 'BN'), true);
});
