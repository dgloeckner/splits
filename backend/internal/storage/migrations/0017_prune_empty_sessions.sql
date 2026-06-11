-- 0017: remove phantom sessions persisted before the empty-session
-- prune (storage/persister.go applySessionEnd). A phantom is an ended
-- session that recorded no strokes and no distance — produced by a
-- POST /session/start that never received an IPM frame. They pollute
-- the Verlauf list, the trends totals, and the Rekorde grid. Idempotent.
DELETE FROM sessions
WHERE ended_at IS NOT NULL
  AND total_strokes = 0
  AND total_distance_m = 0
  AND id NOT IN (SELECT DISTINCT session_id FROM strokes);
