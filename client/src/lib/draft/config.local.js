/**
 * Local config overrides.
 *
 * Anything here wins over DEFAULT_CONFIG in draftValue.js. Keep YOUR settings
 * in this file and never edit draftValue.js directly — that way dropping in a
 * new engine version can't wipe your league setup again.
 *
 * Only list what differs from the defaults.
 *
 * ---------------------------------------------------------------------------
 * ONE EXCEPTION, and it is the important one: anything the app already has a
 * settings screen for is owned by the app, not by this file. That is
 * `seasonTargets` (Settings > Roster > Targets) and the league shape —
 * `teamCount`, `slots`, `benchSlots`, `totalRounds` (Settings > League and
 * Settings > Roster). Setting those here does nothing except log a warning:
 * a hidden file silently overriding a value you can see and edit in the UI is
 * the kind of thing you debug for an hour.
 *
 * Everything else below is yours, and takes effect on the next build.
 * ---------------------------------------------------------------------------
 */

export default {
  // How much to trust the targets over the pool-derived estimate.
  // 0 ignores them entirely, 1 trusts them completely.
  targetBlend: 0.6,

  // Targets describe a WINNING team rather than an average one, so the engine
  // discounts them back toward the middle by `targetWinMargin` before folding
  // them into the opponent model.
  targetIsWinThreshold: true,

  // The targets themselves live in Settings > Roster > Targets and reach the
  // engine live — edit one there and the recommendation re-blends without a
  // rebuild or a reload. They are listed here only as a record of what the
  // numbers were when this file was written:
  //   g 300 · a 500 · ppp 240 · shots 2300 · blocks 800 · w 70 · saves 3500
  //
  // Note the app also carries a +/- target, which is deliberately NOT sent:
  // the engine's own guidance is to omit derived (p) and non-cumulative
  // (gaa, +/-) categories, since a target only makes sense for something that
  // accumulates toward a season total.

  // --- League shape -------------------------------------------------------
  // Owned by the app — set these in Settings > League and Settings > Roster.

  // --- Behaviour knobs ----------------------------------------------------
  // baselineMode: 'blend',                    // 'replacement' | 'average' | 'blend'
  // goaliePolicy: { mode: 'soft', minRound: 4 },
  // ongWeight: 1.0,
  // replacementDepth: { C: 1.0, LW: 1.0, RW: 1.0, D: 1.0, G: 1.5 },
};
