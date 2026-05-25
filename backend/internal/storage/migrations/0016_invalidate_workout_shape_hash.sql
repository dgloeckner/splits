-- 0016_invalidate_workout_shape_hash.sql — ADR-0015 (2026-05-25 amendment).
-- Workout.shape_hash semantics changed: it's now SHA-256 of canonical
-- params only (mode, warmup_sec, cooldown_sec excluded). Every existing
-- hash is stale.
--
-- This migration does three things, all idempotent:
--
-- 1. Sets all workout.shape_hash values to NULL so the boot-time
--    storage.RecomputeShapes helper detects and refills them under the
--    new function.
--
-- 2. Invalidates every active pb_workout row so the recompute pipeline
--    rebuilds them under the new hashes. The pb_workout unique index
--    is `(rower_id, shape_hash) WHERE invalidated_at IS NULL`, so this
--    frees the slots before stats.Recompute fires.
--
-- 3. Resets rower_lifetime_stats.computed_at to a sentinel old value so
--    the existing storage.RecomputeStaleRowerStats hook (called by
--    BootJanitor at boot and by the periodic sweep) sees every rower
--    as stale and runs stats.Recompute for them — rebuilding pb_workout,
--    pb_distance, pb_window, achievements, etc. under the new hashes.
--    No new boot wiring required; we reuse the self-healing pathway.

UPDATE workout SET shape_hash = NULL;

UPDATE pb_workout
SET invalidated_at = datetime('now')
WHERE invalidated_at IS NULL;

UPDATE rower_lifetime_stats SET computed_at = '1970-01-01T00:00:00Z';
