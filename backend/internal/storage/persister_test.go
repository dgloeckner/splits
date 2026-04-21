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
