CREATE TABLE IF NOT EXISTS workout (
  id           TEXT PRIMARY KEY,
  mode         TEXT NOT NULL CHECK (mode IN ('just_row','distance','time','intervals')),
  params_json  TEXT NOT NULL,
  intensity    TEXT CHECK (intensity IN ('locker','moderat','hart','allout')),
  warmup_sec   INTEGER NOT NULL DEFAULT 0,
  cooldown_sec INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS workout_favorite (
  id           TEXT PRIMARY KEY,
  rower_id     TEXT NOT NULL REFERENCES rowers(id),
  name         TEXT NOT NULL,
  mode         TEXT NOT NULL CHECK (mode IN ('just_row','distance','time','intervals')),
  params_json  TEXT NOT NULL,
  intensity    TEXT CHECK (intensity IN ('locker','moderat','hart','allout')),
  warmup_sec   INTEGER NOT NULL DEFAULT 0,
  cooldown_sec INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_workout_favorite_rower
  ON workout_favorite(rower_id, created_at DESC);

ALTER TABLE sessions ADD COLUMN workout_id TEXT REFERENCES workout(id);
