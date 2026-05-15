package session

import (
	"context"
	"encoding/json"
	"sync"
	"testing"
	"time"

	"github.com/gloeckner-daniel/splits/internal/event"
	"github.com/gloeckner-daniel/splits/internal/ipm"
	"github.com/gloeckner-daniel/splits/internal/workout"
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

	s.StartSession("")
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

	s.StartSession("")
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

	s.StartSession("")
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
	// Pace is now the N-stroke windowed split (U3 fix). The buffer
	// holds 2 strokes (t=0,d=0 and t=2.2,d=8), shy of the 5-stroke
	// window so it shrinks to the available pair: 8 m in 2.2 s ⇒
	// 500/8 * 2.2 = 137 s/500m. The earlier 5-second window stretched
	// to a clamped 312 here; the stroke-anchored window is closer to
	// physical truth on the opening pair.
	if st2.PaceSecPer500m != 137 {
		t.Errorf("pace = %v, want 137 (N-stroke windowed split)", st2.PaceSecPer500m)
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

	// First session: explicit start + two strokes.
	s.StartSession("")
	in <- frame(0.0, 0, 25, 200, 3)
	// Give goroutine time to advance before we mutate `now`
	time.Sleep(50 * time.Millisecond)
	now = now.Add(1 * time.Second)
	in <- frame(1.0, 4, 25, 200, 3)

	// Idle gap >60 s, then explicit start + new stroke for session 2.
	time.Sleep(50 * time.Millisecond)
	now = now.Add(90 * time.Second)
	s.StartSession("")
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

	s.StartSession("")
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

	s.StartSession("")
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
	s.StartSession("")
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

// TestAttachWorkout_OneShot verifies that AttachWorkout tags the very next
// session_start with the supplied ID and that a subsequent session (after the
// idle gap closes the first one) has an empty WorkoutID.
func TestAttachWorkout_OneShot(t *testing.T) {
	now := time.Unix(1000, 0)
	s := New(Options{
		IdleTimeout: 60 * time.Second,
		RowerID:     "R1",
		Now:         func() time.Time { return now },
	})
	frames := make(chan ipm.Frame, 4)
	out := make(chan event.Event, 32)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go func() { _ = s.Run(ctx, frames, out) }()

	// Attach workout before the first frame, then start.
	s.AttachWorkout("w-abc")
	s.StartSession("")

	// First frame → opens session.
	frames <- ipm.Frame{TimeSec: 1, DistanceM: 1, SPM: 20, PowerW: 100, Level: 3}
	got := drain(t, out, 2) // session_start + stroke
	start1 := got[0]
	if start1.Kind != event.KindSessionStart {
		t.Fatalf("expected session_start, got %v", start1.Kind)
	}
	if start1.SessionStart.WorkoutID != "w-abc" {
		t.Errorf("first session WorkoutID = %q, want %q", start1.SessionStart.WorkoutID, "w-abc")
	}

	// Advance time past idle timeout, request a new start without
	// a workout — should close session 1 and open session 2.
	now = now.Add(90 * time.Second)
	s.StartSession("")

	// Second frame goes into session 2.
	frames <- ipm.Frame{TimeSec: 2, DistanceM: 2, SPM: 20, PowerW: 100, Level: 3}
	got2 := drain(t, out, 3) // session_end + session_start + stroke
	var start2 event.Event
	for _, e := range got2 {
		if e.Kind == event.KindSessionStart {
			start2 = e
		}
	}
	if start2.Kind != event.KindSessionStart {
		t.Fatal("did not receive second session_start")
	}
	if start2.SessionStart.WorkoutID != "" {
		t.Errorf("second session WorkoutID = %q, want empty (one-shot)", start2.SessionStart.WorkoutID)
	}
}

// makeDistanceWorkout builds a workout.Workout for use in phase tests.
// meters=100, warmupSec=30, cooldownSec=60 is the canonical test fixture.
func makeDistanceWorkout(meters, warmupSec, cooldownSec int) *workout.Workout {
	params, _ := json.Marshal(map[string]int{"meters": meters})
	return &workout.Workout{
		ID:          "test-workout",
		Mode:        workout.ModeDistance,
		ParamsJSON:  json.RawMessage(params),
		WarmupSec:   warmupSec,
		CooldownSec: cooldownSec,
	}
}

// collectKind drains events from a slice and returns those matching the given kind.
func collectKind(evts []event.Event, k event.Kind) []event.Event {
	var out []event.Event
	for _, e := range evts {
		if e.Kind == k {
			out = append(out, e)
		}
	}
	return out
}

// TestSessionizerTagsStrokesWithPhase verifies that stroke events carry the
// correct Phase field when a distance workout with warmup and cooldown is used.
// Fixture: 100 m work goal, warmup=30s, cooldown=60s.
//   - t=5,  d=0:   warmup (5 < 30s)
//   - t=35, d=5:   work (warmup elapsed; warmupEndDistance latches at d=5)
//   - t=70, d=105: work crossing — 100m of post-warmup work reached
//                  (PhasePlan records crossing but returns work)
//   - t=75, d=106: cooldown (past target, crossedAt set → falls through)
func TestSessionizerTagsStrokesWithPhase(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	in := make(chan ipm.Frame, 8)
	out := make(chan event.Event, 32)

	w := makeDistanceWorkout(100, 30, 60)
	s := New(Options{
		IdleTimeout: time.Minute,
		Now:         time.Now,
		LoadWorkout: func(id string) (*workout.Workout, error) { return w, nil },
	})
	go func() { _ = s.Run(ctx, in, out) }()

	s.StartSession("test-workout")
	in <- frame(5, 0, 25, 200, 3)    // warmup
	in <- frame(35, 5, 25, 200, 3)   // work (warmup ended; anchor=5)
	in <- frame(70, 105, 25, 200, 3) // work (crossing 100m of post-warmup work)
	in <- frame(75, 106, 25, 200, 3) // cooldown

	// Events: session_start, phase_change(work→warmup), stroke(warmup),
	//         phase_change(warmup→work), stroke(work), stroke(work/crossing),
	//         phase_change(work→cooldown), stroke(cooldown)  = 8 total
	got := drain(t, out, 8)

	strokes := collectKind(got, event.KindStroke)
	if len(strokes) != 4 {
		t.Fatalf("expected 4 stroke events, got %d", len(strokes))
	}
	wantPhases := []string{"warmup", "work", "work", "cooldown"}
	for i, e := range strokes {
		if e.Stroke.Phase != wantPhases[i] {
			t.Errorf("stroke %d phase = %q, want %q", i+1, e.Stroke.Phase, wantPhases[i])
		}
	}
}

// TestSessionizerEmitsPhaseChange verifies that KindPhaseChange events are
// emitted at boundaries with correct From/To fields.
func TestSessionizerEmitsPhaseChange(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	in := make(chan ipm.Frame, 8)
	out := make(chan event.Event, 32)

	w := makeDistanceWorkout(100, 30, 60)
	s := New(Options{
		IdleTimeout: time.Minute,
		Now:         time.Now,
		LoadWorkout: func(id string) (*workout.Workout, error) { return w, nil },
	})
	go func() { _ = s.Run(ctx, in, out) }()

	s.StartSession("test-workout")
	in <- frame(5, 0, 25, 200, 3)    // warmup
	in <- frame(35, 5, 25, 200, 3)   // work (warmup ended; anchor=5)
	in <- frame(70, 105, 25, 200, 3) // work crossing (100m post-warmup work)
	in <- frame(75, 106, 25, 200, 3) // cooldown (past target → phase_change work→cooldown)

	// 8 events: session_start, 3×phase_change, 4×stroke
	got := drain(t, out, 8)

	changes := collectKind(got, event.KindPhaseChange)
	if len(changes) != 3 {
		t.Fatalf("expected 3 phase_change events, got %d", len(changes))
	}
	// First: work → warmup (initial sentinel is PhaseWork)
	if changes[0].PhaseChange.From != "work" || changes[0].PhaseChange.To != "warmup" {
		t.Errorf("phase_change[0] = %q→%q, want work→warmup",
			changes[0].PhaseChange.From, changes[0].PhaseChange.To)
	}
	// Second: warmup → work
	if changes[1].PhaseChange.From != "warmup" || changes[1].PhaseChange.To != "work" {
		t.Errorf("phase_change[1] = %q→%q, want warmup→work",
			changes[1].PhaseChange.From, changes[1].PhaseChange.To)
	}
	// Third: work → cooldown (triggered by the first stroke PAST the target)
	if changes[2].PhaseChange.From != "work" || changes[2].PhaseChange.To != "cooldown" {
		t.Errorf("phase_change[2] = %q→%q, want work→cooldown",
			changes[2].PhaseChange.From, changes[2].PhaseChange.To)
	}
}

// TestSessionizerEndsOnWorkoutComplete verifies that the sessionizer
// automatically closes the session (emits KindSessionEnd) when the
// PhasePlan reports the workout is complete (cooldown elapsed).
// Fixture: 100m, warmup=0, cooldown=30s. Frames carry PM5-cumulative
// values; the sessionizer rebases the first stroke to (0,0).
//   - t=10, d=0:    anchor stroke → rebased (0,0); work; no phase_change
//   - t=20, d=100:  rebased (10,100); work crossing (crossedAt=10)
//   - t=30, d=101:  rebased (20,101); cooldown begins; phase_change(work→cooldown)
//   - t=61, d=101:  rebased (51,101); cooldown elapsed (51-10=41>30); session_end
func TestSessionizerEndsOnWorkoutComplete(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	in := make(chan ipm.Frame, 8)
	out := make(chan event.Event, 32)

	w := makeDistanceWorkout(100, 0, 30)
	s := New(Options{
		IdleTimeout: time.Minute,
		Now:         time.Now,
		LoadWorkout: func(id string) (*workout.Workout, error) { return w, nil },
	})
	go func() { _ = s.Run(ctx, in, out) }()

	s.StartSession("test-workout")
	in <- frame(10, 0, 25, 200, 3)   // anchor stroke (rebased 0,0); work
	in <- frame(20, 100, 25, 200, 3) // crossing (rebased 10,100); work
	in <- frame(30, 101, 25, 200, 3) // cooldown (rebased 20,101)
	in <- frame(61, 101, 25, 200, 3) // done (rebased 51,101); session_end

	// Events: session_start, stroke(anchor), stroke(crossing),
	//         phase_change(work→cooldown), stroke(cooldown),
	//         phase_change(cooldown→done), stroke(done),
	//         session_end = 8 total
	got := drain(t, out, 8)

	ends := collectKind(got, event.KindSessionEnd)
	if len(ends) != 1 {
		t.Fatalf("expected 1 session_end, got %d", len(ends))
	}
}

// TestSessionizerEndsOnPhaseDoneAcrossAllBoundaries verifies that a
// structured Distance workout with both warmup and cooldown phases
// emits exactly one KindSessionEnd, stamped with EndedAt = Now(), at
// the moment PhasePlan reports PhaseDone (cooldown elapsed). This is
// the Slice-1 acceptance criterion (FEAT-0015): phase-driven auto-end
// fires reliably across warmup→work→cooldown→done.
//
// Fixture: 100m, warmup=10s, cooldown=20s.
// PM5-cumulative frames; the sessionizer rebases the first stroke to
// (0,0).
//   - t=2,  d=0:   anchor stroke → rebased (0,0); warmup
//   - t=15, d=0:   rebased (13,0); warmup elapsed → phase_change(warmup→work)
//   - t=25, d=100: rebased (23,100); work crossing, crossedAt=23
//   - t=30, d=101: rebased (28,101); cooldown begins; phase_change(work→cooldown)
//   - t=55, d=101: rebased (53,101); cooldown elapsed (53-23=30 > 20); session_end
func TestSessionizerEndsOnPhaseDoneAcrossAllBoundaries(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	in := make(chan ipm.Frame, 8)
	out := make(chan event.Event, 64)

	// Pin Now() so we can assert EndedAt deterministically.
	fixedNow := time.Date(2026, 5, 10, 12, 0, 0, 0, time.UTC)
	w := makeDistanceWorkout(100, 10, 20)
	s := New(Options{
		IdleTimeout: time.Minute,
		Now:         func() time.Time { return fixedNow },
		LoadWorkout: func(id string) (*workout.Workout, error) { return w, nil },
	})
	go func() { _ = s.Run(ctx, in, out) }()

	s.StartSession("test-workout")
	in <- frame(2, 0, 25, 200, 3)    // warmup anchor (rebased 0,0)
	in <- frame(15, 0, 25, 200, 3)   // warmup→work transition (rebased 13,0)
	in <- frame(25, 100, 25, 200, 3) // work crossing (rebased 23,100)
	in <- frame(30, 101, 25, 200, 3) // work→cooldown (rebased 28,101)
	in <- frame(55, 101, 25, 200, 3) // cooldown elapsed → session_end (rebased 53,101)

	// Drain everything until session_end shows up (or timeout).
	var got []event.Event
	deadline := time.After(2 * time.Second)
	for {
		select {
		case e := <-out:
			got = append(got, e)
			if e.Kind == event.KindSessionEnd {
				goto Done
			}
		case <-deadline:
			t.Fatalf("timeout waiting for session_end; got kinds so far: %v", kinds(got))
		}
	}
Done:

	ends := collectKind(got, event.KindSessionEnd)
	if len(ends) != 1 {
		t.Fatalf("expected exactly 1 session_end across all phase boundaries, got %d", len(ends))
	}
	end := ends[0]
	if end.SessionEnd == nil {
		t.Fatalf("session_end payload is nil")
	}
	if !end.SessionEnd.EndedAt.Equal(fixedNow) {
		t.Errorf("session_end.EndedAt = %v, want %v (now() at phase-driven close)",
			end.SessionEnd.EndedAt, fixedNow)
	}

	// Each phase boundary should fire exactly one phase_change event.
	changes := collectKind(got, event.KindPhaseChange)
	wantChanges := []struct{ from, to string }{
		{"work", "warmup"}, // synthetic initial: sessionizer seeds currentPhase=work, first stroke classifies warmup
		{"warmup", "work"},
		{"work", "cooldown"},
	}
	if len(changes) < len(wantChanges) {
		t.Fatalf("expected at least %d phase_change events, got %d: %v",
			len(wantChanges), len(changes), changes)
	}
	for i, w := range wantChanges {
		if changes[i].PhaseChange.From != w.from || changes[i].PhaseChange.To != w.to {
			t.Errorf("phase_change[%d] = %q→%q, want %q→%q", i,
				changes[i].PhaseChange.From, changes[i].PhaseChange.To, w.from, w.to)
		}
	}
}

// kinds is a tiny debug helper for the loop above.
func kinds(evts []event.Event) []string {
	out := make([]string, len(evts))
	for i, e := range evts {
		out[i] = string(e.Kind)
	}
	return out
}

// TestSessionizerSummaryWorkOnlyTotals verifies that warmup-phase strokes
// are excluded from summary totals (AvgPowerW, TotalDistanceM) and that
// WarmupSec is correctly counted.
// Fixture: 10m distance, warmup=10s.
//   - t=5,  d=0,  power=100: warmup stroke (not counted in work totals)
//   - t=15, d=5,  power=200: work stroke (counted)
// Then EndSession() to flush.
func TestSessionizerSummaryWorkOnlyTotals(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	in := make(chan ipm.Frame, 8)
	out := make(chan event.Event, 32)

	w := makeDistanceWorkout(10, 10, 0)
	s := New(Options{
		IdleTimeout: time.Minute,
		Now:         time.Now,
		LoadWorkout: func(id string) (*workout.Workout, error) { return w, nil },
	})
	go func() { _ = s.Run(ctx, in, out) }()

	s.StartSession("test-workout")
	in <- frame(5, 0, 25, 100, 3)  // warmup
	in <- frame(15, 5, 25, 200, 3) // work (d=5 < 10m, still PhaseWork)

	// Events so far: session_start, phase_change(work→warmup), stroke(warmup),
	//                phase_change(warmup→work), stroke(work)  = 5
	_ = drain(t, out, 5)

	// Manually end the session.
	s.EndSession()
	got := drain(t, out, 1) // session_end

	end := got[0]
	if end.Kind != event.KindSessionEnd {
		t.Fatalf("expected session_end, got %v", end.Kind)
	}
	sum := end.SessionEnd.Summary

	// Only the work stroke (d=5, power=200) should be counted.
	if sum.TotalDistanceM != 5 {
		t.Errorf("TotalDistanceM = %d, want 5", sum.TotalDistanceM)
	}
	if sum.AvgPowerW != 200 {
		t.Errorf("AvgPowerW = %d, want 200", sum.AvgPowerW)
	}
	if sum.TotalStrokes != 1 {
		t.Errorf("TotalStrokes = %d, want 1 (work only)", sum.TotalStrokes)
	}
	// WarmupSec: boundary from t=5 (warmup start) to t=15 (work start) = 10s.
	if sum.WarmupSec < 9.9 || sum.WarmupSec > 10.1 {
		t.Errorf("WarmupSec = %v, want ~10", sum.WarmupSec)
	}
}

// TestSessionizerSummaryAvgSPI verifies that AvgSPI is populated when
// strokes have valid power and spm (power >= 20 && spm > 0).
// Two work strokes: power=200, spm=25 → SPI = 200/25 = 8 each → AvgSPI = 8.
func TestSessionizerSummaryAvgSPI(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	in := make(chan ipm.Frame, 8)
	out := make(chan event.Event, 32)

	s := New(Options{
		IdleTimeout: time.Minute,
		Now:         time.Now,
	})
	go func() { _ = s.Run(ctx, in, out) }()

	s.StartSession("")
	in <- frame(2, 8, 25, 200, 3)
	in <- frame(4, 16, 25, 200, 3)
	// Events: session_start, stroke, stroke = 3
	_ = drain(t, out, 3)

	s.EndSession()
	got := drain(t, out, 1) // session_end

	sum := got[0].SessionEnd.Summary
	if sum.AvgSPI <= 0 {
		t.Errorf("AvgSPI = %d, want > 0 (power=200, spm=25 → SPI=8)", sum.AvgSPI)
	}
	wantSPI := 200 / 25
	if sum.AvgSPI != wantSPI {
		t.Errorf("AvgSPI = %d, want %d", sum.AvgSPI, wantSPI)
	}
}

// TestSessionizerRebasesStrokesFromFirstStroke verifies that the first
// stroke after session_start anchors the session, so subsequent strokes
// are emitted with values relative to it (rather than the PM5's absolute
// cumulative time/distance).
func TestSessionizerRebasesStrokesFromFirstStroke(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	in := make(chan ipm.Frame, 4)
	out := make(chan event.Event, 16)
	s := New(Options{IdleTimeout: time.Minute, Now: time.Now})
	go func() { _ = s.Run(ctx, in, out) }()

	s.StartSession("")
	in <- frame(30, 50, 25, 200, 3) // user rowed 30s/50m on the PM5 before pressing Start
	in <- frame(35, 60, 25, 200, 3)
	got := drain(t, out, 3) // session_start, stroke, stroke

	strokes := collectKind(got, event.KindStroke)
	if len(strokes) != 2 {
		t.Fatalf("expected 2 stroke events, got %d", len(strokes))
	}
	if got, want := strokes[0].Stroke.TimeSec, 0.0; got != want {
		t.Errorf("first stroke TimeSec = %v, want %v (rebased)", got, want)
	}
	if got, want := strokes[0].Stroke.DistanceM, 0; got != want {
		t.Errorf("first stroke DistanceM = %d, want %d (rebased)", got, want)
	}
	if got, want := strokes[1].Stroke.TimeSec, 5.0; got != want {
		t.Errorf("second stroke TimeSec = %v, want %v", got, want)
	}
	if got, want := strokes[1].Stroke.DistanceM, 10; got != want {
		t.Errorf("second stroke DistanceM = %d, want %d", got, want)
	}
}

// TestSessionizerWarmupNotSkippedWhenPM5PreCounted verifies that a
// pre-roll on the PM5 (e.g. user rowed 2 minutes before pressing Start)
// does not consume the workout's warmup. After rebase the first stroke
// is at (0,0), so warmup phase is honored from there.
func TestSessionizerWarmupNotSkippedWhenPM5PreCounted(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	in := make(chan ipm.Frame, 8)
	out := make(chan event.Event, 32)

	w := makeDistanceWorkout(100, 60, 0) // warmup 60s, distance 100m, no cooldown
	s := New(Options{
		IdleTimeout: time.Minute,
		Now:         time.Now,
		LoadWorkout: func(id string) (*workout.Workout, error) { return w, nil },
	})
	go func() { _ = s.Run(ctx, in, out) }()

	s.StartSession("test-workout")
	in <- frame(120, 200, 25, 200, 3) // PM5 cumulative 2 min / 200 m before press
	in <- frame(125, 205, 25, 200, 3)
	got := drain(t, out, 4) // session_start, phase_change(work→warmup)?, stroke, stroke

	strokes := collectKind(got, event.KindStroke)
	if len(strokes) != 2 {
		t.Fatalf("expected 2 stroke events, got %d", len(strokes))
	}
	for i, st := range strokes {
		if st.Stroke.Phase != "warmup" {
			t.Errorf("stroke[%d] phase = %q, want %q (rebased timeSec inside warmup window)", i, st.Stroke.Phase, "warmup")
		}
	}
}

// TestSessionizerReanchorsOnWorkoutAttach verifies that attaching a
// workout to a free-row session resets the phase anchor, so warmup
// starts fresh from the next stroke after the attach. Storage anchor
// stays put — persisted stroke distance/time keep climbing monotonically.
func TestSessionizerReanchorsOnWorkoutAttach(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	in := make(chan ipm.Frame, 8)
	out := make(chan event.Event, 32)

	w := makeDistanceWorkout(100, 30, 0) // warmup 30s, distance 100m
	s := New(Options{
		IdleTimeout: time.Minute,
		Now:         time.Now,
		LoadWorkout: func(id string) (*workout.Workout, error) { return w, nil },
	})
	go func() { _ = s.Run(ctx, in, out) }()

	// Free-row first.
	s.StartSession("")
	in <- frame(0, 0, 25, 200, 3)     // anchor
	in <- frame(60, 300, 25, 200, 3)  // 60s / 300m into free-row
	_ = drain(t, out, 3)              // session_start, stroke, stroke

	// Attach workout mid-session.
	s.AttachWorkout("test-workout")
	in <- frame(65, 305, 25, 200, 3)  // first stroke after attach: phase anchor = absolute (65,305)
	in <- frame(80, 310, 25, 200, 3)  // 15s into workout warmup
	got := drain(t, out, 4)           // workout_attached, phase_change, stroke, stroke ?

	strokes := collectKind(got, event.KindStroke)
	if len(strokes) != 2 {
		t.Fatalf("expected 2 stroke events after attach, got %d", len(strokes))
	}
	// Both strokes must classify as warmup (phase-relative time < 30s).
	for i, st := range strokes {
		if st.Stroke.Phase != "warmup" {
			t.Errorf("post-attach stroke[%d] phase = %q, want warmup", i, st.Stroke.Phase)
		}
	}
	// Storage anchor still at frame1 (0,0) so persisted distances climb monotonically.
	if got, want := strokes[0].Stroke.DistanceM, 305; got != want {
		t.Errorf("first post-attach stroke DistanceM = %d, want %d (storage-relative)", got, want)
	}
	if got, want := strokes[1].Stroke.DistanceM, 310; got != want {
		t.Errorf("second post-attach stroke DistanceM = %d, want %d", got, want)
	}
}

// TestPhasePlanReset clears the crossedAt cache so the next encounter
// with a previously-crossed segment returns the segment's own kind again.
func TestPhasePlanReset(t *testing.T) {
	w := makeDistanceWorkout(100, 0, 0)
	plan, err := BuildPhasePlan(w)
	if err != nil {
		t.Fatal(err)
	}
	if p, complete := plan.Classify(100, 10); p != PhaseWork || complete {
		t.Fatalf("first classify: got (%v,%v), want (PhaseWork,false)", p, complete)
	}
	if p, complete := plan.Classify(101, 11); p != PhaseDone || !complete {
		t.Fatalf("after crossing: got (%v,%v), want (PhaseDone,true)", p, complete)
	}
	plan.Reset()
	if p, complete := plan.Classify(100, 20); p != PhaseWork || complete {
		t.Fatalf("after reset: got (%v,%v), want (PhaseWork,false) — crossedAt cleared", p, complete)
	}
}

func TestSessionizer_ConcurrentSnapshotDuringStart(t *testing.T) {
	t.Parallel()
	s := New(Options{IdleTimeout: time.Minute, Now: time.Now})
	in := make(chan ipm.Frame, 8)
	out := make(chan event.Event, 64)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go s.Run(ctx, in, out)

	var wg sync.WaitGroup
	wg.Add(2)
	go func() {
		defer wg.Done()
		for i := 0; i < 200; i++ {
			s.AttachWorkout("w1")
			s.StartSession("w1")
		}
	}()
	go func() {
		defer wg.Done()
		for i := 0; i < 1000; i++ {
			_ = s.Snapshot()
			_ = s.MaxEventID()
		}
	}()
	wg.Wait()
	cancel()
	<-out
}
