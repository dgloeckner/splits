package storage_test

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/gloeckner-daniel/splits/internal/event"
	"github.com/gloeckner-daniel/splits/internal/storage"
)

// insertStaleSession writes a sessions row with ended_at NULL and a single
// strokes row at `lastStrokeAt`. Used by the janitor + API smoke tests.
var strokeGlobalIDCounter uint64

func insertStaleSession(t *testing.T, db *storage.DB, id, rowerID string, startedAt, lastStrokeAt time.Time) {
	t.Helper()
	ctx := context.Background()
	if err := storage.InsertSession(ctx, db.Handle(), id, rowerID, startedAt, 3, ""); err != nil {
		t.Fatalf("InsertSession: %v", err)
	}
	strokeGlobalIDCounter++
	if err := storage.InsertStroke(ctx, db.Handle(), strokeGlobalIDCounter, id, lastStrokeAt, event.StrokePayload{
		StrokeNo: 1, TimeSec: 1.0, DistanceM: 5, SPM: 20, PowerW: 100, CalPerHr: 600,
		Level: 3, DPS: 5, StrokeCycleSec: 3, PaceSecPer500m: 130, EnergyJoules: 100,
		Phase: "work",
	}); err != nil {
		t.Fatalf("InsertStroke: %v", err)
	}
}

func TestSweepStaleOpen_MarksIdleSessions(t *testing.T) {
	t.Parallel()
	db := openTestDB(t)
	ctx := context.Background()
	now := time.Now().UTC()

	// Stale: last stroke 10 min ago, no ended_at.
	insertStaleSession(t, db, "S-stale", "R1", now.Add(-30*time.Minute), now.Add(-10*time.Minute))
	// Fresh: last stroke 1 min ago, no ended_at — must not be flagged.
	insertStaleSession(t, db, "S-fresh", "R1", now.Add(-2*time.Minute), now.Add(-1*time.Minute))
	// Already ended: must not be flagged.
	insertStaleSession(t, db, "S-done", "R1", now.Add(-60*time.Minute), now.Add(-40*time.Minute))
	if _, err := db.Handle().ExecContext(ctx,
		`UPDATE sessions SET ended_at = ? WHERE id = 'S-done'`,
		now.Add(-39*time.Minute).Format(time.RFC3339Nano)); err != nil {
		t.Fatal(err)
	}

	n, err := storage.SweepStaleOpen(ctx, db.Handle(), 5*time.Minute)
	if err != nil {
		t.Fatalf("SweepStaleOpen: %v", err)
	}
	if n != 1 {
		t.Errorf("swept = %d, want 1", n)
	}

	statusOf := func(id string) string {
		var s string
		if err := db.Handle().QueryRowContext(ctx,
			`SELECT status FROM sessions WHERE id = ?`, id).Scan(&s); err != nil {
			t.Fatal(err)
		}
		return s
	}
	if got := statusOf("S-stale"); got != "stale-open" {
		t.Errorf("S-stale status = %q, want stale-open", got)
	}
	if got := statusOf("S-fresh"); got != "open" {
		t.Errorf("S-fresh status = %q, want open", got)
	}
	if got := statusOf("S-done"); got != "open" {
		t.Errorf("S-done status = %q, want open (ended)", got)
	}
}

func TestSweepStaleOpen_NoStrokes_NotFlagged(t *testing.T) {
	t.Parallel()
	db := openTestDB(t)
	ctx := context.Background()
	now := time.Now().UTC()

	// Session with no strokes at all — MAX is NULL, must not flag.
	if err := storage.InsertSession(ctx, db.Handle(), "S-empty", "R1", now.Add(-30*time.Minute), 3, ""); err != nil {
		t.Fatal(err)
	}
	n, err := storage.SweepStaleOpen(ctx, db.Handle(), 5*time.Minute)
	if err != nil {
		t.Fatalf("SweepStaleOpen: %v", err)
	}
	if n != 0 {
		t.Errorf("swept = %d, want 0 (no strokes -> no last_stroke_at)", n)
	}
}

func TestListStaleOpenSessions(t *testing.T) {
	t.Parallel()
	db := openTestDB(t)
	ctx := context.Background()
	now := time.Now().UTC()

	insertStaleSession(t, db, "S-stale-1", "R1", now.Add(-30*time.Minute), now.Add(-10*time.Minute))
	insertStaleSession(t, db, "S-stale-2", "R2", now.Add(-30*time.Minute), now.Add(-10*time.Minute))
	if _, err := storage.SweepStaleOpen(ctx, db.Handle(), 5*time.Minute); err != nil {
		t.Fatal(err)
	}

	rows, err := storage.ListStaleOpenSessions(ctx, db.Handle(), "R1")
	if err != nil {
		t.Fatalf("ListStaleOpenSessions: %v", err)
	}
	if len(rows) != 1 {
		t.Fatalf("len = %d, want 1", len(rows))
	}
	r := rows[0]
	if r.ID != "S-stale-1" {
		t.Errorf("id = %q", r.ID)
	}
	if r.TotalDistanceM != 5 {
		t.Errorf("total_distance_m = %d, want 5 (from the single stroke)", r.TotalDistanceM)
	}
	if r.LastStrokeAt.IsZero() {
		t.Errorf("last_stroke_at zero")
	}
}

// insertWorkout writes a workout row with the given mode + params.
func insertWorkout(t *testing.T, db *storage.DB, id, mode, paramsJSON string) {
	t.Helper()
	now := time.Now().UTC().Format(time.RFC3339Nano)
	if _, err := db.Handle().Exec(
		`INSERT INTO workout(id,mode,params_json,intensity,warmup_sec,cooldown_sec,created_at,shape_hash)
		 VALUES(?,?,?,'moderat',0,0,?,'shape')`, id, mode, paramsJSON, now); err != nil {
		t.Fatalf("insert workout: %v", err)
	}
}

// insertStaleSessionWithWorkout is like insertStaleSession but attaches a
// workout id. Needed for ADR-0012 race-row finalize tests.
func insertStaleSessionWithWorkout(t *testing.T, db *storage.DB, id, rowerID, workoutID string, startedAt, lastStrokeAt time.Time, distanceM int) {
	t.Helper()
	ctx := context.Background()
	if err := storage.InsertSession(ctx, db.Handle(), id, rowerID, startedAt, 3, workoutID); err != nil {
		t.Fatalf("InsertSession: %v", err)
	}
	strokeGlobalIDCounter++
	if err := storage.InsertStroke(ctx, db.Handle(), strokeGlobalIDCounter, id, lastStrokeAt, event.StrokePayload{
		StrokeNo: 1, TimeSec: 480.0, DistanceM: distanceM, SPM: 28, PowerW: 250,
		Level: 3, DPS: 8, StrokeCycleSec: 2.1, PaceSecPer500m: 120, EnergyJoules: 300,
		Phase: "work",
	}); err != nil {
		t.Fatalf("InsertStroke: %v", err)
	}
}

// ADR-0012 / PRD-0014 issue 08: finalizing a stale race-mode session
// must persist summary.race == null regardless of stroke history. The
// race lifecycle is non-resumable; an interrupted race never produces
// a race result.
func TestFinalizeStaleSession_RaceRow_SummaryRaceNil(t *testing.T) {
	t.Parallel()
	db := openTestDB(t)
	ctx := context.Background()
	now := time.Now().UTC()

	insertWorkout(t, db, "W-race", "race", `{"meters":2000}`)
	// Stroke distance >= 2000 m so a non-race code path would otherwise
	// compute a race result. ADR-0012 forbids that here.
	insertStaleSessionWithWorkout(t, db, "S-race", "R1", "W-race",
		now.Add(-30*time.Minute), now.Add(-10*time.Minute), 2000)

	if err := storage.FinalizeStaleSession(ctx, db.Handle(), "S-race"); err != nil {
		t.Fatalf("FinalizeStaleSession: %v", err)
	}

	// Read summary_json directly: the persisted payload must not contain a
	// non-null `race` field.
	var summaryStr string
	if err := db.Handle().QueryRowContext(ctx,
		`SELECT COALESCE(summary_json,'') FROM sessions WHERE id = ?`, "S-race").Scan(&summaryStr); err != nil {
		t.Fatalf("read summary_json: %v", err)
	}
	if summaryStr != "" {
		var env map[string]any
		if err := json.Unmarshal([]byte(summaryStr), &env); err != nil {
			t.Fatalf("unmarshal summary_json: %v", err)
		}
		if raceVal, ok := env["race"]; ok && raceVal != nil {
			t.Errorf("summary_json.race = %v, want nil (ADR-0012)", raceVal)
		}
	}

	// Read through the public SessionRow API too — Summary.Race must be nil.
	row, err := storage.GetSession(ctx, db.Handle(), "S-race")
	if err != nil {
		t.Fatalf("GetSession: %v", err)
	}
	if row == nil || row.Summary == nil {
		t.Fatalf("expected session row + summary")
	}
	if row.Summary.Race != nil {
		t.Errorf("Summary.Race = %+v, want nil (ADR-0012)", row.Summary.Race)
	}
}

// ListStaleOpenSessions must expose the workout `mode` so the recovery
// card can branch on race vs non-race (ADR-0012).
func TestListStaleOpenSessions_IncludesWorkoutMode(t *testing.T) {
	t.Parallel()
	db := openTestDB(t)
	ctx := context.Background()
	now := time.Now().UTC()

	insertWorkout(t, db, "W-race", "race", `{"meters":2000}`)
	insertStaleSessionWithWorkout(t, db, "S-race", "R1", "W-race",
		now.Add(-30*time.Minute), now.Add(-10*time.Minute), 1500)
	// And a no-workout row to show mode is empty when unattached.
	insertStaleSession(t, db, "S-plain", "R1", now.Add(-30*time.Minute), now.Add(-10*time.Minute))
	if _, err := storage.SweepStaleOpen(ctx, db.Handle(), 5*time.Minute); err != nil {
		t.Fatal(err)
	}

	rows, err := storage.ListStaleOpenSessions(ctx, db.Handle(), "R1")
	if err != nil {
		t.Fatalf("ListStaleOpenSessions: %v", err)
	}
	byID := map[string]storage.StaleOpenSessionRow{}
	for _, r := range rows {
		byID[r.ID] = r
	}
	if got := byID["S-race"].Mode; got != "race" {
		t.Errorf("S-race mode = %q, want %q", got, "race")
	}
	if got := byID["S-plain"].Mode; got != "" {
		t.Errorf("S-plain mode = %q, want empty (no workout)", got)
	}
}
