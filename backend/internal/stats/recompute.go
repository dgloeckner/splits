package stats

import (
	"context"
	"database/sql"
	"fmt"
	"time"
)

// SessionChange enumerates the lifecycle transitions that trigger
// recompute (FEAT-0009 / FEAT-0010 / ADR-0008).
type SessionChange string

const (
	SessionCreated     SessionChange = "created"
	SessionHardDeleted SessionChange = "hard_deleted"
	SessionCompacted   SessionChange = "compacted" // boot-janitor only
)

// VolumeMilestonesM lists the lifetime-distance achievement keys, in
// metres. Crossing each threshold inserts an `achievements` row.
var VolumeMilestonesM = []int{
	10_000, 25_000, 50_000, 100_000, 250_000, 500_000,
	1_000_000, 2_500_000, 5_000_000,
}

// VolumeMilestoneStrokes lists lifetime-stroke achievement thresholds.
var VolumeMilestoneStrokes = []int{10_000, 50_000, 100_000, 250_000, 500_000, 1_000_000}

// VolumeMilestoneSeconds lists lifetime-active-time thresholds, in
// seconds (10h, 50h, 100h, 250h, 500h).
var VolumeMilestoneSeconds = []int{36_000, 180_000, 360_000, 900_000, 1_800_000}

// Recompute reads each session's persisted candidate rows, picks the
// best per group via SQL, and writes pb_distance / pb_window /
// pb_workout / achievements + rower_lifetime_stats. Idempotent. Bumps
// stats_version on every call.
func Recompute(ctx context.Context, db *sql.DB, rowerID string) error {
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()

	now := time.Now().UTC().Format(time.RFC3339Nano)

	if err := recomputeDistance(ctx, tx, rowerID, now); err != nil {
		return err
	}
	if err := recomputeWindow(ctx, tx, rowerID, now); err != nil {
		return err
	}
	if err := recomputeWorkout(ctx, tx, rowerID, now); err != nil {
		return err
	}
	if err := recomputeConsistency(ctx, tx, rowerID, now); err != nil {
		return err
	}

	var totalDist, totalSec, totalStrokes, totalSessions int
	row := tx.QueryRowContext(ctx, `
		SELECT COALESCE(SUM(total_distance_m), 0),
		       COALESCE(SUM(total_time_sec), 0),
		       COALESCE(SUM(total_strokes), 0),
		       COUNT(*)
		FROM sessions
		WHERE rower_id = ? AND deleted_at IS NULL AND ended_at IS NOT NULL`, rowerID)
	var totalSecF float64
	if err := row.Scan(&totalDist, &totalSecF, &totalStrokes, &totalSessions); err != nil {
		return err
	}
	totalSec = int(totalSecF)

	if err := upsertLifetimeStats(ctx, tx, rowerID, totalDist, totalSec, totalStrokes, totalSessions, now); err != nil {
		return err
	}
	if err := recomputeVolumeMilestones(ctx, tx, rowerID, totalDist, totalSec, totalStrokes, now); err != nil {
		return err
	}
	return tx.Commit()
}

func recomputeDistance(ctx context.Context, tx *sql.Tx, rowerID, now string) error {
	if _, err := tx.ExecContext(ctx,
		`UPDATE pb_distance SET invalidated_at = ? WHERE rower_id = ? AND invalidated_at IS NULL`,
		now, rowerID); err != nil {
		return err
	}
	rows, err := tx.QueryContext(ctx, `
		SELECT distance_m, time_sec, session_id, started_at,
		       window_start_stroke, window_end_stroke
		FROM (
		  SELECT distance_m, time_sec, session_id, started_at,
		         window_start_stroke, window_end_stroke,
		         ROW_NUMBER() OVER (
		           PARTITION BY distance_m ORDER BY time_sec ASC, started_at ASC
		         ) AS rn
		  FROM session_pb_distance_candidates
		  WHERE rower_id = ?
		)
		WHERE rn = 1`, rowerID)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var distM, startNo, endNo int
		var timeSec float64
		var sessionID, startedAt string
		if err := rows.Scan(&distM, &timeSec, &sessionID, &startedAt, &startNo, &endNo); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO pb_distance(rower_id, distance_m, time_sec,
				source_session_id, source_session_started_at, achieved_at,
				window_start_stroke, window_end_stroke)
			VALUES(?, ?, ?, ?, ?, ?, ?, ?)`,
			rowerID, distM, timeSec, sessionID, startedAt, now, startNo, endNo,
		); err != nil {
			return err
		}
	}
	return rows.Err()
}

func recomputeWindow(ctx context.Context, tx *sql.Tx, rowerID, now string) error {
	if _, err := tx.ExecContext(ctx,
		`UPDATE pb_window SET invalidated_at = ? WHERE rower_id = ? AND invalidated_at IS NULL`,
		now, rowerID); err != nil {
		return err
	}
	// Pace is lower-is-better; everything else is higher-is-better.
	// Run two passes so the SQL stays simple.
	for _, p := range []struct {
		filter string
		order  string
	}{
		{filter: "metric = 'pace'", order: "ASC"},
		{filter: "metric <> 'pace'", order: "DESC"},
	} {
		q := fmt.Sprintf(`
			SELECT metric, window_kind, window_size, value, session_id, started_at
			FROM (
			  SELECT metric, window_kind, window_size, value, session_id, started_at,
			         ROW_NUMBER() OVER (
			           PARTITION BY metric, window_kind, window_size
			           ORDER BY value %s, started_at ASC
			         ) AS rn
			  FROM session_pb_window_candidates
			  WHERE rower_id = ? AND %s
			)
			WHERE rn = 1`, p.order, p.filter)
		rows, err := tx.QueryContext(ctx, q, rowerID)
		if err != nil {
			return err
		}
		for rows.Next() {
			var metric, kind, sessionID, startedAt string
			var size int
			var value float64
			if err := rows.Scan(&metric, &kind, &size, &value, &sessionID, &startedAt); err != nil {
				rows.Close()
				return err
			}
			if _, err := tx.ExecContext(ctx, `
				INSERT INTO pb_window(rower_id, metric, window_kind, window_size, value,
					source_session_id, source_session_started_at, achieved_at)
				VALUES(?, ?, ?, ?, ?, ?, ?, ?)`,
				rowerID, metric, kind, size, value, sessionID, startedAt, now,
			); err != nil {
				rows.Close()
				return err
			}
		}
		if err := rows.Err(); err != nil {
			rows.Close()
			return err
		}
		rows.Close()
	}
	return nil
}

func recomputeWorkout(ctx context.Context, tx *sql.Tx, rowerID, now string) error {
	if _, err := tx.ExecContext(ctx,
		`UPDATE pb_workout SET invalidated_at = ? WHERE rower_id = ? AND invalidated_at IS NULL`,
		now, rowerID); err != nil {
		return err
	}
	// time_sec values rank ASC (faster is better); other value_kinds
	// (distance_m) rank DESC. Branch on value_kind by partitioning the
	// query, same shape as the window recompute.
	for _, p := range []struct {
		filter string
		order  string
	}{
		{filter: "value_kind = 'time_sec'", order: "ASC"},
		{filter: "value_kind <> 'time_sec'", order: "DESC"},
	} {
		q := fmt.Sprintf(`
			SELECT shape_hash, mode, value_kind, value, session_id, started_at
			FROM (
			  SELECT shape_hash, mode, value_kind, value, session_id, started_at,
			         ROW_NUMBER() OVER (
			           PARTITION BY shape_hash
			           ORDER BY value %s, started_at ASC
			         ) AS rn
			  FROM session_pb_workout_candidate
			  WHERE rower_id = ? AND %s
			)
			WHERE rn = 1`, p.order, p.filter)
		rows, err := tx.QueryContext(ctx, q, rowerID)
		if err != nil {
			return err
		}
		type best struct {
			shapeHash, mode, valKind string
			value                    float64
			sessionID, startedAt     string
		}
		var bests []best
		for rows.Next() {
			var b best
			if err := rows.Scan(&b.shapeHash, &b.mode, &b.valKind, &b.value, &b.sessionID, &b.startedAt); err != nil {
				rows.Close()
				return err
			}
			bests = append(bests, b)
		}
		if err := rows.Err(); err != nil {
			rows.Close()
			return err
		}
		rows.Close()
		for _, b := range bests {
			// Pull the workout row tied to the source session for the
			// canonical mode + params snapshot. Fall back to the
			// candidate's own mode if the session has no attached
			// workout (defensive — workout candidates are only emitted
			// for attached workouts).
			mode := b.mode
			var params string
			var workoutID sql.NullString
			_ = tx.QueryRowContext(ctx,
				`SELECT workout_id FROM sessions WHERE id = ?`, b.sessionID).Scan(&workoutID)
			if workoutID.Valid {
				_ = tx.QueryRowContext(ctx,
					`SELECT mode, params_json FROM workout WHERE id = ?`,
					workoutID.String).Scan(&mode, &params)
			}
			if _, err := tx.ExecContext(ctx, `
				INSERT INTO pb_workout(rower_id, shape_hash, mode, params_json, value_kind, value,
					source_session_id, source_session_started_at, achieved_at)
				VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)`,
				rowerID, b.shapeHash, mode, params, b.valKind, b.value, b.sessionID, b.startedAt, now,
			); err != nil {
				return err
			}
		}
	}
	return nil
}

func recomputeConsistency(ctx context.Context, tx *sql.Tx, rowerID, now string) error {
	if _, err := tx.ExecContext(ctx,
		`UPDATE achievements SET invalidated_at = ?
		 WHERE rower_id = ? AND achievement_type = 'consistency_intra' AND invalidated_at IS NULL`,
		now, rowerID); err != nil {
		return err
	}
	// One best per CV metric. Each metric is lower-is-better.
	for _, m := range []struct {
		col, key string
	}{
		{"power_cv", "consistency_power_cv"},
		{"pace_split_cv", "consistency_pace_split_cv"},
		{"spm_cv", "consistency_spm_cv"},
	} {
		var value float64
		var sessionID, startedAt string
		err := tx.QueryRowContext(ctx, fmt.Sprintf(`
			SELECT %s, session_id, started_at
			FROM session_consistency
			WHERE rower_id = ?
			ORDER BY %s ASC, started_at ASC
			LIMIT 1`, m.col, m.col),
			rowerID).Scan(&value, &sessionID, &startedAt)
		if err == sql.ErrNoRows {
			continue
		}
		if err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO achievements(rower_id, achievement_type, achievement_key, value,
				source_session_id, source_session_started_at, achieved_at)
			VALUES(?, 'consistency_intra', ?, ?, ?, ?, ?)`,
			rowerID, m.key, value, sessionID, startedAt, now,
		); err != nil {
			return err
		}
	}
	return nil
}

func recomputeVolumeMilestones(ctx context.Context, tx *sql.Tx, rowerID string, dist, sec, strokes int, now string) error {
	if _, err := tx.ExecContext(ctx,
		`UPDATE achievements SET invalidated_at = ?
		 WHERE rower_id = ? AND achievement_type = 'volume' AND invalidated_at IS NULL`,
		now, rowerID); err != nil {
		return err
	}
	insert := func(key string, value float64) error {
		_, err := tx.ExecContext(ctx, `
			INSERT INTO achievements(rower_id, achievement_type, achievement_key, value, achieved_at)
			VALUES(?, 'volume', ?, ?, ?)`,
			rowerID, key, value, now)
		return err
	}
	for _, t := range VolumeMilestonesM {
		if dist >= t {
			if err := insert(fmt.Sprintf("distance_%dm", t), float64(t)); err != nil {
				return err
			}
		}
	}
	for _, t := range VolumeMilestoneStrokes {
		if strokes >= t {
			if err := insert(fmt.Sprintf("strokes_%d", t), float64(t)); err != nil {
				return err
			}
		}
	}
	for _, t := range VolumeMilestoneSeconds {
		if sec >= t {
			if err := insert(fmt.Sprintf("active_seconds_%d", t), float64(t)); err != nil {
				return err
			}
		}
	}
	return nil
}

func upsertLifetimeStats(ctx context.Context, tx *sql.Tx, rowerID string, dist, sec, strokes, sessions int, now string) error {
	_, err := tx.ExecContext(ctx, `
		INSERT INTO rower_lifetime_stats(rower_id, total_distance_m, total_active_sec,
			total_strokes, total_sessions, stats_version, computed_at)
		VALUES(?, ?, ?, ?, ?, 1, ?)
		ON CONFLICT(rower_id) DO UPDATE SET
			total_distance_m = excluded.total_distance_m,
			total_active_sec = excluded.total_active_sec,
			total_strokes = excluded.total_strokes,
			total_sessions = excluded.total_sessions,
			stats_version = rower_lifetime_stats.stats_version + 1,
			computed_at = excluded.computed_at`,
		rowerID, dist, sec, strokes, sessions, now)
	return err
}

// StatsVersion returns the current stats_version for a rower, used by
// the X-Stats-Version header. Returns 0 if no row exists yet.
func StatsVersion(ctx context.Context, db *sql.DB, rowerID string) (int, error) {
	var v int
	err := db.QueryRowContext(ctx,
		`SELECT stats_version FROM rower_lifetime_stats WHERE rower_id = ?`, rowerID).Scan(&v)
	if err == sql.ErrNoRows {
		return 0, nil
	}
	return v, err
}
