-- FEAT-0011 session insights: per-session findings (Pacing/Fade/Consistency).
-- Self-sufficient rows; no joins to strokes (deleted by FEAT-0009 Mode 0).

CREATE TABLE IF NOT EXISTS session_insights (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  rower_id      TEXT NOT NULL REFERENCES rowers(id),
  session_id    TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  detector_id   TEXT NOT NULL,
  code          TEXT NOT NULL,
  severity      TEXT NOT NULL,
  category      TEXT NOT NULL,
  message_de    TEXT NOT NULL,
  evidence_json TEXT NOT NULL,
  computed_at   TEXT NOT NULL,
  UNIQUE(session_id, detector_id)
);

CREATE INDEX IF NOT EXISTS idx_session_insights_rower
  ON session_insights(rower_id, computed_at DESC);
CREATE INDEX IF NOT EXISTS idx_session_insights_session
  ON session_insights(session_id);
