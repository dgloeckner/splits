-- FEAT-0010: achievement / PB tables. All keyed by rower_id, all
-- carrying snapshot fields (achieved_at, source_session_started_at,
-- the value itself) so they render without joining back to the
-- source session. Per ADR-0008, derived data is rebuilt by full
-- recompute, never incremental bookkeeping.

CREATE TABLE IF NOT EXISTS pb_distance (
  id                        INTEGER PRIMARY KEY,
  rower_id                  TEXT NOT NULL REFERENCES rowers(id),
  distance_m                INTEGER NOT NULL,
  time_sec                  REAL NOT NULL,
  source_session_id         TEXT NOT NULL REFERENCES sessions(id),
  source_session_started_at TEXT NOT NULL,
  achieved_at               TEXT NOT NULL,
  window_start_stroke       INTEGER NOT NULL,
  window_end_stroke         INTEGER NOT NULL,
  invalidated_at            TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS pb_distance_active_uniq
  ON pb_distance(rower_id, distance_m) WHERE invalidated_at IS NULL;
CREATE INDEX IF NOT EXISTS pb_distance_source ON pb_distance(source_session_id);

CREATE TABLE IF NOT EXISTS pb_window (
  id                        INTEGER PRIMARY KEY,
  rower_id                  TEXT NOT NULL REFERENCES rowers(id),
  metric                    TEXT NOT NULL,
  window_kind               TEXT NOT NULL,
  window_size               INTEGER NOT NULL,
  value                     REAL NOT NULL,
  source_session_id         TEXT NOT NULL REFERENCES sessions(id),
  source_session_started_at TEXT NOT NULL,
  achieved_at               TEXT NOT NULL,
  invalidated_at            TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS pb_window_active_uniq
  ON pb_window(rower_id, metric, window_kind, window_size) WHERE invalidated_at IS NULL;
CREATE INDEX IF NOT EXISTS pb_window_source ON pb_window(source_session_id);

CREATE TABLE IF NOT EXISTS pb_workout (
  id                        INTEGER PRIMARY KEY,
  rower_id                  TEXT NOT NULL REFERENCES rowers(id),
  shape_hash                TEXT NOT NULL,
  mode                      TEXT NOT NULL,
  params_json               TEXT NOT NULL,
  value_kind                TEXT NOT NULL,
  value                     REAL NOT NULL,
  source_session_id         TEXT NOT NULL REFERENCES sessions(id),
  source_session_started_at TEXT NOT NULL,
  achieved_at               TEXT NOT NULL,
  invalidated_at            TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS pb_workout_active_uniq
  ON pb_workout(rower_id, shape_hash) WHERE invalidated_at IS NULL;
CREATE INDEX IF NOT EXISTS pb_workout_source ON pb_workout(source_session_id);

CREATE TABLE IF NOT EXISTS achievements (
  id                        INTEGER PRIMARY KEY,
  rower_id                  TEXT NOT NULL REFERENCES rowers(id),
  achievement_type          TEXT NOT NULL,
  achievement_key           TEXT NOT NULL,
  value                     REAL,
  source_session_id         TEXT REFERENCES sessions(id),
  source_session_started_at TEXT,
  achieved_at               TEXT NOT NULL,
  invalidated_at            TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS achievements_active_uniq
  ON achievements(rower_id, achievement_type, achievement_key) WHERE invalidated_at IS NULL;
CREATE INDEX IF NOT EXISTS achievements_source ON achievements(source_session_id);

CREATE TABLE IF NOT EXISTS rower_lifetime_stats (
  rower_id          TEXT PRIMARY KEY REFERENCES rowers(id),
  total_distance_m  INTEGER NOT NULL DEFAULT 0,
  total_active_sec  INTEGER NOT NULL DEFAULT 0,
  total_strokes     INTEGER NOT NULL DEFAULT 0,
  total_sessions    INTEGER NOT NULL DEFAULT 0,
  stats_version     INTEGER NOT NULL DEFAULT 0,
  computed_at       TEXT NOT NULL DEFAULT (datetime('now'))
);

ALTER TABLE workout ADD COLUMN shape_hash TEXT;
CREATE INDEX IF NOT EXISTS workout_shape_hash ON workout(shape_hash);
