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
  blocks INTEGER,
  ong INTEGER,
  gp INTEGER,
  vorp REAL,
  w INTEGER,
  gaa REAL,
  saves INTEGER,
  drafted INTEGER NOT NULL DEFAULT 0,
  drafted_by TEXT,
  mine INTEGER NOT NULL DEFAULT 0,
  tracked INTEGER NOT NULL DEFAULT 0,
  -- My own note on a player: 'sleeper', 'avoid' or 'favourite' (NULL = none).
  flag TEXT,
  roster_slot TEXT,
  yahoo_player_key TEXT,
  -- Reputation and luck from the preseason sheet (PROFILE_FIELDS in mapPlayer.js).
  gp_3y REAL,
  g_3y REAL,
  a_3y REAL,
  pts_3y REAL,
  bs_3y REAL,
  sog_career REAL,
  gs_3y REAL,
  w_3y REAL,
  sv_3y REAL,
  gaa_3y REAL,
  yown REAL,
  shsv REAL,
  ly_sh_pct REAL,
  c_sh_pct REAL,
  ly_ipp REAL,
  c_ipp REAL
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

-- Season mode. Every team's current roster, one row per seat, as last
-- imported from Yahoo's Starting Rosters page. Replaced wholesale on each
-- import; the draft tables above are left alone as the record of the draft.
CREATE TABLE IF NOT EXISTS season_rosters (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  team_num INTEGER NOT NULL,
  team_name TEXT NOT NULL,
  seat INTEGER NOT NULL,
  slot TEXT NOT NULL,
  -- players.id when the name matched my pool; NULL for anyone I never ranked.
  player_id INTEGER,
  yahoo_player_id TEXT,
  player_name TEXT,
  nhl_team TEXT,
  pos TEXT,
  status TEXT
);

-- Actual in-season stats, from whatever sheet I import. One row per player
-- in that sheet, matched to my pool on import where the name allows.
CREATE TABLE IF NOT EXISTS season_stats (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  player_id INTEGER,
  name TEXT NOT NULL,
  team TEXT,
  pos TEXT,
  gp INTEGER,
  g INTEGER,
  a INTEGER,
  p INTEGER,
  ppp INTEGER,
  plus_minus INTEGER,
  shots INTEGER,
  blocks INTEGER,
  w INTEGER,
  gaa REAL,
  saves INTEGER
);
