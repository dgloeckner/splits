-- 0014_race_mode.sql — extend workout/workout_favorite mode CHECK to
-- include 'race'. SQLite cannot ALTER a CHECK; rebuild via temp table.

PRAGMA foreign_keys = OFF;

CREATE TABLE workout_new (
  id           TEXT PRIMARY KEY,
  mode         TEXT NOT NULL CHECK (mode IN ('just_row','distance','time','intervals','race')),
  params_json  TEXT NOT NULL,
  intensity    TEXT CHECK (intensity IN ('locker','moderat','hart','allout')),
  warmup_sec   INTEGER NOT NULL DEFAULT 0,
  cooldown_sec INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL,
  shape_hash   TEXT
);
INSERT INTO workout_new
SELECT id, mode, params_json, intensity, warmup_sec, cooldown_sec, created_at, shape_hash
FROM workout;
DROP TABLE workout;
ALTER TABLE workout_new RENAME TO workout;
CREATE INDEX IF NOT EXISTS workout_shape_hash ON workout(shape_hash);

CREATE TABLE workout_favorite_new (
  id           TEXT PRIMARY KEY,
  rower_id     TEXT NOT NULL REFERENCES rowers(id),
  name         TEXT NOT NULL,
  mode         TEXT NOT NULL CHECK (mode IN ('just_row','distance','time','intervals','race')),
  params_json  TEXT NOT NULL,
  intensity    TEXT CHECK (intensity IN ('locker','moderat','hart','allout')),
  warmup_sec   INTEGER NOT NULL DEFAULT 0,
  cooldown_sec INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL
);
INSERT INTO workout_favorite_new
SELECT id, rower_id, name, mode, params_json, intensity, warmup_sec, cooldown_sec, created_at
FROM workout_favorite;
DROP TABLE workout_favorite;
ALTER TABLE workout_favorite_new RENAME TO workout_favorite;
CREATE INDEX IF NOT EXISTS idx_workout_favorite_rower
  ON workout_favorite(rower_id, created_at DESC);

PRAGMA foreign_keys = ON;
