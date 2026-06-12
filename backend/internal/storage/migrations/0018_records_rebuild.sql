-- 0018: Rekorde inventory change (2026-06-11 Historie spec, amended 2026-06-12).
-- Ships in lockstep with the recompute changes (WindowDefs → power only,
-- recomputeConsistency deleted, recomputeWorkout time-mode only) — an
-- invalidation-only migration would be undone by the next recompute.

-- Window-PBs shrink to power/seconds/60: spi + dps rows retire.
UPDATE pb_window SET invalidated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE metric IN ('spi','dps') AND invalidated_at IS NULL;

-- Konstanz-Bestleistungen are cut.
UPDATE achievements SET invalidated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE achievement_type = 'consistency_intra' AND invalidated_at IS NULL;

-- Backfill time-mode workout-PB candidates from session aggregates.
-- Completed = work time within 5 s of the prescribed duration; must
-- match workoutCompletionSlackSec in storage/finalise.go.
INSERT INTO session_pb_workout_candidate(session_id, rower_id, started_at, shape_hash, mode, value_kind, value)
SELECT s.id, s.rower_id, s.started_at, w.shape_hash, 'time', 'distance_m', s.total_distance_m
FROM sessions s
JOIN workout w ON w.id = s.workout_id
WHERE s.deleted_at IS NULL AND s.ended_at IS NOT NULL
  AND w.mode = 'time'
  AND COALESCE(s.total_distance_m, 0) > 0
  AND s.total_time_sec + 5.0 >= CAST(json_extract(w.params_json, '$.seconds') AS REAL)
  AND NOT EXISTS (SELECT 1 FROM session_pb_workout_candidate c WHERE c.session_id = s.id);

-- Force the boot janitor's B6 stale-stats pass (janitor.go:
-- RecomputeStaleRowerStats triggers on ended_at > computed_at) so
-- pb_workout actives exist on first boot after this migration.
UPDATE rower_lifetime_stats SET computed_at = '0001-01-01T00:00:00Z';
