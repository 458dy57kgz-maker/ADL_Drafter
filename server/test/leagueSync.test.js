import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { reconcileLeague } from '../src/lib/leagueSync.js';

// Just the columns reconcileLeague touches.
function setup(players, picks = []) {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE players (id INTEGER PRIMARY KEY, name TEXT, drafted INTEGER NOT NULL DEFAULT 0,
                          drafted_by TEXT, mine INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE draft_picks (pick_num INTEGER PRIMARY KEY, team TEXT, player_id INTEGER);
  `);
  const insP = db.prepare('INSERT INTO players (id, name, drafted, drafted_by, mine) VALUES (?, ?, ?, ?, ?)');
  players.forEach(([id, by, mine]) => insP.run(id, `P${id}`, by ? 1 : 0, by, mine ? 1 : 0));
  const insK = db.prepare('INSERT INTO draft_picks (pick_num, team, player_id) VALUES (?, ?, ?)');
  picks.forEach(([n, team, pid]) => insK.run(n, team, pid));
  return db;
}

const mineIds = (db) => db.prepare('SELECT id FROM players WHERE mine = 1 ORDER BY id').all().map((r) => r.id);
const league = (myTeamId, names = ['Alpha', 'Bravo', 'Charlie']) => ({
  myTeamId,
  teams: names.map((name, i) => ({ id: `t${i + 1}`, name })),
});

test('switching my team moves ownership instead of adding a second team', () => {
  // The reported bug: Alpha was mine, then Bravo was chosen; both showed up.
  const db = setup([
    [1, 'Alpha', true],
    [2, 'Alpha', true],
    [3, 'Bravo', false],
    [4, null, false],
  ]);
  reconcileLeague(db, league('t1'), league('t2'));
  assert.deepEqual(mineIds(db), [3]);
});

test('clearing my team clears every mine flag', () => {
  const db = setup([[1, 'Alpha', true], [2, 'Bravo', false]]);
  const result = reconcileLeague(db, league('t1'), league(null));
  assert.deepEqual(mineIds(db), []);
  assert.equal(result.mine, 0);
});

test('an undrafted player is never mine, whatever the stored flag says', () => {
  const db = setup([[1, null, true], [2, 'Alpha', false]]);
  reconcileLeague(db, league('t1'), league('t1'));
  assert.deepEqual(mineIds(db), [2]);
});

test('renaming a team carries its picks with it', () => {
  const db = setup([[1, 'Alpha', true], [2, 'Bravo', false]], [[1, 'Alpha', 1], [2, 'Bravo', 2]]);
  const result = reconcileLeague(db, league('t1'), league('t1', ['Alpha Wolves', 'Bravo', 'Charlie']));
  assert.equal(result.renamed, 1);
  assert.equal(db.prepare('SELECT drafted_by FROM players WHERE id = 1').get().drafted_by, 'Alpha Wolves');
  assert.equal(db.prepare('SELECT team FROM draft_picks WHERE pick_num = 1').get().team, 'Alpha Wolves');
  // Still mine under its new name.
  assert.deepEqual(mineIds(db), [1]);
});

test('swapping two team names does not merge their picks', () => {
  const db = setup([[1, 'Alpha', false], [2, 'Bravo', false]], [[1, 'Alpha', 1], [2, 'Bravo', 2]]);
  reconcileLeague(db, league(null), league(null, ['Bravo', 'Alpha', 'Charlie']));
  assert.equal(db.prepare('SELECT drafted_by FROM players WHERE id = 1').get().drafted_by, 'Bravo');
  assert.equal(db.prepare('SELECT drafted_by FROM players WHERE id = 2').get().drafted_by, 'Alpha');
  assert.equal(db.prepare('SELECT team FROM draft_picks WHERE pick_num = 1').get().team, 'Bravo');
});

test('a team that only moved in the draft order is not a rename', () => {
  const db = setup([[1, 'Alpha', true]]);
  const before = league('t1');
  const after = { myTeamId: 't1', teams: [before.teams[1], before.teams[0], before.teams[2]] };
  const result = reconcileLeague(db, before, after);
  assert.equal(result.renamed, 0);
  assert.deepEqual(mineIds(db), [1]);
});
