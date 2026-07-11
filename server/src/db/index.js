import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildMockPlayers } from '../lib/mockData.js';
import { round } from '../lib/draftMath.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.DATA_DIR || path.resolve(__dirname, '../../data');
const DB_PATH = path.join(DATA_DIR, 'adl-drafter.sqlite');

fs.mkdirSync(DATA_DIR, { recursive: true });

export const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
db.exec(schema);

const DEFAULT_SETTINGS = {
  league: {
    leagueId: '1234567',
    season: '2026 (nhl)',
    teamCount: 10,
    myTeamId: 'you',
    teams: [
      { id: 'you', name: "J's Juggernauts" },
      { id: 't2', name: 'Ice Breakers' },
      { id: 't3', name: 'Puck Norris' },
      { id: 't4', name: 'Slapshot Sallies' },
      { id: 't5', name: 'Zamboni Drivers' },
      { id: 't6', name: 'Blue Line Bandits' },
      { id: 't7', name: 'Power Play Pirates' },
      { id: 't8', name: 'Fourth Liners' },
      { id: 't9', name: 'Hat Trick Heroes' },
      { id: 't10', name: 'Offside Outlaws' },
    ],
    myTeamSlot: 3,
  },
  rosterSlots: { C: 2, LW: 2, RW: 2, D: 4, G: 2, BENCH: 4, IR: 2 },
  targets: { goals: 200, assists: 220, ppp: 90, plusMinus: 120, shots: 1400, wins: 30, saves: 900 },
  draftDay: { pollInterval: 8, draftMode: 'auto', notifSound: true, notifDesktop: true },
  hosting: {
    leagues: [{ id: 'default', name: 'My League 2026' }],
    timezone: 'America/Toronto',
  },
  yahoo: {
    connected: false,
    username: null,
    connectionMode: 'proxy',
    redirectUri: 'https://your-domain/api/yahoo/callback',
    lastCall: null,
    refreshHealthy: false,
    expiresIn: null,
  },
};

function seedIfEmpty() {
  const playerCount = db.prepare('SELECT COUNT(*) AS n FROM players').get().n;
  if (playerCount > 0) return;

  const players = buildMockPlayers();
  const insertPlayer = db.prepare(`
    INSERT INTO players
      (id, name, pos, team, rank, overall_rank, adp, tier, g, a, p, ppp, plus_minus, shots, w, gaa, saves, drafted, drafted_by, mine, tracked)
    VALUES
      (@id, @name, @pos, @team, @rank, @overallRank, @adp, @tier, @g, @a, @p, @ppp, @plusMinus, @shots, @w, @gaa, @saves, @drafted, @draftedBy, @mine, @tracked)
  `);

  const insertMany = db.transaction((rows) => {
    for (const p of rows) {
      insertPlayer.run({ ...p, drafted: p.drafted ? 1 : 0, mine: p.mine ? 1 : 0, tracked: p.tracked ? 1 : 0 });
    }
  });
  insertMany(players);

  // Turn the generator's "drafted" flags into an actual pick history, ordered
  // by overall rank, so pick numbers/rounds are internally consistent.
  const teamCount = DEFAULT_SETTINGS.league.teamCount;
  const draftedPlayers = players.filter((p) => p.drafted).sort((a, b) => a.overallRank - b.overallRank);
  const insertPick = db.prepare(`
    INSERT INTO draft_picks (pick_num, round, team, player_id, player_name, pos)
    VALUES (@pickNum, @round, @team, @playerId, @playerName, @pos)
  `);
  const insertPicks = db.transaction((rows) => {
    rows.forEach((p, i) => {
      const pickNum = i + 1;
      insertPick.run({
        pickNum,
        round: round(pickNum, teamCount),
        team: p.mine ? "J's Juggernauts" : p.draftedBy,
        playerId: p.id,
        playerName: p.name,
        pos: p.pos,
      });
    });
  });
  insertPicks(draftedPlayers);

  const insertSetting = db.prepare('INSERT INTO settings (section, data) VALUES (?, ?)');
  const seedSettings = db.transaction(() => {
    for (const [section, data] of Object.entries(DEFAULT_SETTINGS)) {
      insertSetting.run(section, JSON.stringify(data));
    }
  });
  seedSettings();

  db.prepare('INSERT INTO name_aliases (from_name, to_name) VALUES (?, ?)').run(
    'Mitchell Marner',
    'Mitch Marner'
  );

  const insertUnmatched = db.prepare(
    'INSERT INTO unmatched_players (rankings_name, suggestion) VALUES (?, ?)'
  );
  insertUnmatched.run('Alexandre Texier', 'Alex Texier');
  insertUnmatched.run('Tim Stuetzle', 'Tim Stützle');

  db.prepare('INSERT INTO debug_log (time, msg, status, type) VALUES (?, ?, ?, ?)').run(
    new Date().toLocaleTimeString(),
    'Database seeded with mock draft data',
    'OK',
    'app'
  );
}

seedIfEmpty();

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
