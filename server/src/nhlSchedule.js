import { getSetting } from './db/index.js';
import { nhlRefreshDue } from './lib/nhlStats.js';
import { syncFromNhl } from './routes/season.js';

// The daily NHL.com refresh. Checks every quarter hour whether one is due
// (see nhlRefreshDue) and only ever in season mode — in draft mode there's
// no season to follow. One run at a time.
const CHECK_EVERY = 15 * 60 * 1000;
let running = false;

async function tick() {
  if (running) return;
  if (getSetting('app')?.mode !== 'season') return;
  const timeZone = getSetting('hosting')?.timezone || 'America/Toronto';
  if (!nhlRefreshDue({ timeZone, season: getSetting('season') })) return;
  running = true;
  try {
    await syncFromNhl({ reason: 'daily' });
  } finally {
    running = false;
  }
}

export function startNhlSchedule() {
  setTimeout(tick, 30 * 1000); // shortly after boot, in case the NAS slept through 6 a.m.
  setInterval(tick, CHECK_EVERY).unref();
}
