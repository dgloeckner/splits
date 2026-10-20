package storage

// finalise_test.go — per-reason contract, idempotency, zero-stroke, and
// lastEventID restore tests for FinaliseSession.  All tests in this file
// live in the white-box package (storage) so they can reach unexported
// helpers.

import (
	"context"
	"testing"
	"time"

	"github.com/gloeckner-daniel/splits/internal/event"
	"github.com/gloeckner-daniel/splits/internal/stats"
)

// seedSession inserts a sessions row + n work strokes and returns the
// session id.
func seedSession(t *testing.T, db *DB, id, rowerID string, n int) {
	t.Helper()
	ctx := context.Background()
	started := time.Date(2026, 1, 1, 10, 0, 0, 0, time.UTC)
	if err := InsertSession(ctx, db.Handle(), id, rowerID, started, 3, ""); err != nil {
		t.Fatalf("InsertSession: %v", err)
	}
	for i := 1; i <= n; i++ {
		if err := InsertStroke(ctx, db.Handle(), uint64(i+100), id, started, event.StrokePayload{
			StrokeNo: i, TimeSec: float64(i) * 2.0, DistanceM: i * 8,
			SPM: 24, PowerW: 200, CalPerHr: 1000,
			DPS: 8, StrokeCycleSec: 2.0, PaceSecPer500m: 130,
			EnergyJoules: 400, Phase: "work",
		}); err != nil {
			t.Fatalf("InsertStroke %d: %v", i, err)
		}
	}
}

// TestFinaliseSession_Ended verifies the normal (FinaliseEnded) path:
//   - summary written to DB (ended_at set)
//   - race result not checked here (no workout attached, expect nil)
//   - last_event_id persisted == supplied lastEventID
//   - no "recovered" flag
func TestFinaliseSession_Ended(t *testing.T) {
	db := testDB(t)
	ctx := context.Background()
	seedSession(t, db, "se1", "r1", 5)

	endedAt := time.Date(2026, 1, 1, 10, 10, 0, 0, time.UTC)
	base := event.SessionSummary{TotalDistanceM: 200, TotalTimeSec: 60, TotalStrokes: 5}
	const lastEventID uint64 = 42

	got, err := FinaliseSession(ctx, db.Handle(), "se1", endedAt, base, nil, lastEventID, FinaliseEnded, nil)
	if err != nil {
		t.Fatalf("FinaliseSession: %v", err)
	}

	// ended_at must be set
	var endedStr string
	if err := db.Handle().QueryRowContext(ctx, `SELECT COALESCE(ended_at,'') FROM sessions WHERE id='se1'`).Scan(&endedStr); err != nil {
		t.Fatal(err)
	}
	if endedStr == "" {
		t.Error("ended_at not set after FinaliseEnded")
	}

	// last_event_id must equal what we passed
	var gotEventID int64
	if err := db.Handle().QueryRowContext(ctx, `SELECT COALESCE(last_event_id,0) FROM sessions WHERE id='se1'`).Scan(&gotEventID); err != nil {
		t.Fatal(err)
	}
	if uint64(gotEventID) != lastEventID {
		t.Errorf("last_event_id = %d, want %d", gotEventID, lastEventID)
	}

	// no "recovered" flag
	for _, f := range got.Flags {
		if f == "recovered" {
			t.Error("FinaliseEnded must not set recovered flag")
		}
	}
}

// TestFinaliseSession_Stale verifies the stale path:
//   - summary written (ended_at set)
//   - Race forced nil (ADR-0012)
//   - "recovered" flag present
//   - last_event_id == 0
func TestFinaliseSession_Stale(t *testing.T) {
	db := testDB(t)
	ctx := context.Background()
	seedSession(t, db, "ss1", "r1", 3)

	endedAt := time.Now().UTC()
	base := event.SessionSummary{TotalDistanceM: 100, TotalTimeSec: 30, TotalStrokes: 3}

	got, err := FinaliseSession(ctx, db.Handle(), "ss1", endedAt, base, nil, 0, FinaliseStale, nil)
	if err != nil {
		t.Fatalf("FinaliseSession: %v", err)
	}

	// ended_at set
	var endedStr string
	if err := db.Handle().QueryRowContext(ctx, `SELECT COALESCE(ended_at,'') FROM sessions WHERE id='ss1'`).Scan(&endedStr); err != nil {
		t.Fatal(err)
	}
	if endedStr == "" {
		t.Error("ended_at not set after FinaliseStale")
	}

	// Race must be nil (ADR-0012)
	if got.Race != nil {
		t.Errorf("FinaliseStale: Race must be nil (ADR-0012), got %+v", got.Race)
	}

	// "recovered" flag must be present
	found := false
	for _, f := range got.Flags {
		if f == "recovered" {
			found = true
		}
	}
	if !found {
		t.Errorf("FinaliseStale: expected recovered flag in Flags, got %v", got.Flags)
	}

	// last_event_id must be 0
	var gotEventID int64
	if err := db.Handle().QueryRowContext(ctx, `SELECT COALESCE(last_event_id,0) FROM sessions WHERE id='ss1'`).Scan(&gotEventID); err != nil {
		t.Fatal(err)
	}
	if gotEventID != 0 {
		t.Errorf("FinaliseStale: last_event_id = %d, want 0", gotEventID)
	}
}

// TestFinaliseSession_Boot verifies the boot janitor path:
//   - summary written
//   - samples computed over work-only strokes
//   - "recovered" flag present
//   - Race nil
func TestFinaliseSession_Boot(t *testing.T) {
	db := testDB(t)
	ctx := context.Background()

	// Insert mixed-phase strokes: 2 warmup + 4 work. Samples must only
	// reflect the 4 work strokes.
	started := time.Date(2026, 1, 1, 10, 0, 0, 0, time.UTC)
	if err := InsertSession(ctx, db.Handle(), "sb1", "r1", started, 3, ""); err != nil {
		t.Fatal(err)
	}
	mixed := []event.StrokePayload{
		{StrokeNo: 1, TimeSec: 1.0, DistanceM: 5, SPM: 20, PowerW: 60, Phase: "warmup"},
		{StrokeNo: 2, TimeSec: 2.0, DistanceM: 10, SPM: 22, PowerW: 70, Phase: "warmup"},
		{StrokeNo: 3, TimeSec: 3.0, DistanceM: 20, SPM: 24, PowerW: 200, Phase: "work"},
		{StrokeNo: 4, TimeSec: 4.0, DistanceM: 30, SPM: 24, PowerW: 210, Phase: "work"},
		{StrokeNo: 5, TimeSec: 5.0, DistanceM: 40, SPM: 24, PowerW: 205, Phase: "work"},
		{StrokeNo: 6, TimeSec: 6.0, DistanceM: 50, SPM: 24, PowerW: 208, Phase: "work"},
	}
	for i, s := range mixed {
		if err := InsertStroke(ctx, db.Handle(), uint64(i+1), "sb1", started, s); err != nil {
			t.Fatalf("InsertStroke %d: %v", i, err)
		}
	}

	endedAt := started.Add(6 * time.Second)
	base := event.SessionSummary{}

	got, err := FinaliseSession(ctx, db.Handle(), "sb1", endedAt, base, nil, 0, FinaliseBoot, nil)
	if err != nil {
		t.Fatalf("FinaliseSession: %v", err)
	}

	// ended_at set
	var endedStr string
	if err := db.Handle().QueryRowContext(ctx, `SELECT COALESCE(ended_at,'') FROM sessions WHERE id='sb1'`).Scan(&endedStr); err != nil {
		t.Fatal(err)
	}
	if endedStr == "" {
		t.Error("ended_at not set after FinaliseBoot")
	}

	// "recovered" flag must be present
	found := false
	for _, f := range got.Flags {
		if f == "recovered" {
			found = true
		}
	}
	if !found {
		t.Errorf("FinaliseBoot: expected recovered flag, got %v", got.Flags)
	}

	// Race must be nil (boot path never computes race)
	if got.Race != nil {
		t.Errorf("FinaliseBoot: Race must be nil, got %+v", got.Race)
	}

	// Samples must be over work-only strokes — no warmup power values (60,70)
	if got.Samples != nil {
		for _, w := range got.Samples.Watt {
			if w < 200 {
				t.Errorf("FinaliseBoot samples include non-work stroke power=%d (work strokes have 200-210 W)", w)
			}
		}
	}
}

// TestFinaliseSession_Idempotent calls FinaliseSession twice on the same
// session. The second call must be a no-op (ended_at IS NULL guard
// prevents the UPDATE from touching any rows). No duplicate candidates.
func TestFinaliseSession_Idempotent(t *testing.T) {
	db := testDB(t)
	ctx := context.Background()
	seedSession(t, db, "si1", "r1", 4)

	endedAt := time.Now().UTC()
	base := event.SessionSummary{TotalDistanceM: 120, TotalTimeSec: 40, TotalStrokes: 4}

	if _, err := FinaliseSession(ctx, db.Handle(), "si1", endedAt, base, nil, 10, FinaliseEnded, nil); err != nil {
		t.Fatalf("first FinaliseSession: %v", err)
	}

	// Stash the ended_at value from the first call.
	var firstEnded string
	if err := db.Handle().QueryRowContext(ctx, `SELECT COALESCE(ended_at,'') FROM sessions WHERE id='si1'`).Scan(&firstEnded); err != nil {
		t.Fatal(err)
	}

	// Second call — should succeed (idempotent, not an error), but must not
	// overwrite ended_at or create duplicate candidate rows.
	laterAt := endedAt.Add(time.Hour)
	if _, err := FinaliseSession(ctx, db.Handle(), "si1", laterAt, base, nil, 99, FinaliseEnded, nil); err != nil {
		t.Fatalf("second FinaliseSession (idempotent): %v", err)
	}

	var secondEnded string
	if err := db.Handle().QueryRowContext(ctx, `SELECT COALESCE(ended_at,'') FROM sessions WHERE id='si1'`).Scan(&secondEnded); err != nil {
		t.Fatal(err)
	}
	if secondEnded != firstEnded {
		t.Errorf("idempotent: second call changed ended_at: %q → %q", firstEnded, secondEnded)
	}
}

// TestFinaliseSession_ZeroStrokes verifies that a session with no
// strokes returns ErrZeroStrokes.
func TestFinaliseSession_ZeroStrokes(t *testing.T) {
	db := testDB(t)
	ctx := context.Background()

	started := time.Date(2026, 1, 1, 10, 0, 0, 0, time.UTC)
	if err := InsertSession(ctx, db.Handle(), "sz1", "r1", started, 3, ""); err != nil {
		t.Fatal(err)
	}
	// No strokes inserted.

	endedAt := started.Add(time.Minute)
	_, err := FinaliseSession(ctx, db.Handle(), "sz1", endedAt, event.SessionSummary{}, nil, 0, FinaliseBoot, nil)
	if err != ErrZeroStrokes {
		t.Errorf("expected ErrZeroStrokes, got %v", err)
	}
}

// TestFinaliseSession_LastEventIDRestored verifies that after FinaliseEnded
// the last_event_id is stored and MaxStrokeGlobalID returns at least that
// value (regression guard for the boot event-id seed).
func TestFinaliseSession_LastEventIDRestored(t *testing.T) {
	db := testDB(t)
	ctx := context.Background()
	seedSession(t, db, "slr1", "r1", 3)

	const lastEventID uint64 = 9999
	endedAt := time.Now().UTC()
	base := event.SessionSummary{TotalDistanceM: 80, TotalTimeSec: 20, TotalStrokes: 3}

	if _, err := FinaliseSession(ctx, db.Handle(), "slr1", endedAt, base, nil, lastEventID, FinaliseEnded, nil); err != nil {
		t.Fatalf("FinaliseSession: %v", err)
	}

	// Simulate a restart: MaxStrokeGlobalID must return at least lastEventID.
	maxID, err := MaxStrokeGlobalID(ctx, db.Handle())
	if err != nil {
		t.Fatalf("MaxStrokeGlobalID: %v", err)
	}
	if maxID < lastEventID {
		t.Errorf("MaxStrokeGlobalID = %d, want >= %d (boot seed regression)", maxID, lastEventID)
	}
}

// TestFinaliseSession_WorkoutPBCandidate verifies that FinaliseEnded emits a
// session_pb_workout_candidate row when the session ran the full prescribed
// duration of a time-mode workout (within the slack window), and does NOT
// emit one when the session was too short.
func TestFinaliseSession_WorkoutPBCandidate(t *testing.T) {
	ctx := context.Background()

	seedWithWorkout := func(t *testing.T, sessionID, workoutID string, strokeCount int) {
		t.Helper()
		db := testDB(t)
		h := db.Handle()
		// Insert rower (needed by FK on sessions in some test setups,
		// but testDB's r1 is already there).
		// Insert time-mode workout: 60 s.
		if _, err := h.Exec(`
			INSERT INTO workout(id, mode, params_json, shape_hash, warmup_sec, cooldown_sec, created_at)
			VALUES(?, 'time', '{"seconds":60}', 'HASH60', 0, 0, '2026-01-01T00:00:00Z')`, workoutID); err != nil {
			t.Fatalf("seed workout: %v", err)
		}
		started := time.Date(2026, 1, 1, 10, 0, 0, 0, time.UTC)
		if err := InsertSession(ctx, h, sessionID, "r1", started, 3, workoutID); err != nil {
			t.Fatalf("InsertSession: %v", err)
		}
		for i := 1; i <= strokeCount; i++ {
			if err := InsertStroke(ctx, h, uint64(i+100), sessionID, started, event.StrokePayload{
				StrokeNo: i, TimeSec: float64(i) * 2.0, DistanceM: i * 8,
				SPM: 24, PowerW: 200, CalPerHr: 1000,
				DPS: 8, StrokeCycleSec: 2.0, PaceSecPer500m: 130,
				EnergyJoules: 400, Phase: "work",
			}); err != nil {
				t.Fatalf("InsertStroke %d: %v", i, err)
			}
		}
		t.Cleanup(func() { db.Close() })

		// Case 1: TotalTimeSec=58 (within 5s slack of 60s) → candidate emitted.
		endedAt := started.Add(time.Minute)
		baseSummary := event.SessionSummary{TotalDistanceM: 250, TotalTimeSec: 58, TotalStrokes: strokeCount}
		if _, err := FinaliseSession(ctx, h, sessionID, endedAt, baseSummary, nil, 0, FinaliseEnded, nil); err != nil {
			t.Fatalf("FinaliseSession (completed): %v", err)
		}
		var n int
		if err := h.QueryRow(`SELECT COUNT(*) FROM session_pb_workout_candidate WHERE session_id=? AND value=250 AND shape_hash='HASH60'`, sessionID).Scan(&n); err != nil {
			t.Fatal(err)
		}
		if n != 1 {
			t.Errorf("completed session: expected 1 workout candidate, got %d", n)
		}
	}

	// Run the completed case with a fresh db.
	t.Run("completed_within_slack", func(t *testing.T) {
		seedWithWorkout(t, "swp1", "WTIME1", 5)
	})

	// Case 2: TotalTimeSec=40 (> 5s short of 60s) → no candidate.
	t.Run("too_short", func(t *testing.T) {
		db := testDB(t)
		h := db.Handle()
		if _, err := h.Exec(`
			INSERT INTO workout(id, mode, params_json, shape_hash, warmup_sec, cooldown_sec, created_at)
			VALUES('WTIME2','time','{"seconds":60}','HASH60',0,0,'2026-01-01T00:00:00Z')`); err != nil {
			t.Fatalf("seed workout: %v", err)
		}
		started := time.Date(2026, 1, 1, 10, 0, 0, 0, time.UTC)
		if err := InsertSession(ctx, h, "swp2", "r1", started, 3, "WTIME2"); err != nil {
			t.Fatalf("InsertSession: %v", err)
		}
		for i := 1; i <= 5; i++ {
			if err := InsertStroke(ctx, h, uint64(i+100), "swp2", started, event.StrokePayload{
				StrokeNo: i, TimeSec: float64(i) * 2.0, DistanceM: i * 8,
				SPM: 24, PowerW: 200, CalPerHr: 1000,
				DPS: 8, StrokeCycleSec: 2.0, PaceSecPer500m: 130,
				EnergyJoules: 400, Phase: "work",
			}); err != nil {
				t.Fatalf("InsertStroke %d: %v", i, err)
			}
		}
		endedAt := started.Add(40 * time.Second)
		baseSummary := event.SessionSummary{TotalDistanceM: 200, TotalTimeSec: 40, TotalStrokes: 5}
		if _, err := FinaliseSession(ctx, h, "swp2", endedAt, baseSummary, nil, 0, FinaliseEnded, nil); err != nil {
			t.Fatalf("FinaliseSession (too short): %v", err)
		}
		var n int
		if err := h.QueryRow(`SELECT COUNT(*) FROM session_pb_workout_candidate WHERE session_id='swp2'`).Scan(&n); err != nil {
			t.Fatal(err)
		}
		if n != 0 {
			t.Errorf("too-short session: expected 0 workout candidates, got %d", n)
		}
	})
}

// TestFinaliseSession_AnalysisWindow verifies finalise persists the
// analysis window on the summary samples, ending it at the bucket that
// reaches a distance goal, and that a second computation agrees.
func TestFinaliseSession_AnalysisWindow(t *testing.T) {
	db := testDB(t)
	ctx := context.Background()
	h := db.Handle()
	if _, err := h.Exec(`
		INSERT INTO workout(id, mode, params_json, shape_hash, warmup_sec, cooldown_sec, created_at)
		VALUES('WDIST', 'distance', '{"meters":200}', 'HASH200', 0, 0, '2026-01-01T00:00:00Z')`); err != nil {
		t.Fatalf("seed workout: %v", err)
	}
	started := time.Date(2026, 1, 1, 10, 0, 0, 0, time.UTC)
	if err := InsertSession(ctx, h, "sw1", "r1", started, 3, "WDIST"); err != nil {
		t.Fatalf("InsertSession: %v", err)
	}
	// 28 strokes at 8 m: 200 m is stroke 25 (bucket index 4), strokes
	// 26–28 are the overrun bucket 5.
	for i := 1; i <= 28; i++ {
		if err := InsertStroke(ctx, h, uint64(i+100), "sw1", started, event.StrokePayload{
			StrokeNo: i, TimeSec: float64(i) * 2.0, DistanceM: i * 8,
			SPM: 24, PowerW: 200, PaceSecPer500m: 130, DPS: 8, Phase: "work",
		}); err != nil {
			t.Fatalf("InsertStroke %d: %v", i, err)
		}
	}

	base := event.SessionSummary{TotalDistanceM: 224, TotalTimeSec: 56, TotalStrokes: 28}
	got, err := FinaliseSession(ctx, h, "sw1", started.Add(time.Minute), base, nil, 0, FinaliseEnded, nil)
	if err != nil {
		t.Fatalf("FinaliseSession: %v", err)
	}
	want := event.SamplesWindow{From: 1, To: 5}
	if got.Samples == nil || got.Samples.Window == nil || *got.Samples.Window != want {
		t.Fatalf("returned window = %+v, want %+v", got.Samples, want)
	}

	row, err := GetSession(ctx, h, "sw1")
	if err != nil {
		t.Fatalf("GetSession: %v", err)
	}
	if row.Summary == nil || row.Summary.Samples == nil || row.Summary.Samples.Window == nil {
		t.Fatalf("persisted summary has no window: %+v", row.Summary)
	}
	if *row.Summary.Samples.Window != want {
		t.Errorf("persisted window = %+v, want %+v", *row.Summary.Samples.Window, want)
	}

	// A re-finalise recomputes the same window (the DB row is already
	// ended, so only the returned summary is fresh).
	again, err := FinaliseSession(ctx, h, "sw1", started.Add(time.Minute), base, nil, 0, FinaliseEnded, nil)
	if err != nil {
		t.Fatalf("re-FinaliseSession: %v", err)
	}
	if again.Samples.Window == nil || *again.Samples.Window != want {
		t.Errorf("re-finalise window = %+v, want %+v", again.Samples.Window, want)
	}
}

func TestWorkoutGoal(t *testing.T) {
	warmup := []event.StrokePayload{
		{TimeSec: 10, DistanceM: 40, Phase: "warmup"},
		{TimeSec: 20, DistanceM: 90, Phase: "warmup"},
		{TimeSec: 22, DistanceM: 99, Phase: "work"},
	}
	cases := []struct {
		name    string
		mode    string
		params  string
		strokes []event.StrokePayload
		want    stats.WorkoutGoal
	}{
		{"distance", "distance", `{"meters":5000}`, nil, stats.WorkoutGoal{Mode: "distance", Target: 5000}},
		{"time", "time", `{"seconds":1200}`, nil, stats.WorkoutGoal{Mode: "time", Target: 1200}},
		{"just_row", "just_row", `{}`, nil, stats.WorkoutGoal{Mode: "just_row"}},
		{"bad params", "distance", `not json`, nil, stats.WorkoutGoal{Mode: "distance"}},
		{"warmup origin", "distance", `{"meters":2000}`, warmup,
			stats.WorkoutGoal{Mode: "distance", Target: 2000, OriginDistanceM: 90, OriginTimeSec: 20}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := workoutGoal(tc.mode, tc.params, tc.strokes); got != tc.want {
				t.Errorf("workoutGoal = %+v, want %+v", got, tc.want)
			}
		})
	}
}
