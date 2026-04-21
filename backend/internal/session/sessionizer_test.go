package session

import (
	"context"
	"testing"
	"time"

	"github.com/gloeckner-daniel/home-ergo/internal/event"
	"github.com/gloeckner-daniel/home-ergo/internal/ipm"
)

func frame(timeSec float64, distanceM, spm, powerW, level int) ipm.Frame {
	return ipm.Frame{
		ReceivedAt: time.Unix(int64(timeSec), 0),
		TimeSec:    timeSec,
		DistanceM:  distanceM,
		SPM:        spm,
		PowerW:     powerW,
		CalPerHr:   1000,
		Level:      level,
	}
}

func drain(t *testing.T, out <-chan event.Event, n int) []event.Event {
	t.Helper()
	var got []event.Event
	for i := 0; i < n; i++ {
		select {
		case e := <-out:
			got = append(got, e)
		case <-time.After(time.Second):
			t.Fatalf("timeout waiting for event %d", i+1)
		}
	}
	return got
}

func TestSessionizerStartIDSeedsCounter(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	in := make(chan ipm.Frame, 4)
	out := make(chan event.Event, 16)
	s := New(Options{IdleTimeout: time.Minute, StartID: 100, Now: time.Now})
	go func() { _ = s.Run(ctx, in, out) }()

	in <- frame(0.0, 0, 25, 200, 3)
	got := drain(t, out, 2)
	if got[0].ID != 101 {
		t.Errorf("session_start id = %d, want 101", got[0].ID)
	}
	if got[1].ID != 102 {
		t.Errorf("stroke id = %d, want 102", got[1].ID)
	}
}

func TestSessionizerFirstStrokeOpensSession(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	in := make(chan ipm.Frame, 4)
	out := make(chan event.Event, 16)
	s := New(Options{IdleTimeout: time.Minute, RowerID: "R", RowerName: "Daniel", Now: func() time.Time { return time.Unix(1000, 0) }})
	go func() { _ = s.Run(ctx, in, out) }()

	in <- frame(0.0, 0, 25, 200, 3)
	got := drain(t, out, 2)

	if got[0].Kind != event.KindSessionStart {
		t.Errorf("expected session_start, got %v", got[0].Kind)
	}
	if got[0].ID != 1 {
		t.Errorf("first event id = %d, want 1", got[0].ID)
	}
	if got[1].Kind != event.KindStroke {
		t.Errorf("expected stroke, got %v", got[1].Kind)
	}
	if got[1].ID != 2 {
		t.Errorf("second event id = %d, want 2", got[1].ID)
	}
	if got[1].SessionID != got[0].SessionID || got[0].SessionID == "" {
		t.Errorf("session ids should match and be non-empty: %q / %q", got[0].SessionID, got[1].SessionID)
	}
}

func TestSessionizerEnrichesTier2(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	in := make(chan ipm.Frame, 4)
	out := make(chan event.Event, 16)
	s := New(Options{IdleTimeout: time.Minute, Now: time.Now})
	go func() { _ = s.Run(ctx, in, out) }()

	in <- frame(0.0, 0, 25, 200, 3)
	in <- frame(2.2, 8, 27, 245, 3)
	got := drain(t, out, 3) // start + stroke + stroke

	st2 := got[2].Stroke
	if st2.DPS != 8 {
		t.Errorf("DPS = %v, want 8", st2.DPS)
	}
	if st2.StrokeCycleSec != 2.2 {
		t.Errorf("cycle = %v, want 2.2", st2.StrokeCycleSec)
	}
	if st2.PaceSecPer500m != 137 {
		t.Errorf("pace = %v, want 137", st2.PaceSecPer500m)
	}
}

func TestSessionizerIdleBoundary(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	in := make(chan ipm.Frame, 4)
	out := make(chan event.Event, 16)
	now := time.Unix(1000, 0)
	s := New(Options{IdleTimeout: 60 * time.Second, Now: func() time.Time { return now }})
	go func() { _ = s.Run(ctx, in, out) }()

	// First session: two strokes.
	in <- frame(0.0, 0, 25, 200, 3)
	// Give goroutine time to advance before we mutate `now`
	time.Sleep(50 * time.Millisecond)
	now = now.Add(1 * time.Second)
	in <- frame(1.0, 4, 25, 200, 3)

	// Idle gap >60 s, then a new session.
	time.Sleep(50 * time.Millisecond)
	now = now.Add(90 * time.Second)
	in <- frame(0.0, 0, 24, 180, 3)

	got := drain(t, out, 5)
	// Order: session_start, stroke, stroke, session_end, session_start.
	if got[3].Kind != event.KindSessionEnd {
		t.Errorf("expected session_end at 3, got %v", got[3].Kind)
	}
	if got[4].Kind != event.KindSessionStart {
		t.Errorf("expected session_start at 4, got %v", got[4].Kind)
	}
	if got[4].SessionID == got[0].SessionID {
		t.Errorf("second session_start should have a new session id")
	}

	more := drain(t, out, 1)
	if more[0].Kind != event.KindStroke {
		t.Errorf("expected stroke after session_start, got %v", more[0].Kind)
	}
	sum := got[3].SessionEnd.Summary
	if sum.TotalStrokes != 2 {
		t.Errorf("summary.TotalStrokes = %d, want 2", sum.TotalStrokes)
	}
}

func TestSessionizerEmitsLevelChange(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	in := make(chan ipm.Frame, 4)
	out := make(chan event.Event, 16)
	s := New(Options{IdleTimeout: time.Minute, Now: time.Now})
	go func() { _ = s.Run(ctx, in, out) }()

	in <- frame(0.0, 0, 25, 200, 3) // level 3
	in <- frame(2.2, 8, 27, 245, 5) // level 5 — triggers level_change
	got := drain(t, out, 4)
	// Order: session_start, stroke(level=3), stroke(level=5), level_change.
	if got[3].Kind != event.KindLevelChange {
		t.Errorf("expected level_change, got %v", got[3].Kind)
	}
	if got[3].LevelChange.From != 3 || got[3].LevelChange.To != 5 {
		t.Errorf("level change %d→%d, want 3→5", got[3].LevelChange.From, got[3].LevelChange.To)
	}
}

func TestSessionizer_ResolverPicksRowerPerSession(t *testing.T) {
	current := "R1"
	currentName := "Rower1"
	now := time.Unix(1000, 0)
	s := New(Options{
		IdleTimeout:  time.Minute,
		ResolveRower: func() (string, string) { return current, currentName },
		Now:          func() time.Time { return now },
	})

	frames := make(chan ipm.Frame, 1)
	out := make(chan event.Event, 16)
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() { done <- s.Run(ctx, frames, out) }()

	frames <- ipm.Frame{TimeSec: 1, DistanceM: 1, SPM: 20, PowerW: 100, Level: 3}
	evt := <-out // session_start
	if evt.SessionStart.RowerID != "R1" {
		t.Fatalf("session 1 rower: %q", evt.SessionStart.RowerID)
	}
	<-out // stroke

	// idle close + switch
	now = now.Add(5 * time.Minute)
	current = "R2"
	currentName = "Rower2"
	frames <- ipm.Frame{TimeSec: 2, DistanceM: 2, SPM: 20, PowerW: 100, Level: 3}
	// drain until we see the next session_start
	var found string
	for e := range out {
		if e.Kind == event.KindSessionStart {
			found = e.SessionStart.RowerID
			break
		}
	}
	if found != "R2" {
		t.Fatalf("session 2 rower: %q", found)
	}
	cancel()
	close(frames)
	<-done
}
