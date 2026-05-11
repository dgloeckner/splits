-- 0015_session_status.sql — FEAT-0015 Slice 3.
-- Adds a `status` column to sessions so the stale-open janitor can
-- mark sessions whose connection died mid-row. Values:
--   'open'        — live or boot-recoverable; default for existing rows.
--   'stale-open'  — janitor-flagged: ended_at IS NULL and the most recent
--                   stroke is older than the configured idle threshold.
-- Once `ended_at` is set the column becomes informational; queries that
-- only care about end-state continue to use `ended_at IS NULL`.

ALTER TABLE sessions ADD COLUMN status TEXT NOT NULL DEFAULT 'open';

CREATE INDEX IF NOT EXISTS idx_sessions_status_rower
  ON sessions(status, rower_id) WHERE status = 'stale-open';
