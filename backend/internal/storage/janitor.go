package storage

import (
	"context"
	"database/sql"
	"encoding/json"
	"log/slog"
	"time"

	"github.com/gloeckner-daniel/home-ergo/internal/event"
	"github.com/gloeckner-daniel/home-ergo/internal/stats"
)

// BootJanitor finalises any session that was left open across a
// process restart and verifies post-end invariants (no strokes for
// ended sessions). FEAT-0009 background-jobs spec, runs once at
// process start.
type BootJanitor struct {
	DB        *sql.DB
	Scheduler *stats.RecomputeScheduler
}

// Run sweeps the database. Best-effort: errors are logged, never
// returned (we never want to refuse to start the process for a
// janitor hiccup).
func (j *BootJanitor) Run(ctx context.Context) {
	if err := j.finaliseOrphans(ctx); err != nil {
		slog.Error("janitor.finalise", "err", err)
	}
	if err := j.repairLeftoverStrokes(ctx); err != nil {
		slog.Error("janitor.leftover_strokes", "err", err)
	}
	if err := j.rekeyLegacySummary(ctx); err != nil {
		slog.Error("janitor.rekey_summary", "err", err)
	}
}

// rekeyLegacySummary converts pre-snake_case summary_json blobs
// (Go-default CamelCase keys) into the snake_case shape the
// frontend expects. One-shot detection via the presence of
// "AvgPowerW" in the JSON; the new struct never produces that key.
func (j *BootJanitor) rekeyLegacySummary(ctx context.Context) error {
	rows, err := j.DB.QueryContext(ctx,
		`SELECT id, summary_json FROM sessions
		 WHERE summary_json IS NOT NULL AND summary_json LIKE '%"AvgPowerW"%'`)
	if err != nil {
		return err
	}
	type legacy struct {
		TotalDistanceM    int             `json:"TotalDistanceM"`
		TotalTimeSec      float64         `json:"TotalTimeSec"`
		TotalStrokes      int             `json:"TotalStrokes"`
		AvgPowerW         int             `json:"AvgPowerW"`
		PeakPowerW        int             `json:"PeakPowerW"`
		AvgSPM            float64         `json:"AvgSPM"`
		AvgDPS            float64         `json:"AvgDPS"`
		AvgPaceSecPer500m int             `json:"AvgPaceSecPer500m"`
		SessionCalories   int             `json:"SessionCalories"`
		Samples           json.RawMessage `json:"Samples,omitempty"`
		PBCandidates      json.RawMessage `json:"pb_candidates,omitempty"`
		Flags             []string        `json:"Flags,omitempty"`
	}
	type updateRow struct {
		id   string
		blob string
	}
	var updates []updateRow
	for rows.Next() {
		var id, summary string
		if err := rows.Scan(&id, &summary); err != nil {
			rows.Close()
			return err
		}
		var ls legacy
		if err := json.Unmarshal([]byte(summary), &ls); err != nil {
			slog.Warn("janitor.rekey_summary.parse", "session_id", id, "err", err)
			continue
		}
		newSum := event.SessionSummary{
			TotalDistanceM:    ls.TotalDistanceM,
			TotalTimeSec:      ls.TotalTimeSec,
			TotalStrokes:      ls.TotalStrokes,
			AvgPowerW:         ls.AvgPowerW,
			PeakPowerW:        ls.PeakPowerW,
			AvgSPM:            ls.AvgSPM,
			AvgDPS:            ls.AvgDPS,
			AvgPaceSecPer500m: ls.AvgPaceSecPer500m,
			SessionCalories:   ls.SessionCalories,
			Flags:             ls.Flags,
		}
		// Re-encode with the new tags. Samples and PBCandidates round-trip
		// as raw JSON via *json.RawMessage so we don't have to know the
		// stats package shapes here.
		blob, err := json.Marshal(struct {
			event.SessionSummary
			Samples      json.RawMessage `json:"samples,omitempty"`
			PBCandidates json.RawMessage `json:"pb_candidates,omitempty"`
		}{newSum, ls.Samples, ls.PBCandidates})
		if err != nil {
			continue
		}
		updates = append(updates, updateRow{id: id, blob: string(blob)})
	}
	rows.Close()
	for _, u := range updates {
		if _, err := j.DB.ExecContext(ctx,
			`UPDATE sessions SET summary_json = ? WHERE id = ?`, u.blob, u.id); err != nil {
			return err
		}
		slog.Info("janitor.rekey_summary", "session_id", u.id)
	}
	return nil
}

func (j *BootJanitor) finaliseOrphans(ctx context.Context) error {
	rows, err := j.DB.QueryContext(ctx, `
		SELECT id, rower_id FROM sessions
		WHERE ended_at IS NULL AND deleted_at IS NULL`)
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
	endedAt := time.Now().UTC()
	if len(strokes) > 0 {
		// Use last stroke's event time + 1 s as ended_at.
		// Strokes are stored without explicit ts, so approximate.
		endedAt = time.Now().UTC()
	}
	summary := buildSummary(strokes)
	summary.Samples = stats.ComputeSamples(strokes, stats.DefaultBucketStrokes)
	summary.PBCandidates = stats.ComputeCandidates(strokes)
	// Mark as recovered so the UI / history can flag it.
	summary.Flags = []string{"recovered"}

	if err := UpdateSessionEnd(ctx, tx, id, endedAt, summary); err != nil {
		return err
	}
	if err := DeleteSessionStrokes(ctx, tx, id); err != nil {
		return err
	}
	return tx.Commit()
}

// repairLeftoverStrokes fixes the (bug-only) state where a session
// has ended_at IS NOT NULL but still has rows in strokes. Drops them.
func (j *BootJanitor) repairLeftoverStrokes(ctx context.Context) error {
	rows, err := j.DB.QueryContext(ctx, `
		SELECT DISTINCT s.session_id FROM strokes s
		JOIN sessions ss ON ss.id = s.session_id
		WHERE ss.ended_at IS NOT NULL`)
	if err != nil {
		return err
	}
	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return err
		}
		ids = append(ids, id)
	}
	rows.Close()
	for _, id := range ids {
		slog.Warn("janitor.leftover_strokes", "session_id", id)
		if _, err := j.DB.ExecContext(ctx, `DELETE FROM strokes WHERE session_id = ?`, id); err != nil {
			slog.Error("janitor.leftover_strokes.delete", "session_id", id, "err", err)
		}
	}
	return nil
}

// buildSummary computes session totals + averages from strokes. Used
// only by the boot janitor — the live pipeline computes its own via
// the sessionizer's accumulator.
func buildSummary(strokes []event.StrokePayload) event.SessionSummary {
	var s event.SessionSummary
	if len(strokes) == 0 {
		return s
	}
	s.TotalStrokes = len(strokes)
	s.TotalDistanceM = strokes[len(strokes)-1].DistanceM
	s.TotalTimeSec = strokes[len(strokes)-1].TimeSec
	var powerSum, spmSum, paceSum, calSum int
	var dpsSum float64
	for _, p := range strokes {
		powerSum += p.PowerW
		spmSum += p.SPM
		dpsSum += p.DPS
		paceSum += p.PaceSecPer500m
		calSum += p.EnergyJoules
		if p.PowerW > s.PeakPowerW {
			s.PeakPowerW = p.PowerW
		}
	}
	n := len(strokes)
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
