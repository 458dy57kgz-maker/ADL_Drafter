/**
 * Draft plan worker
 * -----------------
 * Owns the value engine's context and the only copy of the player pool the
 * engine ever touches.
 *
 * Why the pool never crosses back: `buildContext` decorates each player with
 * derived state (`_adpMean`, `_weekly`, `_imputed` as a Set, `_raw`), and both
 * `recommend` and `planNextTwo` compare players by object identity — e.g.
 * `pool.filter((q) => q !== player)`. Structured-cloning players across the
 * boundary would break identity and throw the derived state away, so the main
 * thread addresses players by NAME and the worker resolves them locally.
 * Name is also the right key for a second reason: ids are not stable across a
 * re-import.
 *
 * Messages in:
 *   { type: 'build', players, config }   — rebuild context (import / edit)
 *   { type: 'plan', id, state }          — state: { pickNum, round, mySlot,
 *                                          draftedNames, myRosterNames, picks }
 * Messages out:
 *   { type: 'ready', count }
 *   { type: 'quick', id, ... }           — synchronous recommend(), first
 *   { type: 'plan', id, ... }            — full planNextTwo()
 *   { type: 'error', id, message }
 */

import { DEFAULT_CONFIG, buildContext, recommend, myPicks, recordPick } from '../lib/draft/draftValue.js';
import { planNextTwo } from '../lib/draft/draftPlan.js';

let ctx = null;
let players = [];
let byName = new Map();
/** Pick numbers already fed to the drift model, so a replay can't double-count. */
let recordedPicks = [];

const key = (name) => String(name ?? '').trim().toLowerCase();

function build(rawPlayers, configPatch) {
  const config = { ...DEFAULT_CONFIG, ...configPatch };
  // Own copies: the engine mutates what it is given, and these objects outlive
  // any single message.
  players = rawPlayers.map((p) => ({ ...p }));
  byName = new Map(players.map((p) => [key(p.name), p]));
  ctx = buildContext(players, config);
  recordedPicks = [];
  return { count: players.length };
}

/**
 * Replays the authoritative pick list into the drift model.
 *
 * `recordPick` has to see every completed pick by every team — it is how the
 * model learns that this room is reaching on defensemen — and an 8-second poll
 * cannot be trusted to observe each pick as it happens. So rather than firing
 * on an event we might miss, we diff against the server's full pick list every
 * sync: new picks are appended, and anything else (an undo, a draft reset, a
 * re-import) rebuilds the sample set from scratch.
 */
function syncPicks(picks) {
  const sorted = [...picks].sort((a, b) => a.pickNum - b.pickNum);
  const isExtension =
    sorted.length >= recordedPicks.length &&
    recordedPicks.every((r, i) => sorted[i] && sorted[i].pickNum === r.pickNum && key(sorted[i].playerName) === r.name);

  if (!isExtension) {
    ctx.driftSamples = [];
    recordedPicks = [];
  }

  let recorded = 0;
  for (let i = recordedPicks.length; i < sorted.length; i++) {
    const pick = sorted[i];
    const player = byName.get(key(pick.playerName));
    // A pick whose player was removed by a later import has no ADP to compare
    // against; it is skipped for drift but still counted as seen, so it can't
    // force a full replay on every sync.
    if (player) {
      recordPick(ctx, player, pick.pickNum);
      recorded++;
    }
    recordedPicks.push({ pickNum: pick.pickNum, name: key(pick.playerName) });
  }
  return { recorded, total: recordedPicks.length, driftSamples: ctx.driftSamples.length };
}

function resolve(names) {
  const out = [];
  for (const n of names) {
    const p = byName.get(key(n));
    if (p) out.push(p);
  }
  return out;
}

function slimPlayer(p) {
  if (!p) return null;
  return {
    name: p.name,
    pos: p.pos,
    posList: p.posList,
    team: p.team,
    vorp: p.vorp,
    overallRank: p.overallRank,
    adp: p.adp,
    diff: p._diff,
    offShare: p._offShare,
  };
}

function slimFactor(f) {
  return { key: f.key, label: f.label, detail: f.detail, salience: f.salience };
}

function plan(id, state) {
  const drafted = new Set(state.draftedNames.map(key));
  const myRoster = resolve(state.myRosterNames);

  // `secondPickOutlook` slices its lookahead straight off the pool it is
  // given without sorting it first (`recommend` sorts its own copy, that path
  // does not), so the pool has to arrive in value order or the forecast reads
  // the wrong forty players. Ordering the input is the caller's job here —
  // the engine's own logic is left alone.
  const available = players
    .filter((p) => !drafted.has(key(p.name)))
    .sort((a, b) => (b._raw ?? 0) - (a._raw ?? 0));

  const picks = myPicks(state.mySlot, ctx.config);
  const base = { available, myRoster, pickNum: state.pickNum, round: state.round, mySlot: state.mySlot };

  // Stage one: the cheap ranking, posted immediately so the panel has real
  // content while the branching two-pick search runs. Same worker, so it
  // still never touches the main thread.
  const ranked = recommend({ ...base, myPickNumbers: picks }, ctx);
  const top = ranked[0];
  self.postMessage({
    type: 'quick',
    id,
    now: top
      ? {
          player: slimPlayer(top.player),
          marginalValue: top.marginalValue,
          survival: top.survival,
          reason: top.reason,
        }
      : null,
  });

  const result = planNextTwo(base, ctx, {});
  self.postMessage({
    type: 'plan',
    id,
    turn: result.turn,
    now: result.now
      ? {
          player: slimPlayer(result.now.player),
          marginalValue: result.now.marginalValue,
          survival: result.now.survival,
          score: result.now.score,
          edge: result.now.edge,
          alternative: slimPlayer(result.now.alternative),
          factors: result.now.factors.map(slimFactor),
        }
      : null,
    then: result.then
      ? {
          atPick: result.then.atPick,
          likelyPosition: result.then.likelyPosition,
          expectedValue: result.then.expectedValue,
          positionOutlook: result.then.positionOutlook,
          candidates: result.then.candidates.map((c) => ({
            player: slimPlayer(c.player),
            probBestAvailable: c.probBestAvailable,
            marginalValue: c.marginalValue,
          })),
          message: result.then.message,
        }
      : null,
    goalieAudit: result.goalieAudit
      ? {
          player: slimPlayer(result.goalieAudit.player),
          marginalValue: result.goalieAudit.marginalValue,
          survival: result.goalieAudit.survival,
          note: result.goalieAudit.note,
          costVsTop: result.goalieAudit.costVsTop,
        }
      : null,
  });
}

self.onmessage = async (event) => {
  const msg = event.data;
  try {
    if (msg.type === 'build') {
      const { count } = build(msg.players, msg.config);
      self.postMessage({ type: 'ready', count });
      return;
    }
    if (!ctx) {
      self.postMessage({ type: 'error', id: msg.id, message: 'context not built yet' });
      return;
    }
    if (msg.type === 'plan') {
      const picks = syncPicks(msg.state.picks ?? []);
      self.postMessage({ type: 'picks', id: msg.id, ...picks });
      plan(msg.id, msg.state);
    }
  } catch (err) {
    self.postMessage({ type: 'error', id: msg.id, message: err?.message ?? String(err) });
  }
};
