CREATE TABLE IF NOT EXISTS players (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  pos TEXT NOT NULL,
  team TEXT,
  rank INTEGER,
  overall_rank INTEGER,
  adp INTEGER,
  tier INTEGER,
  g INTEGER,
  a INTEGER,
  p INTEGER,
  ppp INTEGER,
  plus_minus INTEGER,
  shots INTEGER,
  w INTEGER,
  gaa REAL,
  saves INTEGER,
  drafted INTEGER NOT NULL DEFAULT 0,
  drafted_by TEXT,
  mine INTEGER NOT NULL DEFAULT 0,
  tracked INTEGER NOT NULL DEFAULT 0,
  roster_slot TEXT,
  yahoo_player_key TEXT
);

CREATE TABLE IF NOT EXISTS draft_picks (
  pick_num INTEGER PRIMARY KEY,
  round INTEGER NOT NULL,
  team TEXT NOT NULL,
  player_id INTEGER,
  player_name TEXT NOT NULL,
  pos TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS settings (
  section TEXT PRIMARY KEY,
  data TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS name_aliases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  from_name TEXT NOT NULL,
  to_name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS unmatched_players (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  rankings_name TEXT NOT NULL,
  suggestion TEXT,
  resolved INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS debug_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  time TEXT NOT NULL,
  msg TEXT NOT NULL,
  status TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'app'
);
