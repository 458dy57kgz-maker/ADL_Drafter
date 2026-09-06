import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.DATA_DIR || path.resolve(__dirname, '../../data');
const DB_PATH = path.join(DATA_DIR, 'adl-drafter.sqlite');

fs.mkdirSync(DATA_DIR, { recursive: true });

export const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
db.exec(schema);

// schema.sql only uses CREATE TABLE IF NOT EXISTS, so a column added to it
// never reaches a database that already exists. Each entry here is a column
// introduced after the initial schema; adding one is idempotent, so this can
// run on every boot.
const ADDED_COLUMNS = [{ table: 'players', column: 'blocks', type: 'INTEGER' }];

function migrate() {
  for (const { table, column, type } of ADDED_COLUMNS) {
    const existing = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
    if (!existing.includes(column)) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
    }
  }
}

migrate();

const DEFAULT_SETTINGS = {
  league: {
    leagueId: '',
    // Teams start empty rather than pre-filled with invented names — they're
    // entered on Settings > League, or overwritten by a Yahoo pull. Anything
    // depending on the draft order (whose turn it is) treats an empty list as
    // "not set up yet" rather than guessing.
    teams: [],
    teamCount: 10,
    myTeamId: null,
    myTeamSlot: 1,
  },
  rosterSlots: { C: 2, LW: 2, RW: 2, D: 4, G: 2, BENCH: 4, IR: 2 },
  targets: { goals: 200, assists: 220, ppp: 90, plusMinus: 120, shots: 1400, wins: 30, saves: 900 },
  draftDay: { pollInterval: 8, draftMode: 'auto', notifSound: true, notifDesktop: true, mockDraftMode: false },
  hosting: {
    leagues: [{ id: 'default', name: 'My League 2026' }],
    activeLeagueId: 'default',
    timezone: 'America/Toronto',
  },
  yahoo: {
    connected: false,
    username: null,
    connectionMode: 'proxy',
    publicUrl: '', // e.g. https://adldrafter.example.com — set before authorizing
    clientId: '',
    clientSecret: '',
    accessToken: null,
    refreshToken: null,
    tokenExpiresAt: null, // epoch ms
    lastCall: null,
  },
};

// Only settings get seeded — the player pool, draft picks, aliases and
// unmatched list all start genuinely empty. Invented players were actively
// misleading: they looked like a loaded roster, and any real import had to
// clear them out first. Load a real list via Settings > Rankings Import.
//
// INSERT OR IGNORE per section (rather than an all-or-nothing "is the DB
// empty?" check) means a section added in a later version lands on an
// existing database instead of being silently skipped forever.
function seedMissingSettings() {
  const insertSetting = db.prepare('INSERT OR IGNORE INTO settings (section, data) VALUES (?, ?)');
  db.transaction(() => {
    for (const [section, data] of Object.entries(DEFAULT_SETTINGS)) {
      insertSetting.run(section, JSON.stringify(data));
    }
  })();
}

seedMissingSettings();

export function getSetting(section) {
  const row = db.prepare('SELECT data FROM settings WHERE section = ?').get(section);
  return row ? JSON.parse(row.data) : null;
}

export function setSetting(section, patch) {
  const current = getSetting(section) || {};
  const next = { ...current, ...patch };
  db.prepare(
    'INSERT INTO settings (section, data) VALUES (?, ?) ON CONFLICT(section) DO UPDATE SET data = excluded.data'
  ).run(section, JSON.stringify(next));
  return next;
}

export function logDebug(msg, status = 'OK', type = 'app') {
  db.prepare('INSERT INTO debug_log (time, msg, status, type) VALUES (?, ?, ?, ?)').run(
    new Date().toLocaleTimeString(),
    msg,
    status,
    type
  );
}
