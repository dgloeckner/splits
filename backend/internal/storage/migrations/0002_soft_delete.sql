-- FEAT-0009: soft-delete sessions. Reads filter via the partial
-- index; janitor sweeps rows past retention.
ALTER TABLE sessions ADD COLUMN deleted_at TEXT;
CREATE INDEX IF NOT EXISTS idx_sessions_not_deleted
  ON sessions(started_at) WHERE deleted_at IS NULL;
