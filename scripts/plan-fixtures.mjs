/**
 * Generates the three plan states that are hard to reach by hand — a close
 * call, the snake turn, and a live goalie-policy audit — by running the real
 * engine over synthetic pools, then writes them to
 * client/src/lib/draft/planFixtures.json for the UI to render.
 *
 * They are generated rather than hand-written on purpose: a hand-faked plan
 * object drifts away from what the engine actually emits, and then the panel
 * is verified against a shape that never occurs.
 *
 *   node scripts/plan-fixtures.mjs
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { DEFAULT_CONFIG, buildContext } from '../client/src/lib/draft/draftValue.js';
import { planNextTwo } from '../client/src/lib/draft/draftPlan.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const CONFIG = {
  ...DEFAULT_CONFIG,
  teamCount: 10,
  slots: { C: 2, LW: 2, RW: 2, D: 4, G: 2 },
  benchSlots: 4,
  totalRounds: 16,
};

/**
 * A pool shaped the way real data is, which matters more than it sounds.
 *
 * VORP is defined as value over the REPLACEMENT player at that position, so it
 * crosses zero at roughly (teams x starting slots) deep and goes negative past
 * it. `computeReplacementLevels` looks for exactly that crossing and, failing
 * to find one, falls back to the very last player in the pool — a far deeper
 * baseline that inflates every surplus. An earlier version of this generator
 * emitted an always-positive VORP and put the whole model in that fallback
 * regime, which is not the one the app runs in.
 */
const POS_COUNTS = { C: 40, LW: 40, RW: 40, D: 60, G: 20 };

function makePool() {
  const players = [];
  for (const [pos, count] of Object.entries(POS_COUNTS)) {
    const replacementIdx = CONFIG.teamCount * CONFIG.slots[pos];
    const topVorp = pos === 'G' ? 9 : pos === 'D' ? 7 : 8;
    for (let j = 0; j < count; j++) {
      // Linear through zero at the replacement index, negative beyond it.
      const vorp = Number((topVorp * (1 - j / replacementIdx)).toFixed(3));
      const q = Math.max(0.12, 1 - j / (count * 1.15)); // quality, 1 down to ~0.13
      const goalie = pos === 'G';
      players.push({
        name: `${pos} ${String(j + 1).padStart(2, '0')}`,
        pos,
        posList: [pos],
        team: `T${(players.length % 16) + 1}`,
        vorp,
        ong: Math.round(20 + (j % 11)),
        gp: 74 + (j % 9),
        g: goalie ? null : Math.round(48 * q) + 4,
        a: goalie ? null : Math.round(58 * q) + 7,
        p: goalie ? null : Math.round(106 * q) + 11,
        ppp: goalie ? null : Math.round(38 * q) + 3,
        plusMinus: goalie ? null : Math.round(26 * q) - 6,
        shots: goalie ? null : Math.round(250 * q) + 55,
        blocks: goalie ? null : Math.round((pos === 'D' ? 170 : 55) * q) + (pos === 'D' ? 50 : 15),
        w: goalie ? Math.round(34 * q) + 8 : null,
        gaa: goalie ? Number((2.35 + (1 - q) * 0.9).toFixed(2)) : null,
        saves: goalie ? Math.round(1500 * q) + 500 : null,
      });
    }
  }

  // Board order follows value, and ADP tracks it with the usual noise.
  players.sort((a, b) => b.vorp - a.vorp);
  players.forEach((p, i) => {
    p.overallRank = i + 1;
    p.adp = Math.max(1, Math.round((i + 1) * 1.05 + Math.sin(i) * 5));
    p.tier = 1 + Math.floor(i / 18);
  });
  return players;
}

/** Makes the top two skaters near-interchangeable, which is what drives the
 *  two best two-pick paths to within a hair of each other. */
function twinTopTwo(players) {
  // The top of this board is a goalie, and goalies carry null skater stats —
  // copying those between two goalies changes nothing the scorer reads. Twin
  // the best two skaters at a shared position instead.
  const a = players.find((p) => p.pos !== 'G');
  const b = players.find((p) => p !== a && p.pos === a.pos);
  for (const k of ['g', 'a', 'p', 'ppp', 'plusMinus', 'shots', 'blocks', 'vorp', 'ong', 'gp']) b[k] = a[k];
  b.adp = a.adp;
  b.overallRank = a.overallRank + 1;
  return players;
}

function run(label, { players, pickNum, round, mySlot, config = CONFIG, myRoster = [] }) {
  const ctx = buildContext(players, config);
  const drafted = new Set(myRoster);
  const available = players
    .filter((p) => !drafted.has(p.name))
    .sort((a, b) => (b._raw ?? 0) - (a._raw ?? 0));
  const roster = players.filter((p) => drafted.has(p.name));
  const plan = planNextTwo({ available, myRoster: roster, pickNum, round, mySlot }, ctx, {});
  // Derived, not asserted: `turn.picks[0]` is the pick this plan is about, so
  // you are on the clock exactly when it equals the current pick. Hardcoding
  // this to true made the header contradict the urgency label in any fixture
  // where the state was mid-round.
  const isMyTurnNow = plan.turn?.picks?.[0] === pickNum;
  return { label, pickInfo: { pickNum, round, isMyTurnNow }, plan };
}

const fixtures = {};

// --- 1. Close call: the best and second-best paths within 0.03 cats/week ----
{
  const f = run('close call', { players: twinTopTwo(makePool()), pickNum: 1, round: 1, mySlot: 4 });
  fixtures.closeCall = f;
  const edge = f.plan.now?.edge;
  assert(edge != null && edge < 0.03, `close call: edge is ${edge}, expected < 0.03`);
  assert(f.plan.now?.alternative != null, 'close call: no alternative to show as the equal second option');
}

// --- 1b. Confident: a clearly dominant top path, so the green Edge pill and
// the neutral Close-call pill are both exercised. ------------------------
{
  const players = makePool();
  const top = players.find((p) => p.pos !== 'G');
  // One player far above the board, and no same-position twin behind him.
  // Must be a skater: multiplying a goalie's null skater stats is a no-op, so
  // boosting one leaves the plan byte-identical and the fixture proves nothing.
  for (const k of ['g', 'a', 'p', 'ppp', 'shots', 'blocks']) top[k] = Math.round(top[k] * 3.6);
  top.vorp = 26;
  const f = run('confident', { players, pickNum: 1, round: 1, mySlot: 4 });
  fixtures.confident = f;
  assert(f.plan.now?.edge >= 0.03, `confident: edge is ${f.plan.now?.edge}, expected >= 0.03`);
}

// --- 2. Turn: back-to-back picks, so the panel switches to an ordering call -
{
  // Slot 10 of 10 picks at 10 and 11 — a one-pick gap.
  const f = run('turn', { players: makePool(), pickNum: 10, round: 1, mySlot: 10 });
  fixtures.turn = f;
  assert(f.plan.turn.kind === 'turn', `turn: kind is ${f.plan.turn.kind}, expected 'turn'`);
  assert(/ordering call/.test(f.plan.then.message), 'turn: message is not the ordering copy');
}

// --- 3. Goalie audit -------------------------------------------------------
// The panel renders this only when costVsTop > 0 — the suppressed goalie's
// immediate value beating the pick being recommended — because the engine
// builds an audit on every pick before the policy's min round and showing it
// unconditionally put the same line on screen all draft.
//
// There is no 'soft' fixture here, and that is a finding rather than an
// omission: under 'soft' the goalie is never removed from the ranking, so he
// either wins it outright (costVsTop lands at exactly 0) or he was not close
// (negative). Driving a simulated draft through rounds 1-3 produced 0.000,
// 0.000, -0.228 — never positive. The rule only has a cost to report when it
// is actually holding someone out, which is 'hard'.
{
  const f = run('goalie audit (hard)', {
    players: makePool(),
    pickNum: 3,
    round: 1,
    mySlot: 3,
    config: { ...CONFIG, goaliePolicy: { mode: 'hard', minRound: 4 } },
  });
  fixtures.goalieAuditHard = f;
  assert(
    f.plan.goalieAudit?.costVsTop > 0,
    `goalie audit (hard): costVsTop is ${f.plan.goalieAudit?.costVsTop}, expected > 0`
  );
}

function assert(cond, message) {
  if (!cond) {
    console.error(`FAIL  ${message}`);
    process.exitCode = 1;
  } else {
    console.log(`ok    ${message.split(':')[0]}`);
  }
}

// Strip the engine's internal decorations; the panel only ever sees what the
// worker posts back, so the fixtures should match that surface.
const slim = (p) =>
  p && {
    name: p.name,
    pos: p.pos,
    posList: p.posList,
    team: p.team,
    vorp: p.vorp,
    overallRank: p.overallRank,
    adp: p.adp,
    diff: p._diff ?? null,
    offShare: p._offShare ?? null,
  };

for (const f of Object.values(fixtures)) {
  const { plan } = f;
  if (plan.now) {
    plan.now.player = slim(plan.now.player);
    plan.now.alternative = slim(plan.now.alternative);
  }
  if (plan.then?.candidates) plan.then.candidates = plan.then.candidates.map((c) => ({ ...c, player: slim(c.player) }));
  if (plan.goalieAudit) {
    plan.goalieAudit.player = slim(plan.goalieAudit.player);
    // Mirrors what the worker attaches; the panel's copy branches on it.
    plan.goalieAudit.mode = f.label.includes('hard') ? 'hard' : 'soft';
    plan.goalieAudit.minRound = 4;
    plan.goalieAudit.insteadOf = plan.now?.player?.name ?? null;
  }
  if (plan.turn?.picks) plan.turn.picks = plan.turn.picks.map((n) => n ?? null);
}

const out = path.resolve(__dirname, '../client/src/lib/draft/planFixtures.json');
writeFileSync(out, `${JSON.stringify(fixtures, null, 2)}\n`);
console.log(`\nwrote ${out}`);
