CREATE TABLE IF NOT EXISTS rowers (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  weight_kg  REAL,
  height_cm  REAL,
  dob        TEXT,
  color      TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS device_active_rower (
  device_id  TEXT PRIMARY KEY,
  rower_id   TEXT NOT NULL REFERENCES rowers(id),
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_device_active_rower_updated
  ON device_active_rower(updated_at);
