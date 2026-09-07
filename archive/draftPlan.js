/**
 * ADL Drafter — plan & explanation layer
 * --------------------------------------
 * Sits on top of draftValue.js. Produces the "next 2 picks" panel.
 *
 * Design rules this file follows:
 *   1. Never name a single player for pick 2. You cannot know who survives
 *      twelve picks. State the SHAPE (position, tier, categories) and attach
 *      probabilities to names. A confident wrong name destroys trust in the
 *      parts of the model that are right.
 *   2. Every displayed factor is a DECOMPOSITION of the score, never a
 *      parallel heuristic. If the reasons are computed separately from the
 *      decision, they drift, and the app starts explaining things it didn't do.
 *
 * Dependency direction is one-way: this imports draftValue, never the reverse.
 *
 * LOCAL CHANGES vs the original in design/draftPlan.js — one, applied 2026-09-06:
 *   - `timing.nextPick` now names the pick survival was measured to, rather
 *     than the pick after it. See the comment in planNextTwo. No scoring math
 *     is touched; the change is confined to which number the urgency label
 *     prints.
 */

import {
  DEFAULT_CONFIG,
  teamValue,
  teamCategoryProbs,
  marginalValue,
  survival,
  assignLineup,
  recommend,
  myPicks,
} from './draftValue.js';

// ---------------------------------------------------------------------------
// MEMOISATION
// ---------------------------------------------------------------------------

/**
 * Planning branches, so it costs roughly (branches x candidates x pool) team
 * evaluations versus (candidates x pool) for a single recommendation. Without
 * caching this is seconds, not milliseconds. Roster identity is the natural
 * cache key because teamValue is a pure function of the roster.
 */
function makeCache(limit = 4000) {
  const map = new Map();
  return {
    get(roster, fn) {
      const key = roster.map((p) => p.name).sort().join('|');
      if (map.has(key)) return map.get(key);
      const v = fn();
      if (map.size >= limit) map.clear();
      map.set(key, v);
      return v;
    },
    clear: () => map.clear(),
  };
}

// ---------------------------------------------------------------------------
// SNAKE GEOMETRY
// ---------------------------------------------------------------------------

/**
 * At the turn your two picks are nearly back-to-back, so survival between them
 * is ~1 and the real question is ORDER, not choice: take the scarcer position
 * first because the other guy will still be there. Mid-round with a 20-pick
 * gap it is the opposite problem. The panel should say different things.
 */
export function turnContext(pickNum, myPickNumbers, config = DEFAULT_CONFIG) {
  const upcoming = myPickNumbers.filter((n) => n >= pickNum);
  const [p1, p2] = upcoming;
  if (p1 == null) return { kind: 'done', picks: [] };
  if (p2 == null) return { kind: 'last', picks: [p1] };

  const gap = p2 - p1;
  const kind = gap <= 3 ? 'turn' : gap >= config.teamCount ? 'far' : 'normal';
  return { kind, picks: [p1, p2], gap };
}

// ---------------------------------------------------------------------------
// FACTOR DECOMPOSITION
// ---------------------------------------------------------------------------

const CAT_LABEL = {
  g: 'G', a: 'A', p: 'PTS', ppp: 'PPP', plusMinus: '+/-',
  shots: 'SOG', blocks: 'BLK', w: 'W', gaa: 'GAA', saves: 'SV',
};

/**
 * Returns every factor with an exact value and a salience score. Content is
 * derived from the scorer; only the ORDERING for display is heuristic.
 */
export function decomposeFactors(player, roster, ctx, timing) {
  const before = teamCategoryProbs(roster, ctx);
  const after = teamCategoryProbs([...roster, player], ctx);

  const catDeltas = Object.keys(after)
    .map((k) => ({ cat: k, delta: after[k] - before[k] }))
    .sort((a, b) => b.delta - a.delta);

  const total = catDeltas.reduce((s, c) => s + Math.max(0, c.delta), 0);
  const factors = [];

  // --- 1. Category contribution -------------------------------------------
  const top = catDeltas.filter((c) => c.delta > 0.004).slice(0, 2);
  if (top.length) {
    const names = top.map((c) => CAT_LABEL[c.cat] || c.cat).join(' and ');
    const share = total > 0
      ? top.reduce((s, c) => s + c.delta, 0) / total : 0;
    factors.push({
      key: 'categories',
      label: `Moves ${names}`,
      detail: top.map((c) => ({
        category: CAT_LABEL[c.cat] || c.cat,
        winProbBefore: before[c.cat],
        winProbAfter: after[c.cat],
      })),
      salience: Math.min(1, total * 6) * (0.5 + 0.5 * share),
    });
  }

  // --- 2. Urgency (survival) ----------------------------------------------
  if (timing) {
    const goneBy = 1 - timing.survival;
    factors.push({
      key: 'urgency',
      label: goneBy > 0.7
        ? `${Math.round(goneBy * 100)}% gone by pick ${timing.nextPick}`
        : `Likely still here at ${timing.nextPick} (${Math.round(timing.survival * 100)}%)`,
      detail: { survival: timing.survival, nextPick: timing.nextPick },
      // Salience peaks at genuine uncertainty. A lock either way is not news.
      salience: 1 - Math.abs(timing.survival - 0.5) * 1.6,
    });
  }

  // --- 3. Positional cliff -------------------------------------------------
  if (timing?.nextBestSamePos != null) {
    const drop = timing.marginalValue - timing.nextBestSamePos;
    const rel = timing.marginalValue > 1e-6 ? drop / timing.marginalValue : 0;
    if (rel > 0.08) {
      factors.push({
        key: 'cliff',
        label: `Next ${primaryPos(player)} available is ~${Math.round(rel * 100)}% worse`,
        detail: { drop, relative: rel },
        salience: Math.min(1, rel * 2.2),
      });
    }
  }

  // --- 4. Roster slot ------------------------------------------------------
  const openBefore = openSlots(roster, ctx.config);
  const openAfter = openSlots([...roster, player], ctx.config);
  if (openAfter < openBefore) {
    const filled = (player.posList || []).find((p) => slotGap(roster, ctx.config)[p] > 0);
    factors.push({
      key: 'slot',
      label: `Fills an open ${filled || primaryPos(player)} slot`,
      detail: { openBefore, openAfter },
      salience: 0.45,
    });
  } else {
    factors.push({
      key: 'slot',
      label: 'Bench — plays mainly on your off nights',
      detail: { openBefore, openAfter },
      salience: 0.55,
    });
  }

  // --- 5. Off-night schedule ----------------------------------------------
  if (player._offShare != null && ctx.meanOffShare != null) {
    const edge = player._offShare - ctx.meanOffShare;
    if (Math.abs(edge) > 0.04) {
      factors.push({
        key: 'schedule',
        label: edge > 0
          ? `${Math.round(player._offShare * 100)}% off-night games — starts more often`
          : `Only ${Math.round(player._offShare * 100)}% off-night games — often blocked`,
        detail: { offShare: player._offShare, leagueMean: ctx.meanOffShare },
        salience: Math.min(1, Math.abs(edge) * 5),
      });
    }
  }

  // --- 6. Market disagreement (DIFF) --------------------------------------
  // Board rank is derived from the projections, so this is a TIMING read, not
  // a value one: it says how many rounds of slack the market is giving you.
  if (player._diff != null && Math.abs(player._diff) >= 0.5) {
    const rounds = Math.abs(player._diff).toFixed(1);
    factors.push({
      key: 'market',
      label: player._diff < 0
        ? `Market is ${rounds} rounds behind your board`
        : `Market is ${rounds} rounds ahead of your board`,
      detail: { diff: player._diff },
      salience: Math.min(1, Math.abs(player._diff) / 2.5),
    });
  }

  return factors.sort((a, b) => b.salience - a.salience);
}

const primaryPos = (p) => (p.posList || ['?'])[0];

function slotGap(roster, config) {
  const { owner, slotPos } = assignLineup(roster, config);
  const gap = {};
  for (const pos of Object.keys(config.slots)) gap[pos] = 0;
  slotPos.forEach((pos, i) => { if (!owner[i]) gap[pos]++; });
  return gap;
}

const openSlots = (roster, config) =>
  assignLineup(roster, config).owner.filter((o) => !o).length;

// ---------------------------------------------------------------------------
// PICK 2 — SHAPE, NOT NAMES
// ---------------------------------------------------------------------------

/**
 * What the second pick should look like, given the first. Reports position
 * outlook and a probability-weighted name set rather than one prediction.
 */
function secondPickOutlook(rosterAfter, pool, pickNow, pickNext, ctx, cache) {
  const base = cache.get(rosterAfter, () => teamValue(rosterAfter, ctx));
  const depth = ctx.config.lookaheadDepth;

  const scored = pool.slice(0, depth).map((p) => ({
    player: p,
    m: teamValue([...rosterAfter, p], ctx) - base,
    s: survival(p, pickNow, pickNext, ctx),
  })).sort((a, b) => b.m - a.m);

  // Expected best survivor overall.
  let expected = 0, gone = 1;
  const likely = [];
  for (const c of scored) {
    const pFirst = c.s * gone;                 // P(he is the best one left)
    expected += c.m * pFirst;
    if (pFirst > 0.05) likely.push({ player: c.player, probBestAvailable: pFirst, marginalValue: c.m });
    gone *= (1 - c.s);
    if (gone < 0.001) break;
  }

  // Same calculation per position, which is what you actually plan around.
  const byPos = {};
  for (const pos of Object.keys(ctx.config.slots)) {
    const at = scored.filter((c) => (c.player.posList || []).includes(pos));
    let e = 0, g = 1;
    for (const c of at) { e += c.m * c.s * g; g *= (1 - c.s); if (g < 0.001) break; }
    byPos[pos] = { expectedValue: e, pAnyAvailable: 1 - g };
  }

  const bestPos = Object.entries(byPos).sort((a, b) => b[1].expectedValue - a[1].expectedValue)[0];

  return {
    expectedValue: expected,
    positionOutlook: byPos,
    likelyPosition: bestPos?.[0] ?? null,
    likelyPlayers: likely.slice(0, 5),
  };
}

// ---------------------------------------------------------------------------
// THE PANEL
// ---------------------------------------------------------------------------

/**
 * Main entry point for the live panel. Call on every draft state change,
 * debounced. Returns the pick to make now and the shape of the pick after it.
 *
 * state: { available, myRoster, pickNum, round, mySlot }
 */
export function planNextTwo(state, ctx, opts = {}) {
  const config = ctx.config;
  const branches = opts.branches ?? 6;
  const cache = makeCache();

  const picks = myPicks(state.mySlot, config);
  const turn = turnContext(state.pickNum, picks, config);
  const [pickNow, pickNext] = turn.picks;

  const ranked = recommend({ ...state, myPickNumbers: picks }, ctx);
  if (!ranked.length) return { turn, now: null, then: null };

  // Evaluate the joint two-pick path for the top few candidates only. Beyond
  // ~6 the ordering never changes and the cost is superlinear.
  const paths = ranked.slice(0, branches).map((c) => {
    const after = [...state.myRoster, c.player];
    const pool = state.available.filter((p) => p !== c.player);
    const outlook = secondPickOutlook(after, pool, pickNow, pickNext ?? pickNow + 99, ctx, cache);
    return { candidate: c, outlook, joint: c.marginalValue + outlook.expectedValue };
  }).sort((a, b) => b.joint - a.joint);

  const best = paths[0];
  const runnerUp = paths[1];

  // The pick `recommend` actually measured survival to: the first of my picks
  // strictly AFTER the current one (see its own `pickNext`). Off the clock
  // that is `pickNow` — this card's pick — while `turn.picks[1]` is a whole
  // round later, so labelling the survival with it attached the right
  // probability to the wrong pick on every pick that wasn't mine.
  const survivalPick = picks.find((n) => n > state.pickNum) ?? pickNow;

  const timing = {
    survival: best.candidate.survival,
    nextPick: survivalPick,
    pickNum: pickNow,
    marginalValue: best.candidate.marginalValue,
    nextBestSamePos: samePositionFallback(best.candidate, ranked, state, ctx),
  };

  return {
    turn,
    now: {
      player: best.candidate.player,
      marginalValue: best.candidate.marginalValue,
      survival: best.candidate.survival,
      score: best.candidate.score,
      factors: decomposeFactors(best.candidate.player, state.myRoster, ctx, timing).slice(0, 3),
      // How much better than the second-best path. Small means it does not
      // much matter, and the panel should say so rather than feign confidence.
      edge: runnerUp ? best.joint - runnerUp.joint : null,
      alternative: runnerUp?.candidate.player ?? null,
    },
    then: {
      atPick: pickNext,
      likelyPosition: best.outlook.likelyPosition,
      expectedValue: best.outlook.expectedValue,
      positionOutlook: best.outlook.positionOutlook,
      candidates: best.outlook.likelyPlayers,
      message: describeSecond(best.outlook, turn),
    },
    goalieAudit: ranked.goalieAudit ?? null,
  };
}

function samePositionFallback(cand, ranked, state, ctx) {
  const pos = new Set(cand.player.posList || []);
  const alt = ranked.find((r) =>
    r.player !== cand.player && (r.player.posList || []).some((p) => pos.has(p)));
  return alt ? alt.marginalValue : null;
}

function describeSecond(outlook, turn) {
  const pos = outlook.likelyPosition;
  const o = pos ? outlook.positionOutlook[pos] : null;
  if (turn.kind === 'turn') {
    return `Back-to-back picks — the second is near-certain, so this is an ordering call. `
      + `Take the scarcer position first; ${pos} should still be there.`;
  }
  if (!o) return 'No clear shape for the second pick yet.';
  const conf = o.pAnyAvailable > 0.85 ? 'comfortably' : o.pAnyAvailable > 0.6 ? 'probably' : 'possibly';
  return `Expect to be taking ${pos} — ${conf} available (${Math.round(o.pAnyAvailable * 100)}%). `
    + `Names are indicative only; plan the position, not the player.`;
}
