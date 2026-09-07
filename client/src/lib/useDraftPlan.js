import { useEffect, useRef, useState } from 'react';
import { api } from './api.js';

/**
 * Drives the draft-plan worker from the polled draft state.
 *
 * Two separate clocks, deliberately:
 *   - The context is rebuilt only when `poolVersion` changes, i.e. after an
 *     import or a hand edit on the Players page. It is the expensive half and
 *     nothing about a pick invalidates it.
 *   - The plan is recomputed on draft-state change, debounced, and the
 *     previous plan stays on screen while the new one runs. A panel that
 *     blanks itself every eight seconds is unreadable during a draft.
 *
 * Season targets get a third, cheaper path. They are edited in Settings >
 * Roster and arrive on every poll, but they do not invalidate the context —
 * they only re-calibrate the opponent model. Rebuilding for them would be slow
 * and would also discard the drift samples the room's picks have taught the
 * model, so a target edit posts `setTargets` and re-plans instead.
 */
export function useDraftPlan(draftState) {
  const [plan, setPlan] = useState(null);
  const [fixture, setFixture] = useState(null);
  const [quick, setQuick] = useState(null);
  const [status, setStatus] = useState('idle'); // idle | building | planning | ready | error
  const [error, setError] = useState(null);
  const [warnings, setWarnings] = useState([]);

  // Dev-only branch viewer: ?planFixture=closeCall|confident|turn|goalieAudit
  // renders a plan the real engine produced for a state that is hard to reach
  // on demand, so those branches can be checked without waiting for a draft to
  // wander into one. Statically false in a production build, so neither the
  // branch nor the JSON ships.
  const fixtureName = import.meta.env.DEV
    ? new URLSearchParams(window.location.search).get('planFixture')
    : null;

  useEffect(() => {
    if (!fixtureName) return;
    let cancelled = false;
    import('./draft/planFixtures.json').then((mod) => {
      if (!cancelled) setFixture(mod.default[fixtureName] ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, [fixtureName]);

  const workerRef = useRef(null);
  // State, not a ref: the context build finishes asynchronously, and the plan
  // effect has to re-run when it lands. As a ref it changed silently, the plan
  // effect had already bailed on "no context yet", and nothing ever asked
  // again — the panel sat empty until the next pick.
  const [builtVersion, setBuiltVersion] = useState(null);
  // The targets the worker's context currently holds, so a poll that carries
  // unchanged targets doesn't re-blend on every tick.
  const appliedTargets = useRef(null);
  const [targetsVersion, setTargetsVersion] = useState(0);
  const requestId = useRef(0);
  const timer = useRef(null);

  useEffect(() => {
    const worker = new Worker(new URL('../workers/draftPlan.worker.js', import.meta.url), {
      type: 'module',
    });
    workerRef.current = worker;
    worker.onmessage = (event) => {
      const msg = event.data;
      // Ignore anything from a superseded request, so a slow plan can't
      // overwrite a newer one that already landed.
      if (msg.id != null && msg.id !== requestId.current) return;
      if (msg.warnings) setWarnings(msg.warnings);
      if (msg.type === 'ready') setStatus('planning');
      if (msg.type === 'quick') setQuick(msg.now);
      if (msg.type === 'plan') {
        setPlan(msg);
        setQuick(null);
        setStatus('ready');
        setError(null);
      }
      if (msg.type === 'error') {
        setError(msg.message);
        setStatus('error');
      }
      if (msg.type === 'picks' && import.meta.env.DEV) {
        // Definition-of-done assertion: the drift model is the highest-value
        // signal in the engine and it only works if it sees every pick, so a
        // gap between picks played and picks recorded is worth shouting about.
        console.assert(
          msg.total === msg.driftSamples || msg.driftSamples <= msg.total,
          'draft plan: recordPick did not fire for every pick',
          msg
        );
        if (msg.recorded) console.debug(`[draftPlan] recorded ${msg.recorded} pick(s), ${msg.total} total`);
      }
    };
    return () => {
      worker.terminate();
      workerRef.current = null;
    };
  }, []);

  const poolVersion = draftState?.poolVersion ?? null;
  const engineConfig = draftState?.engineConfig ?? null;
  // Compared as a string, not by identity: the polled object is new every
  // eight seconds, so an identity check would re-post the targets forever.
  const targetsKey = engineConfig?.seasonTargets ? JSON.stringify(engineConfig.seasonTargets) : null;

  useEffect(() => {
    if (!poolVersion || !engineConfig || !workerRef.current) return;
    if (builtVersion === poolVersion) return;
    let cancelled = false;
    setStatus('building');
    api
      .getPlayers()
      .then((players) => {
        if (cancelled || !workerRef.current) return;
        workerRef.current.postMessage({
          type: 'build',
          players,
          config: {
            teamCount: engineConfig.teamCount,
            slots: engineConfig.slots,
            benchSlots: engineConfig.benchSlots,
            totalRounds: engineConfig.totalRounds,
            // Included in the initial build so the very first plan is already
            // calibrated; later edits come through `setTargets`.
            seasonTargets: engineConfig.seasonTargets ?? null,
          },
        });
        appliedTargets.current = targetsKey;
        setBuiltVersion(poolVersion);
      })
      .catch((err) => !cancelled && setError(err.message));
    return () => {
      cancelled = true;
    };
  }, [poolVersion, engineConfig, builtVersion]);

  useEffect(() => {
    if (builtVersion == null || !workerRef.current) return;
    if (targetsKey === appliedTargets.current) return;
    appliedTargets.current = targetsKey;
    workerRef.current.postMessage({
      type: 'setTargets',
      targets: targetsKey ? JSON.parse(targetsKey) : null,
    });
    // Bumping this re-runs the plan effect below, so an edited target shows up
    // in the recommendation immediately rather than at the next pick.
    setTargetsVersion((n) => n + 1);
  }, [targetsKey, builtVersion]);

  const pickNum = draftState?.pickInfo?.pickNum ?? null;
  const mySlot = engineConfig?.mySlot ?? null;
  const round = draftState?.pickInfo?.round ?? null;

  useEffect(() => {
    if (!pickNum || !mySlot || builtVersion == null) return;
    clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      try {
        // The full pick list, not the six-deep display feed: the drift model
        // needs every completed pick by every team.
        const picks = await api.getPickFeed();
        const players = await api.getPlayers();
        if (!workerRef.current) return;
        requestId.current += 1;
        workerRef.current.postMessage({
          type: 'plan',
          id: requestId.current,
          state: {
            pickNum,
            round,
            mySlot,
            picks: picks.map((p) => ({ pickNum: p.pickNum, playerName: p.playerName })),
            draftedNames: players.filter((p) => p.drafted).map((p) => p.name),
            myRosterNames: players.filter((p) => p.mine).map((p) => p.name),
          },
        });
      } catch (err) {
        setError(err.message);
      }
    }, 250);
    return () => clearTimeout(timer.current);
  }, [pickNum, round, mySlot, builtVersion, targetsVersion]);

  if (fixtureName) {
    return {
      plan: fixture?.plan ?? null,
      quick: null,
      status: fixture ? 'ready' : 'building',
      error: null,
      warnings: [],
      fixturePickInfo: fixture?.pickInfo ?? null,
    };
  }

  return { plan, quick, status, error, warnings, fixturePickInfo: null };
}
