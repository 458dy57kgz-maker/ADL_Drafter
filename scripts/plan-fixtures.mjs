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

const POS_CYCLE = ['C', 'LW', 'RW', 'D', 'D', 'C', 'RW', 'D', 'LW', 'G'];

/** A deterministic pool that decays smoothly with rank, so value ordering and
 *  ADP ordering are realistic without being identical. */
function makePool(n = 90) {
  const players = [];
  for (let i = 0; i < n; i++) {
    const rank = i + 1;
    const pos = POS_CYCLE[i % POS_CYCLE.length];
    const decay = Math.exp(-i / 40);
    const goalie = pos === 'G';
    players.push({
      name: `Player ${String(rank).padStart(3, '0')}`,
      pos,
      posList: [pos],
      team: `T${(i % 16) + 1}`,
      overallRank: rank,
      adp: Math.max(1, Math.round(rank * 1.05 + Math.sin(i) * 4)),
      tier: 1 + Math.floor(i / 12),
      vorp: Number((9 * decay).toFixed(3)),
      ong: 24 + (i % 9),
      gp: 78 + (i % 5),
      g: goalie ? null : Math.round(45 * decay) + 5,
      a: goalie ? null : Math.round(55 * decay) + 8,
      p: goalie ? null : Math.round(100 * decay) + 13,
      ppp: goalie ? null : Math.round(35 * decay) + 4,
      plusMinus: goalie ? null : Math.round(24 * decay) - 4,
      shots: goalie ? null : Math.round(260 * decay) + 60,
      blocks: goalie ? null : Math.round(pos === 'D' ? 160 * decay + 60 : 50 * decay + 20),
      w: goalie ? Math.round(38 * decay) + 12 : null,
      gaa: goalie ? Number((2.35 + i / 200).toFixed(2)) : null,
      saves: goalie ? Math.round(1700 * decay) + 700 : null,
    });
  }
  return players;
}

/** Makes the top two skaters near-interchangeable, which is what drives the
 *  two best two-pick paths to within a hair of each other. */
function twinTopTwo(players) {
  const a = players[0];
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
  return { label, pickInfo: { pickNum, round, isMyTurnNow: true }, plan };
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
  const top = players[0];
  // One player far above the board, and no same-position twin behind him.
  for (const k of ['g', 'a', 'p', 'ppp', 'shots', 'blocks']) top[k] = Math.round(top[k] * 2.4);
  top.vorp = 22;
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

// --- 3. Goalie audit: soft policy reporting what the rule would have cost ---
{
  const players = makePool();
  // Put a goalie at the very top of the board so the suppressed player is one
  // the rule is visibly costing you, not a fringe starter.
  const g = players.find((p) => p.pos === 'G');
  g.vorp = 12;
  g.w = 44;
  g.saves = 2100;
  g.gaa = 2.05;
  g.overallRank = 1;
  g.adp = 2;
  const f = run('goalie audit', { players, pickNum: 3, round: 1, mySlot: 3 });
  fixtures.goalieAudit = f;
  assert(f.plan.goalieAudit != null, 'goalie audit: expected an audit before the policy min round');
  assert(typeof f.plan.goalieAudit.costVsTop === 'number', 'goalie audit: costVsTop missing');
}

// --- 3b. Goalie audit that is actually costing something -------------------
// Two things have to be true at once for the warning branch, and neither is
// common: the policy has to be holding the goalie OUT of the ranking ('hard',
// since under 'soft' a dominant goalie simply wins it and costVsTop lands at
// zero), and the goalie's marginal value has to beat the top skater's. The
// second is structurally hard — a goalie moves three categories and a skater
// moves seven — so this fixture also weakens the skater pool, which is what a
// genuinely goalie-heavy board looks like to the model.
{
  const players = makePool().map((p) =>
    p.pos === 'G'
      ? p
      : {
          ...p,
          g: Math.round(p.g * 0.18),
          a: Math.round(p.a * 0.18),
          p: Math.round(p.p * 0.18),
          ppp: Math.round(p.ppp * 0.18),
          shots: Math.round(p.shots * 0.18),
          blocks: Math.round(p.blocks * 0.18),
        }
  );
  const g = players.find((p) => p.pos === 'G');
  g.vorp = 40;
  g.w = 52;
  g.saves = 2600;
  g.gaa = 1.85;
  g.overallRank = 1;
  g.adp = 1;
  const f = run('goalie audit (costing)', {
    players,
    pickNum: 3,
    round: 1,
    mySlot: 3,
    config: { ...CONFIG, goaliePolicy: { mode: 'hard', minRound: 4 } },
  });
  fixtures.goalieAuditCosting = f;
  assert(
    f.plan.goalieAudit?.costVsTop > 0,
    `goalie audit (costing): costVsTop is ${f.plan.goalieAudit?.costVsTop}, expected > 0`
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
  if (plan.goalieAudit) plan.goalieAudit.player = slim(plan.goalieAudit.player);
  if (plan.turn?.picks) plan.turn.picks = plan.turn.picks.map((n) => n ?? null);
}

const out = path.resolve(__dirname, '../client/src/lib/draft/planFixtures.json');
writeFileSync(out, `${JSON.stringify(fixtures, null, 2)}\n`);
console.log(`\nwrote ${out}`);
