-- FEAT-0002 prep: track which rowers a device has paired with so the
-- active-rower switcher cannot select arbitrary rowers from the
-- household. Auto-populated on rower create + first active-set; full
-- QR pairing flow lands in FEAT-0002 plan.
CREATE TABLE IF NOT EXISTS device_rowers (
  device_id TEXT NOT NULL,
  rower_id  TEXT NOT NULL,
  paired_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (device_id, rower_id),
  FOREIGN KEY (rower_id) REFERENCES rowers(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_device_rowers_device ON device_rowers(device_id);
