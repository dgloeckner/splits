package storage

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"log/slog"
	"time"

	"github.com/gloeckner-daniel/splits/internal/event"
	"github.com/gloeckner-daniel/splits/internal/insights"
	"github.com/gloeckner-daniel/splits/internal/stats"
)

// FinaliseReason records which lifecycle path closed the session.
type FinaliseReason string

const (
	FinaliseEnded FinaliseReason = "ended"
	FinaliseStale FinaliseReason = "stale"
	FinaliseBoot  FinaliseReason = "boot"
)

// ErrZeroStrokes is returned by FinaliseSession when the session has no
// strokes. Boot janitor callers should hard-delete the row (B4). Stale
// callers return 204 at the API level.
var ErrZeroStrokes = errors.New("storage: session has zero strokes")

// FilterWorkStrokes returns only work-phase strokes (phase == "work" or
// phase == "" for legacy untagged rows). This is the single canonical
// implementation; the three previously-private copies in persister.go,
// stale_janitor.go, and janitor.go all delegate here.
func FilterWorkStrokes(in []event.StrokePayload) []event.StrokePayload {
	out := make([]event.StrokePayload, 0, len(in))
	for _, s := range in {
		if s.Phase == "" || s.Phase == "work" {
			out = append(out, s)
		}
	}
	return out
}

// FinaliseSession is the single seam every shutdown path goes through.
//
// strokes may be nil: when nil they are loaded from the DB.
//
// Reason gates behaviour:
//   - FinaliseEnded: race result + insights computed; Flags empty;
//     lastEventID persisted as supplied.
//   - FinaliseStale: Race forced nil (ADR-0012); no insights written;
//     Flags = ["recovered"]; lastEventID persisted as 0.
//   - FinaliseBoot: summary built from work-only strokes; no race/insights;
//     Flags = ["recovered"]; lastEventID persisted as 0.
//
// Zero-stroke sessions return ErrZeroStrokes without touching the DB.
//
// The summary UPDATE is guarded by "WHERE ended_at IS NULL" so concurrent
// or double-finalise calls lose cleanly (idempotent).
//
// When sched is non-nil and the session has a rowerID, an async stats
// recompute is triggered after the commit.
func FinaliseSession(
	ctx context.Context,
	db *sql.DB,
	sessionID string,
	endedAt time.Time,
	base event.SessionSummary,
	strokes []event.StrokePayload,
	lastEventID uint64,
	reason FinaliseReason,
	sched *stats.RecomputeScheduler,
) (event.SessionSummary, error) {
	// Step 1: load strokes if not supplied by the caller.
	if strokes == nil {
		var err error
		strokes, err = LoadSessionStrokes(ctx, db, sessionID)
		if err != nil {
			return event.SessionSummary{}, err
		}
	}

	// Step 2: zero-stroke guard (B4 for boot; 204 for stale API).
	// The FinaliseEnded path is permitted to have zero strokes because
	// the sessionizer's summary is authoritative (it may carry
	// session-level metrics computed without strokes being persisted).
	if len(strokes) == 0 && reason != FinaliseEnded {
		return event.SessionSummary{}, ErrZeroStrokes
	}

	// Step 3: work-only subset.
	workStrokes := FilterWorkStrokes(strokes)

	// Step 4: build summary from work strokes (totals, averages).
	summary := base
	if reason == FinaliseBoot || reason == FinaliseStale {
		// Recovery paths: recompute summary from strokes because the
		// base summary is empty or unreliable.
		summary = buildSummary(strokes)
	}

	// Step 5: compute samples from work strokes.
	summary.Samples = stats.ComputeSamples(workStrokes, stats.BucketStrokesFor(len(workStrokes)))

	// Step 6: compute PB candidates (internal filtering is work-only).
	summary.PBCandidates = stats.ComputeCandidates(strokes)

	// Pre-load rower + workout context (needed for race result, insights,
	// and the recompute trigger).
	var rowerID, workoutMode, workoutID string
	if err := db.QueryRowContext(ctx, `
		SELECT s.rower_id, COALESCE(w.mode, ''), COALESCE(s.workout_id, '')
		FROM sessions s
		LEFT JOIN workout w ON w.id = s.workout_id
		WHERE s.id = ?`, sessionID).Scan(&rowerID, &workoutMode, &workoutID); err != nil {
		return event.SessionSummary{}, err
	}

	// Step 7 & 8: reason-specific gates.
	switch reason {
	case FinaliseEnded:
		// Compute race result (non-nil only for race-mode workouts that
		// finished at or past the target distance).
		if raceRes, raceErr := ComputeRaceResult(ctx, db, workoutID, rowerID,
			summary.TotalDistanceM, summary.TotalTimeSec); raceErr == nil {
			summary.Race = raceRes
		}
		// Flags stays empty for the normal ended path.

	case FinaliseStale:
		// ADR-0012: interrupted races never produce a race result.
		summary.Race = nil
		summary.Flags = []string{"recovered"}
		lastEventID = 0

	case FinaliseBoot:
		summary.Race = nil
		summary.Flags = []string{"recovered"}
		lastEventID = 0
	}

	// Step 9: write summary with WHERE ended_at IS NULL (idempotent guard).
	var summaryStr sql.NullString
	if summary.Samples != nil {
		blob, err := json.Marshal(samplesEnvelope{Samples: summary.Samples})
		if err != nil {
			return event.SessionSummary{}, err
		}
		summaryStr = sql.NullString{String: string(blob), Valid: true}
	}

	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return event.SessionSummary{}, err
	}
	defer func() { _ = tx.Rollback() }()

	res, err := tx.ExecContext(ctx, `
		UPDATE sessions SET
			ended_at = ?,
			total_distance_m = ?, total_time_sec = ?, total_strokes = ?,
			avg_power_w = ?, peak_power_w = ?,
			avg_spm = ?, avg_dps = ?, avg_spi = ?,
			avg_pace_sec_per_500m = ?, session_calories = ?,
			summary_json = ?, last_event_id = ?
		WHERE id = ? AND ended_at IS NULL`,
		endedAt.UTC().Format(time.RFC3339Nano),
		summary.TotalDistanceM, summary.TotalTimeSec, summary.TotalStrokes,
		float64(summary.AvgPowerW), float64(summary.PeakPowerW),
		summary.AvgSPM, summary.AvgDPS, float64(summary.AvgSPI),
		float64(summary.AvgPaceSecPer500m), float64(summary.SessionCalories),
		summaryStr, lastEventID, sessionID,
	)
	if err != nil {
		return event.SessionSummary{}, err
	}

	// If the guard filtered us out (already ended), skip candidate writes too.
	// Idempotent: return what we computed without error.
	rowsAffected, err := res.RowsAffected()
	if err != nil {
		return event.SessionSummary{}, err
	}
	if rowsAffected > 0 {
		// Replace candidate rows (idempotent for re-finalises).
		if err := DeleteSessionCandidates(ctx, tx, sessionID); err != nil {
			return event.SessionSummary{}, err
		}
		cands, _ := summary.PBCandidates.(*stats.PBCandidates)
		if cands != nil {
			// Re-use the shared candidate writer from queries.go by building a
			// temporary summary and delegating — but to avoid re-entering the
			// UPDATE logic we write candidates directly.
			if err := insertCandidates(ctx, tx, sessionID, cands); err != nil {
				return event.SessionSummary{}, err
			}
		}

		// Step 11: write insights for FinaliseEnded with a known rowerID.
		if reason == FinaliseEnded && rowerID != "" {
			insightsRes := computeInsightsSafely(insights.SessionMeta{
				WorkoutMode: workoutMode,
				DurationSec: summary.TotalTimeSec,
				DistanceM:   summary.TotalDistanceM,
			}, summary.Samples)
			if err := insights.ReplaceForSessionTx(ctx, tx, rowerID, sessionID, insightsRes.Findings); err != nil {
				return event.SessionSummary{}, err
			}
		}
	}

	if err := tx.Commit(); err != nil {
		return event.SessionSummary{}, err
	}

	// Step 12: trigger async stats recompute.
	if rowsAffected > 0 && sched != nil && rowerID != "" {
		stats.OnSessionChange(sched, rowerID, stats.SessionCreated)
	}

	return summary, nil
}

// computeInsightsSafely runs the insights pipeline with panic recovery.
// A panic in a detector logs and returns an empty result; the commit
// still succeeds without insights.
func computeInsightsSafely(meta insights.SessionMeta, samples *event.SessionSamples) (res insights.Result) {
	defer func() {
		if r := recover(); r != nil {
			slog.Error("insights.compute panic", "err", r)
			res = insights.Result{Eligible: false, Findings: []insights.Finding{}}
		}
	}()
	return insights.Run(meta, samples)
}

// insertCandidates writes the PB candidate rows for a session inside a
// transaction. It mirrors the candidate-insert block in
// UpdateSessionEndWithEventID but is called from FinaliseSession where we
// need to control the surrounding UPDATE guard separately.
func insertCandidates(ctx context.Context, db dbExec, sessionID string, cands *stats.PBCandidates) error {
	if cands == nil {
		return nil
	}
	var rowerID, startedAt string
	if err := db.QueryRowContext(ctx,
		`SELECT rower_id, started_at FROM sessions WHERE id = ?`, sessionID,
	).Scan(&rowerID, &startedAt); err != nil {
		return err
	}
	for _, c := range cands.Distance {
		if _, err := db.ExecContext(ctx, `
			INSERT INTO session_pb_distance_candidates(
				session_id, rower_id, started_at, distance_m, time_sec,
				window_start_stroke, window_end_stroke)
			VALUES(?, ?, ?, ?, ?, ?, ?)`,
			sessionID, rowerID, startedAt, c.DistanceM, c.TimeSec,
			c.WindowStartStroke, c.WindowEndStroke,
		); err != nil {
			return err
		}
	}
	for _, c := range cands.Window {
		if _, err := db.ExecContext(ctx, `
			INSERT INTO session_pb_window_candidates(
				session_id, rower_id, started_at, metric, window_kind,
				window_size, value)
			VALUES(?, ?, ?, ?, ?, ?, ?)`,
			sessionID, rowerID, startedAt, c.Metric, c.Kind, c.Size, c.Value,
		); err != nil {
			return err
		}
	}
	if w := cands.Workout; w != nil {
		if _, err := db.ExecContext(ctx, `
			INSERT INTO session_pb_workout_candidate(
				session_id, rower_id, started_at, shape_hash, mode,
				value_kind, value)
			VALUES(?, ?, ?, ?, ?, ?, ?)`,
			sessionID, rowerID, startedAt, w.ShapeHash, w.Mode, w.ValueKind, w.Value,
		); err != nil {
			return err
		}
	}
	if c := cands.Consistency; c != nil {
		if _, err := db.ExecContext(ctx, `
			INSERT INTO session_consistency(
				session_id, rower_id, started_at, power_cv, pace_split_cv, spm_cv)
			VALUES(?, ?, ?, ?, ?, ?)`,
			sessionID, rowerID, startedAt, c.PowerCV, c.PaceSplitCV, c.SPMCV,
		); err != nil {
			return err
		}
	}
	return nil
}
