-- FEAT-0002 T7: soft-delete for rowers. Sessions remain attributed to
-- the rower row; List filters out deleted_at IS NOT NULL.
ALTER TABLE rowers ADD COLUMN deleted_at TEXT;
CREATE INDEX IF NOT EXISTS idx_rowers_active
  ON rowers(created_at) WHERE deleted_at IS NULL;
