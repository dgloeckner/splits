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
	type best struct {
		distM, startNo, endNo int
		timeSec               float64
		sessionID, startedAt  string
	}
	var bests []best
	for rows.Next() {
		var b best
		if err := rows.Scan(&b.distM, &b.timeSec, &b.sessionID, &b.startedAt, &b.startNo, &b.endNo); err != nil {
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

	if _, err := tx.ExecContext(ctx,
		`UPDATE pb_distance SET invalidated_at = ? WHERE rower_id = ? AND invalidated_at IS NULL`,
		now, rowerID); err != nil {
		return err
	}
	for _, b := range bests {
		// Look at the row we just invalidated — keep the chain across
		// idempotent recomputes by carrying its previous_time_sec when
		// the active value did not actually improve.
		var oldTime sql.NullFloat64
		var oldPrev sql.NullFloat64
		_ = tx.QueryRowContext(ctx, `
			SELECT time_sec, previous_time_sec FROM pb_distance
			WHERE rower_id=? AND distance_m=? AND invalidated_at=?
			ORDER BY id DESC LIMIT 1`,
			rowerID, b.distM, now).Scan(&oldTime, &oldPrev)
		var prev sql.NullFloat64
		if oldTime.Valid {
			if oldTime.Float64 == b.timeSec {
				prev = oldPrev
			} else {
				prev = sql.NullFloat64{Float64: oldTime.Float64, Valid: true}
			}
		}
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO pb_distance(rower_id, distance_m, time_sec, previous_time_sec,
				source_session_id, source_session_started_at, achieved_at,
				window_start_stroke, window_end_stroke)
			VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			rowerID, b.distM, b.timeSec, prev, b.sessionID, b.startedAt, now, b.startNo, b.endNo,
		); err != nil {
			return err
		}
	}
	return nil
}

func recomputeWindow(ctx context.Context, tx *sql.Tx, rowerID, now string) error {
	type best struct {
		metric, kind, sessionID, startedAt string
		size                               int
		value                              float64
	}
	var bests []best
	// Pace window-PBs were retired (split is sec/500m by definition;
	// distance-PBs cover the split story). Remaining metrics are all
	// higher-is-better. Recompute always invalidates the full pb_window
	// table first and re-inserts from the filtered candidate set, so
	// any stale pace rows from the old WindowDefs naturally drop out.
	for _, p := range []struct {
		filter string
		order  string
	}{
		{filter: "metric IN ('power','dps','spi')", order: "DESC"},
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
			var b best
			if err := rows.Scan(&b.metric, &b.kind, &b.size, &b.value, &b.sessionID, &b.startedAt); err != nil {
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
	}

	if _, err := tx.ExecContext(ctx,
		`UPDATE pb_window SET invalidated_at = ? WHERE rower_id = ? AND invalidated_at IS NULL`,
		now, rowerID); err != nil {
		return err
	}
	for _, b := range bests {
		var oldVal sql.NullFloat64
		var oldPrev sql.NullFloat64
		_ = tx.QueryRowContext(ctx, `
			SELECT value, previous_value FROM pb_window
			WHERE rower_id=? AND metric=? AND window_kind=? AND window_size=? AND invalidated_at=?
			ORDER BY id DESC LIMIT 1`,
			rowerID, b.metric, b.kind, b.size, now).Scan(&oldVal, &oldPrev)
		var prev sql.NullFloat64
		if oldVal.Valid {
			if oldVal.Float64 == b.value {
				prev = oldPrev
			} else {
				prev = sql.NullFloat64{Float64: oldVal.Float64, Valid: true}
			}
		}
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO pb_window(rower_id, metric, window_kind, window_size, value, previous_value,
				source_session_id, source_session_started_at, achieved_at)
			VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			rowerID, b.metric, b.kind, b.size, b.value, prev, b.sessionID, b.startedAt, now,
		); err != nil {
			return err
		}
	}
	return nil
}

func recomputeWorkout(ctx context.Context, tx *sql.Tx, rowerID, now string) error {
	type best struct {
		shapeHash, mode, valKind string
		value                    float64
		sessionID, startedAt     string
	}
	var allBests []best
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
		for rows.Next() {
			var b best
			if err := rows.Scan(&b.shapeHash, &b.mode, &b.valKind, &b.value, &b.sessionID, &b.startedAt); err != nil {
				rows.Close()
				return err
			}
			allBests = append(allBests, b)
		}
		if err := rows.Err(); err != nil {
			rows.Close()
			return err
		}
		rows.Close()
	}

	if _, err := tx.ExecContext(ctx,
		`UPDATE pb_workout SET invalidated_at = ? WHERE rower_id = ? AND invalidated_at IS NULL`,
		now, rowerID); err != nil {
		return err
	}
	for _, b := range allBests {
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
		var oldVal sql.NullFloat64
		var oldPrev sql.NullFloat64
		_ = tx.QueryRowContext(ctx, `
			SELECT value, previous_value FROM pb_workout
			WHERE rower_id=? AND shape_hash=? AND invalidated_at=?
			ORDER BY id DESC LIMIT 1`,
			rowerID, b.shapeHash, now).Scan(&oldVal, &oldPrev)
		var prev sql.NullFloat64
		if oldVal.Valid {
			if oldVal.Float64 == b.value {
				prev = oldPrev
			} else {
				prev = sql.NullFloat64{Float64: oldVal.Float64, Valid: true}
			}
		}
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO pb_workout(rower_id, shape_hash, mode, params_json, value_kind, value, previous_value,
				source_session_id, source_session_started_at, achieved_at)
			VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			rowerID, b.shapeHash, mode, params, b.valKind, b.value, prev, b.sessionID, b.startedAt, now,
		); err != nil {
			return err
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
			rowerID, m.key, value, sessionID, startedAt, startedAt,
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

	// Walk sessions in chronological order, tracking cumulative
	// distance / strokes / seconds. The first row whose running total
	// reaches a threshold is the genuine first-crossing — its
	// started_at becomes the milestone's achieved_at, stable across
	// subsequent recomputes.
	rows, err := tx.QueryContext(ctx, `
		SELECT id, started_at, total_distance_m, total_time_sec, total_strokes
		FROM sessions
		WHERE rower_id = ? AND deleted_at IS NULL AND ended_at IS NOT NULL
		ORDER BY started_at ASC, id ASC`, rowerID)
	if err != nil {
		return err
	}
	type crossing struct {
		key, sessionID, startedAt string
		value                     float64
	}
	var (
		crossings                             []crossing
		cumDist, cumStrokes                   int
		cumSec                                float64
		nextDistI, nextStrokesI, nextSecondsI int
	)
	for rows.Next() {
		var sid, startedAt string
		var d, s int
		var t float64
		if err := rows.Scan(&sid, &startedAt, &d, &t, &s); err != nil {
			rows.Close()
			return err
		}
		cumDist += d
		cumStrokes += s
		cumSec += t
		for nextDistI < len(VolumeMilestonesM) && cumDist >= VolumeMilestonesM[nextDistI] {
			th := VolumeMilestonesM[nextDistI]
			crossings = append(crossings, crossing{
				key: fmt.Sprintf("distance_%dm", th), value: float64(th),
				sessionID: sid, startedAt: startedAt,
			})
			nextDistI++
		}
		for nextStrokesI < len(VolumeMilestoneStrokes) && cumStrokes >= VolumeMilestoneStrokes[nextStrokesI] {
			th := VolumeMilestoneStrokes[nextStrokesI]
			crossings = append(crossings, crossing{
				key: fmt.Sprintf("strokes_%d", th), value: float64(th),
				sessionID: sid, startedAt: startedAt,
			})
			nextStrokesI++
		}
		for nextSecondsI < len(VolumeMilestoneSeconds) && int(cumSec) >= VolumeMilestoneSeconds[nextSecondsI] {
			th := VolumeMilestoneSeconds[nextSecondsI]
			crossings = append(crossings, crossing{
				key: fmt.Sprintf("active_seconds_%d", th), value: float64(th),
				sessionID: sid, startedAt: startedAt,
			})
			nextSecondsI++
		}
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return err
	}
	rows.Close()

	// Defensive: the lifetime totals computed up-tree should agree
	// with the cumulative walk. If the walk missed any threshold the
	// totals say is crossed, fall back to `now` for that one — better
	// than silently dropping the milestone.
	have := map[string]bool{}
	for _, c := range crossings {
		have[c.key] = true
	}
	addFallback := func(key string, value float64) {
		if have[key] {
			return
		}
		crossings = append(crossings, crossing{key: key, value: value, startedAt: now})
		have[key] = true
	}
	for _, t := range VolumeMilestonesM {
		if dist >= t {
			addFallback(fmt.Sprintf("distance_%dm", t), float64(t))
		}
	}
	for _, t := range VolumeMilestoneStrokes {
		if strokes >= t {
			addFallback(fmt.Sprintf("strokes_%d", t), float64(t))
		}
	}
	for _, t := range VolumeMilestoneSeconds {
		if sec >= t {
			addFallback(fmt.Sprintf("active_seconds_%d", t), float64(t))
		}
	}

	for _, c := range crossings {
		var sessionID, sessionStart sql.NullString
		if c.sessionID != "" {
			sessionID = sql.NullString{String: c.sessionID, Valid: true}
			sessionStart = sql.NullString{String: c.startedAt, Valid: true}
		}
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO achievements(rower_id, achievement_type, achievement_key, value,
				source_session_id, source_session_started_at, achieved_at)
			VALUES(?, 'volume', ?, ?, ?, ?, ?)`,
			rowerID, c.key, c.value, sessionID, sessionStart, c.startedAt,
		); err != nil {
			return err
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
