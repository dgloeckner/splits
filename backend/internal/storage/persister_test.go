package storage

import (
	"context"
	"path/filepath"
	"testing"
	"time"

	"github.com/gloeckner-daniel/home-ergo/internal/event"
)

func TestPersisterWritesFullSession(t *testing.T) {
	db, err := Open(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	in := make(chan event.Event, 8)
	p := &Persister{DB: db.Handle()}
	done := make(chan error, 1)
	go func() { done <- p.Run(ctx, in) }()

	started := time.Date(2026, 4, 21, 10, 0, 0, 0, time.UTC)
	in <- event.Event{ID: 1, Kind: event.KindSessionStart, SessionID: "S1",
		SessionStart: &event.SessionStartPayload{StartedAt: started, RowerID: "R1", RowerName: "D", InitialLevel: 3}}
	in <- event.Event{ID: 2, Kind: event.KindStroke, SessionID: "S1", At: started,
		Stroke: &event.StrokePayload{StrokeNo: 1, TimeSec: 2.2, DistanceM: 8, SPM: 27, PowerW: 245, CalPerHr: 1175, Level: 3,
			DPS: 8, StrokeCycleSec: 2.2, PaceSecPer500m: 137, EnergyJoules: 544}}
	in <- event.Event{ID: 3, Kind: event.KindSessionEnd, SessionID: "S1",
		SessionEnd: &event.SessionEndPayload{EndedAt: started.Add(time.Minute),
			Summary: event.SessionSummary{TotalDistanceM: 8, TotalTimeSec: 2.2, TotalStrokes: 1}}}
	close(in)

	select {
	case err := <-done:
		if err != nil {
			t.Fatalf("run: %v", err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("persister did not finish")
	}

	var strokes int
	if err := db.Handle().QueryRow(`SELECT COUNT(*) FROM strokes WHERE session_id=?`, "S1").Scan(&strokes); err != nil {
		t.Fatal(err)
	}
	if strokes != 1 {
		t.Errorf("strokes = %d, want 1", strokes)
	}
	var endedAt string
	if err := db.Handle().QueryRow(`SELECT COALESCE(ended_at,'') FROM sessions WHERE id=?`, "S1").Scan(&endedAt); err != nil {
		t.Fatal(err)
	}
	if endedAt == "" {
		t.Errorf("ended_at should be set")
	}
}

func TestPersisterStoresWorkoutID(t *testing.T) {
	db, err := Open(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// Seed the referenced workouts so the FK constraint on
	// sessions.workout_id is satisfied.
	for _, id := range []string{"WA", "WB"} {
		if _, err := db.Handle().ExecContext(ctx,
			`INSERT INTO workout(id, mode, params_json, warmup_sec, cooldown_sec, created_at)
			 VALUES(?, 'just_row', '{}', 0, 0, ?)`,
			id, time.Now().UTC().Format(time.RFC3339Nano)); err != nil {
			t.Fatalf("seed workout %s: %v", id, err)
		}
	}

	in := make(chan event.Event, 8)
	p := &Persister{DB: db.Handle()}
	done := make(chan error, 1)
	go func() { done <- p.Run(ctx, in) }()

	started := time.Date(2026, 4, 21, 10, 0, 0, 0, time.UTC)

	// Session A: workout supplied at session_start (pre-attach path).
	in <- event.Event{ID: 1, Kind: event.KindSessionStart, SessionID: "SA",
		SessionStart: &event.SessionStartPayload{
			StartedAt: started, RowerID: "R1", InitialLevel: 3, WorkoutID: "WA",
		}}
	// Session B: session_start with no workout, then workout_attached mid-session.
	in <- event.Event{ID: 2, Kind: event.KindSessionStart, SessionID: "SB",
		SessionStart: &event.SessionStartPayload{
			StartedAt: started.Add(time.Minute), RowerID: "R1", InitialLevel: 3,
		}}
	in <- event.Event{ID: 3, Kind: event.KindWorkoutAttached, SessionID: "SB",
		WorkoutAttached: &event.WorkoutAttachedPayload{WorkoutID: "WB"}}
	close(in)

	select {
	case err := <-done:
		if err != nil {
			t.Fatalf("run: %v", err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("persister did not finish")
	}

	var wa, wb string
	if err := db.Handle().QueryRow(`SELECT COALESCE(workout_id,'') FROM sessions WHERE id=?`, "SA").Scan(&wa); err != nil {
		t.Fatal(err)
	}
	if err := db.Handle().QueryRow(`SELECT COALESCE(workout_id,'') FROM sessions WHERE id=?`, "SB").Scan(&wb); err != nil {
		t.Fatal(err)
	}
	if wa != "WA" {
		t.Errorf("session A workout_id = %q, want %q", wa, "WA")
	}
	if wb != "WB" {
		t.Errorf("session B workout_id = %q, want %q (workout_attached should update)", wb, "WB")
	}
}
