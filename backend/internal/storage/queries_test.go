package storage

import (
	"context"
	"path/filepath"
	"testing"
	"time"

	"github.com/gloeckner-daniel/home-ergo/internal/event"
)

func testDB(t *testing.T) *DB {
	t.Helper()
	db, err := Open(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	t.Cleanup(func() { db.Close() })
	return db
}

func TestInsertSessionAndUpdateEnd(t *testing.T) {
	db := testDB(t)
	ctx := context.Background()

	started := time.Date(2026, 4, 21, 10, 0, 0, 0, time.UTC)
	if err := InsertSession(ctx, db.Handle(), "S1", "R1", started, 3, ""); err != nil {
		t.Fatalf("insert session: %v", err)
	}

	ended := started.Add(5 * time.Minute)
	sum := event.SessionSummary{
		TotalDistanceM: 1000, TotalTimeSec: 300,
		TotalStrokes: 120, AvgPowerW: 250, PeakPowerW: 320,
		AvgSPM: 26.1, AvgDPS: 8.3, AvgPaceSecPer500m: 135, SessionCalories: 110,
	}
	if err := UpdateSessionEnd(ctx, db.Handle(), "S1", ended, sum); err != nil {
		t.Fatalf("update end: %v", err)
	}

	var totalDistance int
	var summaryJSON string
	if err := db.Handle().QueryRow(
		`SELECT total_distance_m, summary_json FROM sessions WHERE id=?`, "S1",
	).Scan(&totalDistance, &summaryJSON); err != nil {
		t.Fatalf("select: %v", err)
	}
	if totalDistance != 1000 {
		t.Errorf("total_distance_m = %d", totalDistance)
	}
	if summaryJSON == "" {
		t.Errorf("summary_json empty")
	}
}

func TestInsertStroke(t *testing.T) {
	db := testDB(t)
	ctx := context.Background()
	if err := InsertSession(ctx, db.Handle(), "S1", "R1", time.Now().UTC(), 3, ""); err != nil {
		t.Fatal(err)
	}
	p := event.StrokePayload{
		StrokeNo: 1, TimeSec: 2.2, DistanceM: 8,
		SPM: 27, PowerW: 245, CalPerHr: 1175, Level: 3,
		DPS: 8, StrokeCycleSec: 2.2, PaceSecPer500m: 137, EnergyJoules: 544,
	}
	if err := InsertStroke(ctx, db.Handle(), 42, "S1", time.Now().UTC(), p); err != nil {
		t.Fatalf("insert stroke: %v", err)
	}
	var count int
	if err := db.Handle().QueryRow(`SELECT COUNT(*) FROM strokes WHERE session_id=?`, "S1").Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != 1 {
		t.Errorf("stroke count = %d", count)
	}
}

func TestInsertSession_WorkoutID(t *testing.T) {
	db := testDB(t)
	ctx := context.Background()
	started := time.Date(2026, 4, 22, 8, 0, 0, 0, time.UTC)

	// Seed a workout row so the FK constraint is satisfied.
	if _, err := db.Handle().ExecContext(ctx,
		`INSERT INTO workout(id, mode, params_json, created_at) VALUES(?, ?, ?, ?)`,
		"w-abc", "just_row", `{}`, started.Format(time.RFC3339Nano),
	); err != nil {
		t.Fatalf("seed workout: %v", err)
	}

	// With a workout_id.
	if err := InsertSession(ctx, db.Handle(), "S-wid", "R1", started, 5, "w-abc"); err != nil {
		t.Fatalf("insert with workout_id: %v", err)
	}
	var gotWID *string
	if err := db.Handle().QueryRow(
		`SELECT workout_id FROM sessions WHERE id=?`, "S-wid",
	).Scan(&gotWID); err != nil {
		t.Fatalf("select workout_id: %v", err)
	}
	if gotWID == nil || *gotWID != "w-abc" {
		t.Errorf("workout_id = %v, want %q", gotWID, "w-abc")
	}

	// Without a workout_id — should be NULL.
	if err := InsertSession(ctx, db.Handle(), "S-nowid", "R1", started, 5, ""); err != nil {
		t.Fatalf("insert without workout_id: %v", err)
	}
	var nullWID *string
	if err := db.Handle().QueryRow(
		`SELECT workout_id FROM sessions WHERE id=?`, "S-nowid",
	).Scan(&nullWID); err != nil {
		t.Fatalf("select workout_id (null): %v", err)
	}
	if nullWID != nil {
		t.Errorf("workout_id = %q, want NULL", *nullWID)
	}
}
