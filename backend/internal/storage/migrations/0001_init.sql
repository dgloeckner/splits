CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  rower_id TEXT NOT NULL,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  initial_level INTEGER NOT NULL,
  total_distance_m INTEGER,
  total_time_sec REAL,
  total_strokes INTEGER,
  summary_json TEXT
);

CREATE INDEX IF NOT EXISTS idx_sessions_started_at ON sessions(started_at);
CREATE INDEX IF NOT EXISTS idx_sessions_rower ON sessions(rower_id, started_at);

CREATE TABLE IF NOT EXISTS strokes (
  global_id INTEGER PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id),
  stroke_no INTEGER NOT NULL,
  time_sec REAL NOT NULL,
  distance_m INTEGER NOT NULL,
  spm INTEGER NOT NULL,
  power_w INTEGER NOT NULL,
  cal_per_hr INTEGER NOT NULL,
  level INTEGER NOT NULL,
  dps REAL NOT NULL,
  stroke_cycle_sec REAL NOT NULL,
  pace_sec_per_500m INTEGER NOT NULL,
  energy_joules INTEGER NOT NULL,
  at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_strokes_session ON strokes(session_id, stroke_no);
