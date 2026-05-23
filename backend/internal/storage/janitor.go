package storage

import (
	"context"
	"database/sql"
	"encoding/json"
	"log/slog"
	"time"

	"github.com/gloeckner-daniel/splits/internal/event"
	"github.com/gloeckner-daniel/splits/internal/stats"
)

// BootJanitor finalises any session that was left open across a
// process restart and verifies post-end invariants (no strokes for
// ended sessions). FEAT-0009 background-jobs spec, runs once at
// process start.
type BootJanitor struct {
	DB        *sql.DB
	Scheduler *stats.RecomputeScheduler
}

// RunJanitorOnce runs all stateless cleanup passes once and returns.
// Exposed so integration tests can invoke the janitor deterministically
// without spinning up a goroutine. Production callers use BootJanitor.
func RunJanitorOnce(ctx context.Context, db *sql.DB) error {
	return purgeExpiredPairingTokens(ctx, db)
}

// purgeExpiredPairingTokens deletes pairing_tokens whose expires_at is
// in the past. FEAT-0002.
func purgeExpiredPairingTokens(ctx context.Context, db *sql.DB) error {
	if _, err := db.ExecContext(ctx,
		`DELETE FROM pairing_tokens WHERE expires_at < ?`,
		time.Now().UTC().Format(time.RFC3339Nano)); err != nil {
		return err
	}
	return nil
}

// Run sweeps the database. Best-effort: errors are logged, never
// returned (we never want to refuse to start the process for a
// janitor hiccup).
func (j *BootJanitor) Run(ctx context.Context) {
	if err := j.finaliseOrphans(ctx); err != nil {
		slog.Error("janitor.finalise", "err", err)
	}
	// repairLeftoverStrokes was retired by FEAT-0015 Slice 4 / ADR-0011:
	// ended sessions are *expected* to retain their strokes (replay-grade
	// persistence). Wiping them at boot would defeat the invariant.
	if err := purgeExpiredPairingTokens(ctx, j.DB); err != nil {
		slog.Error("janitor.purge_pairing_tokens", "err", err)
	}
	// B6: self-heal stats for any rower whose latest session ended
	// after the lifetime_stats was last computed — i.e. the async
	// post-session-end recompute didn't run (e.g. the backend was
	// shut down before the scheduler drained). Without this, PBs and
	// totals stay stuck on the prior recompute and the user sees
	// stale data.
	if err := RecomputeStaleRowerStats(ctx, j.DB); err != nil {
		slog.Error("janitor.recompute_stale", "err", err)
	}
}

// RecomputeStaleRowerStats runs stats.Recompute synchronously for
// every rower whose most recent ended-session is newer than their
// rower_lifetime_stats.computed_at — i.e. the async OnSessionChange
// recompute didn't land (backend shutdown mid-recompute, scheduler
// failure, etc.). Rowers without a lifetime_stats row at all are also
// recomputed (first-session-ever case). Idempotent: a run-in-a-row
// against an up-to-date state picks up zero candidates.
//
// Called both at boot (BootJanitor) and on the periodic sweep
// (StartStaleJanitor) so any stale-stats state is auto-healed within
// at most one tick of the sweep cadence.
func RecomputeStaleRowerStats(ctx context.Context, db *sql.DB) error {
	rows, err := db.QueryContext(ctx, `
		SELECT DISTINCT s.rower_id
		FROM sessions s
		LEFT JOIN rower_lifetime_stats r ON r.rower_id = s.rower_id
		WHERE s.deleted_at IS NULL
		  AND s.ended_at IS NOT NULL
		  AND s.rower_id != ''
		  AND (
		    r.rower_id IS NULL
		    OR s.ended_at > r.computed_at
		  )`)
	if err != nil {
		return err
	}
	defer rows.Close()
	var rowerIDs []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return err
		}
		rowerIDs = append(rowerIDs, id)
	}
	if err := rows.Err(); err != nil {
		return err
	}
	for _, id := range rowerIDs {
		if err := stats.Recompute(ctx, db, id); err != nil {
			slog.Error("janitor.recompute", "rower_id", id, "err", err)
			// Continue with the remaining rowers; one failure shouldn't
			// stop the sweep.
		}
	}
	return nil
}

func (j *BootJanitor) finaliseOrphans(ctx context.Context) error {
	rows, err := j.DB.QueryContext(ctx, `
		SELECT id, rower_id FROM sessions
		WHERE ended_at IS NULL`)
	if err != nil {
		return err
	}
	defer rows.Close()
	type orphan struct{ id, rowerID string }
	var orphans []orphan
	for rows.Next() {
		var o orphan
		if err := rows.Scan(&o.id, &o.rowerID); err != nil {
			return err
		}
		orphans = append(orphans, o)
	}
	for _, o := range orphans {
		if err := j.finaliseOne(ctx, o.id); err != nil {
			slog.Error("janitor.finalise.session", "session_id", o.id, "err", err)
			continue
		}
		slog.Info("janitor.recovered", "session_id", o.id)
		if j.Scheduler != nil {
			stats.OnSessionChange(j.Scheduler, o.rowerID, stats.SessionCreated)
		}
	}
	return nil
}

func (j *BootJanitor) finaliseOne(ctx context.Context, id string) error {
	tx, err := j.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()

	strokes, err := LoadSessionStrokes(ctx, tx, id)
	if err != nil {
		return err
	}
	// B4: a session opened but never rowed (StartSession with no
	// subsequent strokes — e.g. user tapped Start, walked away) is
	// not a "recoverable" workout; finalising it as one produced
	// zero-totals "ghost" rows that polluted history and the
	// trends/PB aggregates. Drop the row entirely. Domain rule:
	// a rower has at most one open session at a time, and an
	// open session without strokes carries no signal.
	if len(strokes) == 0 {
		if _, err := tx.ExecContext(ctx, `DELETE FROM sessions WHERE id = ?`, id); err != nil {
			return err
		}
		return tx.Commit()
	}

	endedAt := time.Now().UTC()
	summary := buildSummary(strokes)
	summary.Samples = stats.ComputeSamples(strokes, stats.BucketStrokesFor(len(strokes)))
	summary.PBCandidates = stats.ComputeCandidates(strokes)
	// Mark as recovered so the UI / history can flag it.
	summary.Flags = []string{"recovered"}

	if err := UpdateSessionEnd(ctx, tx, id, endedAt, summary); err != nil {
		return err
	}
	// Strokes are intentionally NOT deleted here (FEAT-0015 Slice 4 /
	// ADR-0011): ended sessions retain their strokes for replay; only
	// the FEAT-0009 hard-delete endpoint removes them.
	return tx.Commit()
}

// buildSummary computes session totals + averages from strokes. Used
// by the boot janitor and the stale-open finalizer — the live pipeline
// computes its own via the sessionizer's accumulator.
//
// Work-only semantics: warmup/rest/cooldown strokes are excluded from
// totals/averages and TotalDistanceM/TotalTimeSec are the *delta* from
// the first work stroke (mirrors the sessionizer's workAnchor; see
// CONTEXT.md §Workout phases). Strokes without a Phase tag (legacy
// pre-phase-tagging rows) are treated as work for backward
// compatibility.
func buildSummary(strokes []event.StrokePayload) event.SessionSummary {
	var s event.SessionSummary
	if len(strokes) == 0 {
		return s
	}
	work := make([]event.StrokePayload, 0, len(strokes))
	for _, p := range strokes {
		if p.Phase == "" || p.Phase == "work" {
			work = append(work, p)
		}
	}
	if len(work) == 0 {
		return s
	}
	first := work[0]
	last := work[len(work)-1]
	s.TotalStrokes = len(work)
	s.TotalDistanceM = last.DistanceM - first.DistanceM
	s.TotalTimeSec = last.TimeSec - first.TimeSec
	var powerSum, spmSum, paceSum, calSum int
	var dpsSum float64
	for _, p := range work {
		powerSum += p.PowerW
		spmSum += p.SPM
		dpsSum += p.DPS
		paceSum += p.PaceSecPer500m
		calSum += p.EnergyJoules
		if p.PowerW > s.PeakPowerW {
			s.PeakPowerW = p.PowerW
		}
	}
	n := len(work)
	s.AvgPowerW = powerSum / n
	s.AvgSPM = float64(spmSum) / float64(n)
	s.AvgDPS = dpsSum / float64(n)
	s.AvgPaceSecPer500m = paceSum / n
	s.SessionCalories = calSum / 1000
	return s
}

// JSONFlags is exported for tests that want to peek at the recovered
// flag in a summary blob without depending on event package internals.
func JSONFlags(blob string) ([]string, error) {
	var s struct {
		Flags []string `json:"Flags"`
	}
	if err := json.Unmarshal([]byte(blob), &s); err != nil {
		return nil, err
	}
	return s.Flags, nil
}
