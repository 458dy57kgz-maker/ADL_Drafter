/**
 * ADL Drafter — draft value engine
 * ---------------------------------
 * Answers: "draft this player now, or can I wait?"
 *
 * Output unit for all value: EXPECTED CATEGORIES WON PER WEEK.
 * This is what lets skaters and goalies live on one scale without a bridge.
 *
 * Zero dependencies. ES module.
 */

// ---------------------------------------------------------------------------
// CONFIG
// ---------------------------------------------------------------------------

export const DEFAULT_CONFIG = {
  // --- League shape -------------------------------------------------------
  teamCount: 12,
  slots: { C: 2, LW: 2, RW: 2, D: 4, G: 2 },
  benchSlots: 4,
  totalRounds: 18,
  weeks: 23,                       // H2H matchup weeks in the season

  // --- Scoring categories -------------------------------------------------
  // Actual Yahoo cats: G A P PPP +/- SOG BLK | W GAA SV.
  //
  // NOTE: `blocks` is NOT in the current API schema. It must be added to the
  // import. It is a scoring category, it is the most week-to-week PREDICTABLE
  // category in the game, and it lives almost entirely in defensemen — of
  // which you roster four. Until it exists, every shutdown D is mispriced.
  //
  // NOTE: p is deterministic (p = g + a), so three of ten categories are one
  // underlying skill. Scoring cannot be punted, and elite forwards move three
  // columns with one pick. Treating p's variance independently understates its
  // correlation with g and a; harmless for EXPECTED cats won (expectation is
  // linear), but it would break any "probability of winning the week" model.
  //
  // dispersion    = weekly noise, var = dispersion * mean
  // projUncertain = sd of the season projection as a fraction of the mean
  categories: [
    { key: 'g',         pop: 'skater', invert: false, dispersion: 1.25, projUncertain: 0.28 },
    { key: 'a',         pop: 'skater', invert: false, dispersion: 1.15, projUncertain: 0.25 },
    { key: 'p',         pop: 'skater', invert: false, dispersion: 1.15, projUncertain: 0.24 },
    { key: 'ppp',       pop: 'skater', invert: false, dispersion: 1.35, projUncertain: 0.35 },
    { key: 'plusMinus', pop: 'skater', invert: false, dispersion: null, projUncertain: 1.20 },
    { key: 'shots',     pop: 'skater', invert: false, dispersion: 1.05, projUncertain: 0.20 },
    { key: 'blocks',    pop: 'skater', invert: false, dispersion: 1.00, projUncertain: 0.22 },
    { key: 'w',         pop: 'goalie', invert: false, dispersion: 0.85, projUncertain: 0.32 },
    { key: 'saves',     pop: 'goalie', invert: false, dispersion: 1.10, projUncertain: 0.30 },
    { key: 'gaa',       pop: 'goalie', invert: true,  dispersion: null, projUncertain: 0.18 },
  ],

  // Stats are next-season PROJECTIONS, so no aging curve is needed. But
  // projections are pre-regressed toward the mean, which compresses the spread
  // between players. Expect the model to look flatter than reality feels.
  projUncertaintyWeight: 1.0,      // dial 0 to ignore projection error entirely

  // --- Estimation constants ----------------------------------------------
  savesPerStart: 28,               // recovers a GP denominator for GAA
  plusMinusVarPerGame: 4.0,        // +/- is not Poisson; additive per-game var
  gamesPerWeek: 3.4,               // NHL average
  imputedVarPenalty: 1.5,          // widen variance on imputed stats

  // --- ADP survival model -------------------------------------------------
  adpSigmaBase: 3.0,
  adpSigmaSlope: 0.18,             // sigma = base + slope * adp
  adpSigmaImputedMult: 1.6,        // wider when ADP was derived from rank
  lateAdpCorrection: 0.10,         // corrects survivorship bias in public ADP
  lateAdpThreshold: 120,
  driftWindow: 15,                 // rolling picks used to detect room drift
  driftShrinkage: 8,               // pseudo-count shrinking pos drift to global

  // --- Opponent model -----------------------------------------------------
  opponentSpread: 0.18,            // between-team sd as fraction of league mean

  // --- Replacement level --------------------------------------------------
  // Multiplier on (teamCount * starterSlots). This is THE lever for "position
  // X is streamable off waivers" — a deeper replacement level shrinks every
  // elite player's surplus at that position.
  //
  // Reality check before raising G: 12 teams * 2 G = 24 rostered starters and
  // the NHL has ~32. Setting G to 1.5 asserts the 36th-best goalie is freely
  // available, i.e. backups. Verify against last season's rostered-goalie
  // count before trusting it.
  replacementDepth: { C: 1.0, LW: 1.0, RW: 1.0, D: 1.0, G: 1.5 },

  // --- Daily lineups & off-night games ------------------------------------
  // Daily lineups mean the bench is NOT dead weight — rostered players rotate
  // in whenever starters are idle, which happens most on off nights. ONG is
  // therefore not a score bonus; it drives the share of a player's projected
  // production that actually lands in your lineup. Mean and variance scale
  // together, which keeps the win-probability math intact.
  seasonGames: 82,                 // fallback denominator when `gp` is absent
  onNightStartProb: 0.88,          // P(start | playing, heavy night) for a starter
  benchUtilization: 0.70,          // P(slot free | bench player is playing)
  ongWeight: 1.0,                  // 0 ignores ONG, 1 applies it fully

  // --- Goalie policy ------------------------------------------------------
  // 'off'  — parameters only, no rule
  // 'soft' — allow, but report what the rule would have cost (recommended)
  // 'hard' — filter goalies out before minRound
  goaliePolicy: { mode: 'soft', minRound: 4 },

  // --- Search -------------------------------------------------------------
  candidateCount: 20,              // players scored in full each pick
  lookaheadDepth: 40,              // pool size for expected-best-available
};

// ---------------------------------------------------------------------------
// MATH HELPERS
// ---------------------------------------------------------------------------

/** Abramowitz & Stegun 7.1.26 error function approximation. */
function erf(x) {
  const s = Math.sign(x);
  x = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * x);
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t
    - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return s * y;
}

export const normCdf = (z) => 0.5 * (1 + erf(z / Math.SQRT2));

const median = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

const isGoalie = (p) => (p.posList || []).includes('G');

// ---------------------------------------------------------------------------
// CONTEXT — precomputed once per import, refreshed cheaply during the draft
// ---------------------------------------------------------------------------

/**
 * Build the derived data the scorer needs: imputed stats, imputed ADP,
 * replacement levels, and the league-average opponent.
 */
export function buildContext(players, config = DEFAULT_CONFIG) {
  const ctx = { config, driftSamples: [] };

  // Cache population + a raw scalar value used only to ORDER things
  // (lineup matching, replacement level). Category-win value is computed later.
  for (const p of players) p._goalie = isGoalie(p);

  imputeStats(players, config);
  ctx.adpModel = fitAdpModel(players);
  for (const p of players) {
    const est = estimateAdp(p, ctx.adpModel, config);
    p._adpMean = est.mean;
    p._adpSigma = est.sigma;
  }

  ctx.rawValue = buildRawValueScale(players, config);
  for (const p of players) {
    // Imported VORP (sum of z-scores over replacement) is a better ordering
    // than the internal z-score sum. It is used ONLY for ordering — lineup
    // matching and replacement indexing — never as the score. marginalValue
    // computes replacement-relative value dynamically against your actual
    // roster and category standings; a static VORP would overwrite that.
    p._raw = p.vorp != null ? p.vorp : ctx.rawValue(p);

    const gp = p.gp ?? config.seasonGames;
    p._offShare = (p.ong != null && gp > 0) ? Math.min(1, p.ong / gp) : null;

    // DIFF is timing, not value. Board rank is derived from the projections,
    // so a value bonus here would count ADP twice. Display factor only.
    p._diff = (p.overallRank != null && p.adp != null)
      ? (p.overallRank - p.adp) / config.teamCount : null;
  }

  const shares = players.map((p) => p._offShare).filter((v) => v != null);
  ctx.meanOffShare = shares.length
    ? shares.reduce((s, v) => s + v, 0) / shares.length : 0.40;

  ctx.replacement = computeReplacementLevels(players, config);
  ctx.opponent = computeLeagueAverageTeam(players, ctx);

  return ctx;
}

/**
 * Null handling. Two distinct cases, and conflating them is a real bug:
 *   - CROSS-POPULATION null (skater's `w`) is a structural zero. Correct as 0.
 *   - SAME-POPULATION null (skater with no `ppp`) is missing data. Impute from
 *     the nearest cohort by overallRank at the same position, and flag it so
 *     the variance model can widen accordingly.
 */
function imputeStats(players, config) {
  const statKeys = config.categories.map((c) => c.key);

  for (const p of players) {
    p._imputed = new Set();
    const pop = p._goalie ? 'goalie' : 'skater';

    for (const cat of config.categories) {
      if (cat.pop !== pop) continue;                 // structural zero, leave null
      if (p[cat.key] != null) continue;

      const cohort = players
        .filter((q) =>
          q._goalie === p._goalie &&
          q[cat.key] != null &&
          q.overallRank != null && p.overallRank != null &&
          Math.abs(q.overallRank - p.overallRank) <= 15)
        .map((q) => q[cat.key]);

      const fallback = players
        .filter((q) => q._goalie === p._goalie && q[cat.key] != null)
        .map((q) => q[cat.key]);

      p[cat.key] = median(cohort.length >= 4 ? cohort : fallback) ?? 0;
      p._imputed.add(cat.key);
    }
  }
  return statKeys;
}

/** Linear fit adp ~ overallRank, so players missing ADP still get a timing model. */
function fitAdpModel(players) {
  const pts = players.filter((p) => p.adp != null && p.overallRank != null);
  if (pts.length < 10) return { slope: 1, intercept: 0 };
  const n = pts.length;
  const sx = pts.reduce((s, p) => s + p.overallRank, 0);
  const sy = pts.reduce((s, p) => s + p.adp, 0);
  const sxy = pts.reduce((s, p) => s + p.overallRank * p.adp, 0);
  const sxx = pts.reduce((s, p) => s + p.overallRank ** 2, 0);
  const slope = (n * sxy - sx * sy) / (n * sxx - sx * sx || 1);
  return { slope, intercept: (sy - slope * sx) / n };
}

function estimateAdp(p, model, config) {
  let mean, imputed = false;
  if (p.adp != null) {
    mean = p.adp;
  } else if (p.overallRank != null) {
    mean = model.intercept + model.slope * p.overallRank;
    imputed = true;
  } else {
    return { mean: 999, sigma: 60 };
  }

  // Public ADP means are usually computed only over drafts where the player was
  // actually taken, which biases late-round ADP early. Push it back out.
  mean += config.lateAdpCorrection * Math.max(0, mean - config.lateAdpThreshold);

  let sigma = config.adpSigmaBase + config.adpSigmaSlope * mean;
  if (imputed) sigma *= config.adpSigmaImputedMult;
  return { mean, sigma };
}

/**
 * A crude scalar used ONLY for ordering (matching + replacement level).
 * Category-win value is the real currency; this just needs to be monotone.
 */
function buildRawValueScale(players, config) {
  const stats = {};
  for (const cat of config.categories) {
    const pool = players.filter((p) => (cat.pop === 'goalie') === p._goalie);
    const vals = pool.map((p) => p[cat.key]).filter((v) => v != null);
    const mean = vals.reduce((s, v) => s + v, 0) / (vals.length || 1);
    const sd = Math.sqrt(vals.reduce((s, v) => s + (v - mean) ** 2, 0) / (vals.length || 1)) || 1;
    stats[cat.key] = { mean, sd, invert: cat.invert };
  }
  return (p) => {
    const pop = p._goalie ? 'goalie' : 'skater';
    let z = 0;
    for (const cat of config.categories) {
      if (cat.pop !== pop || p[cat.key] == null) continue;
      const s = stats[cat.key];
      z += (cat.invert ? -1 : 1) * ((p[cat.key] - s.mean) / s.sd);
    }
    return z;
  };
}

/**
 * Replacement level per position = the player you can still get at the end.
 * Indexed at (teamCount * starterSlots) deep in that position's board.
 */
/**
 * Replacement level per position.
 *
 * VORP is zero at the replacement player by construction, so when it is
 * present the baseline is read straight out of your data rather than guessed
 * from a depth multiplier. This is also the single place your goalie belief
 * now lives: if you think the wire is deep, compute goalie VORP against a
 * deeper baseline and the model inherits it.
 */
function computeReplacementLevels(players, config) {
  const out = {};
  for (const pos of Object.keys(config.slots)) {
    const pool = players
      .filter((p) => (p.posList || []).includes(pos))
      .sort((a, b) => b._raw - a._raw);
    if (!pool.length) { out[pos] = null; continue; }

    const hasVorp = pool.some((p) => p.vorp != null);
    if (hasVorp) {
      // First player at or below zero VORP is the replacement definition.
      const crossing = pool.find((p) => p.vorp != null && p.vorp <= 0);
      out[pos] = crossing || pool[pool.length - 1];
      continue;
    }

    const depth = config.replacementDepth?.[pos] ?? 1.0;
    const idx = Math.min(
      pool.length - 1,
      Math.round(config.teamCount * config.slots[pos] * depth));
    out[pos] = pool[Math.max(0, idx)] || null;
  }
  return out;
}

// ---------------------------------------------------------------------------
// WEEKLY DISTRIBUTIONS
// ---------------------------------------------------------------------------

/**
 * Convert a season stat line into a weekly mean and variance per category.
 * Season totals already encode games missed, so dividing by weeks is honest.
 */
function weeklyLine(p, config) {
  const pop = p._goalie ? 'goalie' : 'skater';
  const mean = {}, variance = {};

  for (const cat of config.categories) {
    if (cat.pop !== pop) { mean[cat.key] = 0; variance[cat.key] = 0; continue; }

    if (cat.key === 'gaa') continue;                 // handled via GA/starts below

    const wk = (p[cat.key] ?? 0) / config.weeks;
    mean[cat.key] = wk;

    let v;
    if (cat.key === 'plusMinus') {
      // +/- can go negative; variance scales with games, not with the mean.
      v = config.plusMinusVarPerGame * config.gamesPerWeek;
    } else {
      v = (cat.dispersion ?? 1) * Math.abs(wk);
    }

    // Projection error does not average out across weeks — it's the same error
    // every week — so it belongs in the denominator of every matchup. Effect:
    // uncertain edges shrink toward a coin flip. This is the secondary lever on
    // goalies, whose projections (GAA especially) are genuinely less reliable.
    const pu = (cat.projUncertain ?? 0) * config.projUncertaintyWeight;
    v += (Math.abs(wk) * pu) ** 2;

    if (p._imputed?.has(cat.key)) v *= config.imputedVarPenalty;
    variance[cat.key] = v;
  }

  // GAA needs a denominator the data doesn't have. Recover starts from saves.
  if (pop === 'goalie') {
    const starts = (p.saves ?? 0) / config.savesPerStart;
    const ga = (p.gaa ?? 0) * starts;
    mean._ga = ga / config.weeks;
    mean._starts = starts / config.weeks;
    variance._ga = 1.2 * Math.abs(mean._ga);
    variance._starts = 0.15 * Math.abs(mean._starts);
  } else {
    mean._ga = 0; mean._starts = 0; variance._ga = 0; variance._starts = 0;
  }

  return { mean, variance };
}

/** Aggregate weighted roster entries into team-level weekly mean/variance.
 *  entries: [{ player, weight }] where weight is expected start rate. */
function teamDistribution(entries, config) {
  const mean = {}, variance = {};
  for (const cat of config.categories) { mean[cat.key] = 0; variance[cat.key] = 0; }
  let ga = 0, gaVar = 0, starts = 0, startsVar = 0;

  for (const e of entries) {
    const p = e?.player ?? e;
    if (!p) continue;
    const wt = e?.weight ?? 1;
    const w = p._weekly || (p._weekly = weeklyLine(p, config));
    for (const cat of config.categories) {
      if (cat.key === 'gaa') continue;
      mean[cat.key] += (w.mean[cat.key] || 0) * wt;
      variance[cat.key] += (w.variance[cat.key] || 0) * wt;
    }
    ga += w.mean._ga * wt; gaVar += w.variance._ga * wt;
    starts += w.mean._starts * wt; startsVar += w.variance._starts * wt;
  }

  if (config.categories.some((c) => c.key === 'gaa')) {
    const s = Math.max(starts, 0.25);
    mean.gaa = ga / s;
    // Delta method for the variance of a ratio of two random sums.
    variance.gaa = gaVar / (s * s) + (ga * ga * startsVar) / (s ** 4);
  }
  return { mean, variance };
}

/** The average opponent: the league's starter pool divided by team count. */
function computeLeagueAverageTeam(players, ctx) {
  const config = ctx.config;
  const starters = [];
  for (const [pos, n] of Object.entries(config.slots)) {
    const pool = players
      .filter((p) => (p.posList || []).includes(pos))
      .sort((a, b) => b._raw - a._raw)
      .slice(0, n * config.teamCount);
    starters.push(...pool);
  }
  const typical = ctx.meanOffShare + (1 - ctx.meanOffShare) * config.onNightStartProb;
  const agg = teamDistribution(starters.map((p) => ({ player: p, weight: typical })), config);
  const mean = {}, variance = {};
  for (const cat of config.categories) {
    if (cat.key === 'gaa') { mean.gaa = agg.mean.gaa; variance.gaa = agg.variance.gaa; continue; }
    mean[cat.key] = agg.mean[cat.key] / config.teamCount;
    variance[cat.key] = agg.variance[cat.key] / config.teamCount;
  }
  return { mean, variance };
}

/**
 * Expected start rate for one rostered player. Under daily lineups a bench
 * player is not worth zero — he slots in whenever a starter is idle, which is
 * precisely what off-night games measure. ONG therefore separates two bench
 * players who look identical on talent alone.
 */
export function startRate(player, isStarter, ctx) {
  const { config, meanOffShare } = ctx;
  const raw = player._offShare == null ? meanOffShare : player._offShare;
  const off = meanOffShare + config.ongWeight * (raw - meanOffShare);
  return isStarter
    ? off + (1 - off) * config.onNightStartProb
    : off * config.benchUtilization;
}

// ---------------------------------------------------------------------------
// LINEUP ASSIGNMENT — max-weight bipartite matching
// ---------------------------------------------------------------------------

/**
 * Replaces the greedy C -> LW -> RW -> D -> G walk, which strands value:
 * two centres plus a C/LW fill both C slots and bench a starter while LW sits
 * empty. Slot assignment is a transversal matroid, so processing players in
 * descending value with augmenting paths is provably optimal.
 *
 * Returns { lineup, benched }.
 */
export function assignLineup(roster, config = DEFAULT_CONFIG) {
  const slotPos = [];
  for (const [pos, n] of Object.entries(config.slots)) {
    for (let i = 0; i < n; i++) slotPos.push(pos);
  }
  const owner = new Array(slotPos.length).fill(null);
  const sorted = [...roster].sort((a, b) => (b._raw ?? 0) - (a._raw ?? 0));

  const tryPlace = (player, seen) => {
    for (let s = 0; s < slotPos.length; s++) {
      if (seen[s] || !(player.posList || []).includes(slotPos[s])) continue;
      seen[s] = true;
      if (owner[s] === null || tryPlace(owner[s], seen)) { owner[s] = player; return true; }
    }
    return false;
  };

  const benched = [];
  for (const p of sorted) {
    if (!tryPlace(p, new Array(slotPos.length).fill(false))) benched.push(p);
  }
  return { lineup: owner.filter(Boolean), benched, slotPos, owner };
}

/** Fill empty starter slots with replacement-level players so early-round
 *  rosters are compared as complete teams, and weight every rostered player
 *  by expected start rate so the bench contributes its real share. */
function completeRoster(roster, ctx) {
  const { owner, slotPos } = assignLineup(roster, ctx.config);
  const starters = new Set(owner.filter(Boolean));
  const entries = roster.map((p) => ({ player: p, weight: startRate(p, starters.has(p), ctx) }));
  for (let s = 0; s < owner.length; s++) {
    if (owner[s]) continue;
    const r = ctx.replacement[slotPos[s]];
    if (r) entries.push({ player: r, weight: startRate(r, true, ctx) });
  }
  return entries;
}

// ---------------------------------------------------------------------------
// TEAM VALUE — expected categories won per week
// ---------------------------------------------------------------------------

/** Per-category win probability for a roster. The explanation layer diffs
 *  these to say WHICH categories a player is actually moving. */
export function teamCategoryProbs(roster, ctx) {
  const { config, opponent } = ctx;
  const me = teamDistribution(completeRoster(roster, ctx), config);
  const out = {};
  for (const cat of config.categories) {
    const spread = (opponent.mean[cat.key] * config.opponentSpread) ** 2;
    const denom = Math.sqrt(
      (me.variance[cat.key] || 0) + (opponent.variance[cat.key] || 0) + spread) || 1e-6;
    let d = ((me.mean[cat.key] || 0) - (opponent.mean[cat.key] || 0)) / denom;
    if (cat.invert) d = -d;                          // GAA: lower is better
    out[cat.key] = normCdf(d);
  }
  return out;
}

export function teamValue(roster, ctx) {
  const probs = teamCategoryProbs(roster, ctx);
  let total = 0;
  for (const k in probs) total += probs[k];
  return total;
}

/** Marginal value of adding a player, in categories-won-per-week.
 *  In H2H only starters score, so a third centre with both C slots filled
 *  scores near zero automatically. No hand-tuned bench discount needed. */
export function marginalValue(player, roster, ctx, base = null) {
  const b = base ?? teamValue(roster, ctx);
  return teamValue([...roster, player], ctx) - b;
}

// ---------------------------------------------------------------------------
// TIMING — survival probability
// ---------------------------------------------------------------------------

/** Feed every completed pick in so the model learns how this room actually
 *  drafts. Highest value per line of code in the whole module. */
export function recordPick(ctx, player, actualPick) {
  ctx.driftSamples.push({
    delta: actualPick - (player._adpMean ?? actualPick),
    pos: player._goalie ? 'G' : ((player.posList || [])[0] === 'D' ? 'D' : 'F'),
  });
}

function drift(ctx, player) {
  const w = ctx.config.driftWindow;
  const recent = ctx.driftSamples.slice(-w);
  if (!recent.length) return 0;
  const global = recent.reduce((s, r) => s + r.delta, 0) / recent.length;

  const group = player._goalie ? 'G' : ((player.posList || [])[0] === 'D' ? 'D' : 'F');
  const sub = recent.filter((r) => r.pos === group);
  if (!sub.length) return global;

  // Shrink the positional estimate toward global when the sample is thin.
  const k = ctx.config.driftShrinkage;
  const subMean = sub.reduce((s, r) => s + r.delta, 0) / sub.length;
  return (sub.length * subMean + k * global) / (sub.length + k);
}

/**
 * P(still available at my next pick | still available right now).
 * The conditioning is what stops the model writing off an obvious faller.
 */
export function survival(player, pickNow, pickNext, ctx) {
  const mu = player._adpMean + drift(ctx, player);
  const sigma = Math.max(player._adpSigma, 1);
  const tailNext = 1 - normCdf((pickNext - mu) / sigma);
  const tailNow = 1 - normCdf((pickNow - mu) / sigma);
  return Math.min(1, tailNext / Math.max(tailNow, 1e-4));
}

/** My pick numbers across the whole snake draft. */
export function myPicks(mySlot, config = DEFAULT_CONFIG) {
  const N = config.teamCount, out = [];
  for (let r = 1; r <= config.totalRounds; r++) {
    out.push((r - 1) * N + (r % 2 === 1 ? mySlot : N - mySlot + 1));
  }
  return out;
}

// ---------------------------------------------------------------------------
// THE DECISION
// ---------------------------------------------------------------------------

/**
 * Expected value of the best player still on the board at my next pick,
 * given the roster I would have after taking `taken` now.
 *
 *   E = sum_k  M_k * S_k * prod_{j<k} (1 - S_j)
 */
function expectedBestAvailable(pool, roster, pickNow, pickNext, ctx) {
  const base = teamValue(roster, ctx);
  const scored = pool
    .slice(0, ctx.config.lookaheadDepth)
    .map((p) => ({
      p,
      m: marginalValue(p, roster, ctx, base),
      s: survival(p, pickNow, pickNext, ctx),
    }))
    .sort((a, b) => b.m - a.m);

  let expected = 0, gone = 1;
  for (const c of scored) {
    expected += c.m * c.s * gone;
    gone *= (1 - c.s);
    if (gone < 0.001) break;
  }
  return { expected, best: scored[0] || null };
}

/**
 * Rank the board. Returns candidates sorted by two-pick-lookahead score.
 *
 *   Score_i = M_i + E[best available at next pick | I took i]
 *
 * The second term is recomputed against the post-pick roster, so taking a
 * centre genuinely depresses every other centre's future value. That coupling
 * is what stops the model reaching for scarce positions.
 */
export function recommend(state, ctx) {
  const { available, myRoster, pickNum, myPickNumbers, round } = state;
  const config = ctx.config;

  const pickNext = myPickNumbers.find((n) => n > pickNum) ?? (pickNum + 999);
  const base = teamValue(myRoster, ctx);

  // Endgame feasibility: once picks left barely covers unfilled starter slots,
  // filling slots outranks everything. Two goalies needed with three picks
  // left has to dominate value.
  const { owner, slotPos } = assignLineup(myRoster, config);
  const unfilled = owner.reduce((n, o) => n + (o ? 0 : 1), 0);
  const picksLeft = config.totalRounds - round + 1;
  const needPositions = new Set(slotPos.filter((_, i) => !owner[i]));

  let pool = [...available].sort((a, b) => (b._raw ?? 0) - (a._raw ?? 0));
  const mustFill = picksLeft <= unfilled + 1 && unfilled > 0;
  if (mustFill) {
    pool = pool.filter((p) => (p.posList || []).some((x) => needPositions.has(x)));
  }

  // Goalie policy. Prefer tuning replacementDepth.G and projUncertainty — a
  // hard rule also blocks the good-team-goalie / volume-goalie pairing the
  // model can otherwise find on its own. 'soft' keeps the rule visible so you
  // can audit whether the bias is actually earning anything.
  const gp = config.goaliePolicy || { mode: 'off' };
  let goalieAudit = null;
  if (gp.mode !== 'off' && round < gp.minRound && !mustFill) {
    const topGoalie = pool.find((p) => p._goalie);
    if (topGoalie) {
      goalieAudit = {
        player: topGoalie,
        marginalValue: marginalValue(topGoalie, myRoster, ctx, base),
        survival: survival(topGoalie, pickNum, pickNext, ctx),
        note: `Suppressed by goalie policy until round ${gp.minRound}.`,
      };
    }
    if (gp.mode === 'hard') pool = pool.filter((p) => !p._goalie);
  }

  const candidates = pool.slice(0, config.candidateCount).map((player) => {
    const m = marginalValue(player, myRoster, ctx, base);
    const s = survival(player, pickNum, pickNext, ctx);
    const after = [...myRoster, player];
    const rest = pool.filter((q) => q !== player);
    const { expected, best } = expectedBestAvailable(rest, after, pickNum, pickNext, ctx);

    // Cost of waiting: not the decision rule, but the number to SHOW.
    // Pure COW over-drafts scarce positions; it explains well, it decides badly.
    const fallback = best ? best.m : 0;
    const cow = (1 - s) * Math.max(0, m - fallback);

    return {
      player,
      marginalValue: m,
      survival: s,
      score: m + expected,
      costOfWaiting: cow,
      nextBest: best?.p ?? null,
      reason: explain(player, m, s, best, mustFill),
    };
  });

  const ranked = candidates.sort((a, b) => b.score - a.score);

  // Attach the audit so the UI can show the cost of the rule: if the
  // suppressed goalie's marginal value keeps beating your top skater, the
  // bias is expensive and replacementDepth.G is set too deep.
  if (goalieAudit) {
    goalieAudit.costVsTop = goalieAudit.marginalValue - (ranked[0]?.marginalValue ?? 0);
    ranked.goalieAudit = goalieAudit;
  }
  return ranked;
}

function explain(player, m, s, best, mustFill) {
  const pct = Math.round((1 - s) * 100);
  if (mustFill) return `Roster constraint: must fill ${player.posList.join('/')} before the draft ends.`;
  if (s > 0.75) return `${pct}% chance he's gone, and your board is deep here. Wait.`;
  const gap = best ? (m - best.m) : 0;
  const rel = best && best.m > 0 ? Math.round((gap / Math.max(m, 1e-6)) * 100) : 0;
  if (s < 0.25) return `${pct}% chance he's gone, and your next-best option is ~${rel}% worse. Take him.`;
  return `${pct}% chance he's gone. Next-best is ~${rel}% worse.`;
}

// ---------------------------------------------------------------------------
// PUNT DETECTION
// ---------------------------------------------------------------------------

/**
 * The win-probability derivative has a local-optimum trap: at P_c ~= 0.2 the
 * derivative is small, so the model never invests in the category, but it also
 * never formally abandons it and frees the budget. Punting is far stronger in
 * H2H cats than in roto, so surface it explicitly every few rounds.
 */
export function puntAnalysis(myRoster, ctx) {
  const { config, opponent } = ctx;
  const me = teamDistribution(completeRoster(myRoster, ctx), config);

  return config.categories.map((cat) => {
    const spread = (opponent.mean[cat.key] * config.opponentSpread) ** 2;
    const denom = Math.sqrt(
      (me.variance[cat.key] || 0) + (opponent.variance[cat.key] || 0) + spread) || 1e-6;
    let d = ((me.mean[cat.key] || 0) - (opponent.mean[cat.key] || 0)) / denom;
    if (cat.invert) d = -d;
    const p = normCdf(d);

    // Marginal return on investment is dP/dmu = phi(d)/sigma. The 1/sigma term
    // is essential: without it a coin-flip category looks maximally valuable
    // just because it is close. Plus/minus is contested but UNCONTROLLABLE —
    // its sigma is huge, so dividing by it correctly sinks it to the bottom.
    // Scaled by a replacement starter's weekly contribution so the number is
    // comparable across categories with wildly different units.
    const typical = Math.abs(opponent.mean[cat.key] || 0) / 12;
    const leverage = (Math.exp(-(d ** 2) / 2) / Math.sqrt(2 * Math.PI))
      * (typical / denom);

    return {
      category: cat.key,
      winProb: p,
      leverage,
      verdict: p > 0.80 ? 'locked' : p < 0.22 ? 'punt candidate' : 'contested',
    };
  }).sort((a, b) => b.leverage - a.leverage);
}
