-- Storage refactor: typed aggregate columns + native PB candidate tables.
-- summary_json keeps its name and TEXT type; after this migration it carries
-- only {samples: [...]} for the per-bucket timeseries used by session detail.

ALTER TABLE sessions ADD COLUMN avg_power_w REAL;
ALTER TABLE sessions ADD COLUMN peak_power_w REAL;
ALTER TABLE sessions ADD COLUMN avg_spm REAL;
ALTER TABLE sessions ADD COLUMN avg_dps REAL;
ALTER TABLE sessions ADD COLUMN avg_spi REAL;
ALTER TABLE sessions ADD COLUMN avg_pace_sec_per_500m REAL;
ALTER TABLE sessions ADD COLUMN session_calories REAL;

CREATE TABLE IF NOT EXISTS session_pb_distance_candidates (
  session_id          TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  rower_id            TEXT NOT NULL,
  started_at          TEXT NOT NULL,
  distance_m          INTEGER NOT NULL,
  time_sec            REAL NOT NULL,
  window_start_stroke INTEGER NOT NULL,
  window_end_stroke   INTEGER NOT NULL,
  PRIMARY KEY(session_id, distance_m)
);
CREATE INDEX IF NOT EXISTS idx_pbc_dist_rower
  ON session_pb_distance_candidates(rower_id, distance_m, time_sec);

CREATE TABLE IF NOT EXISTS session_pb_window_candidates (
  session_id   TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  rower_id     TEXT NOT NULL,
  started_at   TEXT NOT NULL,
  metric       TEXT NOT NULL,
  window_kind  TEXT NOT NULL,
  window_size  INTEGER NOT NULL,
  value        REAL NOT NULL,
  PRIMARY KEY(session_id, metric, window_kind, window_size)
);
CREATE INDEX IF NOT EXISTS idx_pbw_rower
  ON session_pb_window_candidates(rower_id, metric, window_kind, window_size, value);

CREATE TABLE IF NOT EXISTS session_pb_workout_candidate (
  session_id  TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
  rower_id    TEXT NOT NULL,
  started_at  TEXT NOT NULL,
  shape_hash  TEXT NOT NULL,
  mode        TEXT NOT NULL,
  value_kind  TEXT NOT NULL,
  value       REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pbo_rower
  ON session_pb_workout_candidate(rower_id, shape_hash, value);

CREATE TABLE IF NOT EXISTS session_consistency (
  session_id    TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
  rower_id      TEXT NOT NULL,
  started_at    TEXT NOT NULL,
  power_cv      REAL NOT NULL,
  pace_split_cv REAL NOT NULL,
  spm_cv        REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pbcons_rower
  ON session_consistency(rower_id);
