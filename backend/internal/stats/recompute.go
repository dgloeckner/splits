package stats

import (
	"context"
	"database/sql"
	"encoding/json"
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

type sessionRec struct {
	id         string
	startedAt  string
	distanceM  int
	timeSec    float64
	strokes    int
	workoutID  sql.NullString
	candidates *PBCandidates
}

// Recompute reads every non-deleted session for the rower, picks the
// best candidates, and writes pb_distance / pb_window / pb_workout /
// achievements + rower_lifetime_stats. Idempotent. Bumps the
// rower's stats_version on every call.
func Recompute(ctx context.Context, db *sql.DB, rowerID string) error {
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()

	rows, err := tx.QueryContext(ctx, `
		SELECT id, started_at, total_distance_m, total_time_sec, total_strokes, summary_json, workout_id
		FROM sessions
		WHERE rower_id = ? AND deleted_at IS NULL AND ended_at IS NOT NULL
		ORDER BY started_at`, rowerID)
	if err != nil {
		return err
	}
	var recs []sessionRec
	for rows.Next() {
		var r sessionRec
		var summaryStr sql.NullString
		var dist, strokes sql.NullInt64
		var timeSec sql.NullFloat64
		if err := rows.Scan(&r.id, &r.startedAt, &dist, &timeSec, &strokes, &summaryStr, &r.workoutID); err != nil {
			rows.Close()
			return err
		}
		r.distanceM = int(dist.Int64)
		r.timeSec = timeSec.Float64
		r.strokes = int(strokes.Int64)
		if summaryStr.Valid {
			var sum struct {
				PBCandidates *PBCandidates `json:"pb_candidates"`
			}
			if err := json.Unmarshal([]byte(summaryStr.String), &sum); err == nil {
				r.candidates = sum.PBCandidates
			}
		}
		recs = append(recs, r)
	}
	rows.Close()

	now := time.Now().UTC().Format(time.RFC3339Nano)

	if err := recomputeDistance(ctx, tx, rowerID, recs, now); err != nil {
		return err
	}
	if err := recomputeWindow(ctx, tx, rowerID, recs, now); err != nil {
		return err
	}
	if err := recomputeWorkout(ctx, tx, rowerID, recs, now); err != nil {
		return err
	}
	if err := recomputeConsistency(ctx, tx, rowerID, recs, now); err != nil {
		return err
	}

	var totalDist, totalSec, totalStrokes, totalSessions int
	for _, r := range recs {
		totalDist += r.distanceM
		totalSec += int(r.timeSec)
		totalStrokes += r.strokes
		totalSessions++
	}
	if err := upsertLifetimeStats(ctx, tx, rowerID, totalDist, totalSec, totalStrokes, totalSessions, now); err != nil {
		return err
	}
	if err := recomputeVolumeMilestones(ctx, tx, rowerID, totalDist, totalSec, totalStrokes, now); err != nil {
		return err
	}

	return tx.Commit()
}

func recomputeDistance(ctx context.Context, tx *sql.Tx, rowerID string, recs []sessionRec, now string) error {
	type best struct {
		val       float64
		sessionID string
		startedAt string
		startNo   int
		endNo     int
	}
	bests := map[int]*best{}
	for _, r := range recs {
		if r.candidates == nil {
			continue
		}
		for _, c := range r.candidates.Distance {
			cur := bests[c.DistanceM]
			if cur == nil || c.TimeSec < cur.val {
				bests[c.DistanceM] = &best{c.TimeSec, r.id, r.startedAt, c.WindowStartStroke, c.WindowEndStroke}
			}
		}
	}
	if _, err := tx.ExecContext(ctx,
		`UPDATE pb_distance SET invalidated_at = ? WHERE rower_id = ? AND invalidated_at IS NULL`,
		now, rowerID); err != nil {
		return err
	}
	for d, b := range bests {
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO pb_distance(rower_id, distance_m, time_sec,
				source_session_id, source_session_started_at, achieved_at,
				window_start_stroke, window_end_stroke)
			VALUES(?, ?, ?, ?, ?, ?, ?, ?)`,
			rowerID, d, b.val, b.sessionID, b.startedAt, now, b.startNo, b.endNo,
		); err != nil {
			return err
		}
	}
	return nil
}

func recomputeWindow(ctx context.Context, tx *sql.Tx, rowerID string, recs []sessionRec, now string) error {
	type key struct {
		metric string
		kind   string
		size   int
	}
	type best struct {
		val       float64
		sessionID string
		startedAt string
	}
	bests := map[key]*best{}
	for _, r := range recs {
		if r.candidates == nil {
			continue
		}
		for _, c := range r.candidates.Window {
			k := key{c.Metric, c.Kind, c.Size}
			cur := bests[k]
			if cur == nil || better(c.Metric, c.Value, cur.val) {
				bests[k] = &best{c.Value, r.id, r.startedAt}
			}
		}
	}
	if _, err := tx.ExecContext(ctx,
		`UPDATE pb_window SET invalidated_at = ? WHERE rower_id = ? AND invalidated_at IS NULL`,
		now, rowerID); err != nil {
		return err
	}
	for k, b := range bests {
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO pb_window(rower_id, metric, window_kind, window_size, value,
				source_session_id, source_session_started_at, achieved_at)
			VALUES(?, ?, ?, ?, ?, ?, ?, ?)`,
			rowerID, k.metric, k.kind, k.size, b.val, b.sessionID, b.startedAt, now,
		); err != nil {
			return err
		}
	}
	return nil
}

func recomputeWorkout(ctx context.Context, tx *sql.Tx, rowerID string, recs []sessionRec, now string) error {
	type best struct {
		val       float64
		valKind   string
		mode      string
		params    string
		sessionID string
		startedAt string
	}
	bests := map[string]*best{}
	for _, r := range recs {
		if r.candidates == nil || r.candidates.Workout == nil {
			continue
		}
		c := r.candidates.Workout
		isBetter := func(v, ref float64) bool {
			if c.ValueKind == "time_sec" {
				return v < ref
			}
			return v > ref
		}
		cur := bests[c.ShapeHash]
		if cur != nil && !isBetter(c.Value, cur.val) {
			continue
		}
		b := &best{val: c.Value, valKind: c.ValueKind, mode: c.Mode, sessionID: r.id, startedAt: r.startedAt}
		if r.workoutID.Valid {
			_ = tx.QueryRowContext(ctx, `SELECT mode, params_json FROM workout WHERE id = ?`,
				r.workoutID.String).Scan(&b.mode, &b.params)
		}
		bests[c.ShapeHash] = b
	}
	if _, err := tx.ExecContext(ctx,
		`UPDATE pb_workout SET invalidated_at = ? WHERE rower_id = ? AND invalidated_at IS NULL`,
		now, rowerID); err != nil {
		return err
	}
	for hash, b := range bests {
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO pb_workout(rower_id, shape_hash, mode, params_json, value_kind, value,
				source_session_id, source_session_started_at, achieved_at)
			VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			rowerID, hash, b.mode, b.params, b.valKind, b.val, b.sessionID, b.startedAt, now,
		); err != nil {
			return err
		}
	}
	return nil
}

func recomputeConsistency(ctx context.Context, tx *sql.Tx, rowerID string, recs []sessionRec, now string) error {
	type best struct {
		val       float64
		sessionID string
		startedAt string
	}
	bests := map[string]*best{}
	for _, r := range recs {
		if r.candidates == nil || r.candidates.Consistency == nil {
			continue
		}
		c := r.candidates.Consistency
		for k, v := range map[string]float64{
			"consistency_power_cv":      c.PowerCV,
			"consistency_pace_split_cv": c.PaceSplitCV,
			"consistency_spm_cv":        c.SPMCV,
		} {
			cur := bests[k]
			if cur == nil || v < cur.val {
				bests[k] = &best{v, r.id, r.startedAt}
			}
		}
	}
	if _, err := tx.ExecContext(ctx,
		`UPDATE achievements SET invalidated_at = ?
		 WHERE rower_id = ? AND achievement_type = 'consistency_intra' AND invalidated_at IS NULL`,
		now, rowerID); err != nil {
		return err
	}
	for k, b := range bests {
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO achievements(rower_id, achievement_type, achievement_key, value,
				source_session_id, source_session_started_at, achieved_at)
			VALUES(?, 'consistency_intra', ?, ?, ?, ?, ?)`,
			rowerID, k, b.val, b.sessionID, b.startedAt, now,
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
