import { DEFAULT_CONFIG } from './draftValue.js';
import LOCAL_CONFIG from './config.local.js';

/**
 * Keys the app owns through its own settings screens. config.local.js may
 * override anything else, but not these — a file quietly winning over a number
 * you can see and edit in the UI is a nasty class of bug to chase, so a clash
 * is dropped and reported rather than honoured.
 */
export const APP_OWNED_KEYS = ['teamCount', 'slots', 'benchSlots', 'totalRounds', 'seasonTargets'];

/**
 * Precedence: engine defaults < config.local.js < the app's own settings.
 *
 * Lives in its own module rather than inside the worker so it can be exercised
 * directly — the worker is not importable outside a worker scope.
 */
export function buildEngineConfig(appConfig, localConfig = LOCAL_CONFIG) {
  const local = { ...(localConfig ?? {}) };
  const clashes = APP_OWNED_KEYS.filter((k) => local[k] !== undefined);
  for (const k of clashes) delete local[k];

  const config = { ...DEFAULT_CONFIG, ...local, ...appConfig };
  config._warnings = clashes.map(
    (k) => `config.local.js sets "${k}", which the app owns — ignoring it. Change it in Settings instead.`
  );
  return config;
}
