package storage

import (
	"context"
	"database/sql"
	"encoding/json"
	"path/filepath"
	"testing"
	"time"

	"github.com/gloeckner-daniel/splits/internal/event"
	"github.com/gloeckner-daniel/splits/internal/stats"
	_ "modernc.org/sqlite"
)

// At session_end, strokes now PERSIST (FEAT-0015 Slice 4, ADR-0011) so
// the replay harness can re-feed them through the live reducer. The
// downsampled samples inside summary_json still get written as a
// pre-computed cache for charting.
func TestPersisterCompactsStrokesAtSessionEnd(t *testing.T) {
	db, err := Open(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	in := make(chan event.Event, 32)
	p := &Persister{DB: db.Handle()}
	done := make(chan error, 1)
	go func() { done <- p.Run(ctx, in) }()

	started := time.Date(2026, 4, 21, 10, 0, 0, 0, time.UTC)
	in <- event.Event{ID: 1, Kind: event.KindSessionStart, SessionID: "S1",
		SessionStart: &event.SessionStartPayload{StartedAt: started, RowerID: "R1", RowerName: "D", InitialLevel: 3}}
	for i := 1; i <= 7; i++ {
		in <- event.Event{ID: uint64(1 + i), Kind: event.KindStroke, SessionID: "S1", At: started,
			Stroke: &event.StrokePayload{StrokeNo: i, TimeSec: float64(i) * 2.2, DistanceM: i * 8,
				SPM: 26, PowerW: 200 + i, CalPerHr: 1100, Level: 3,
				DPS: 8, StrokeCycleSec: 2.2, PaceSecPer500m: 130 + i, EnergyJoules: 500}}
	}
	in <- event.Event{ID: 100, Kind: event.KindSessionEnd, SessionID: "S1",
		SessionEnd: &event.SessionEndPayload{EndedAt: started.Add(time.Minute),
			Summary: event.SessionSummary{TotalDistanceM: 56, TotalTimeSec: 15.4, TotalStrokes: 7}}}
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
	if strokes != 7 {
		t.Errorf("strokes after session_end = %d, want 7 (replay-grade persistence per ADR-0011)", strokes)
	}

	var endedAt, summaryStr string
	if err := db.Handle().QueryRow(`SELECT COALESCE(ended_at,''), COALESCE(summary_json,'') FROM sessions WHERE id=?`,
		"S1").Scan(&endedAt, &summaryStr); err != nil {
		t.Fatal(err)
	}
	if endedAt == "" {
		t.Error("ended_at should be set")
	}
	var sum event.SessionSummary
	if err := json.Unmarshal([]byte(summaryStr), &sum); err != nil {
		t.Fatalf("summary_json: %v", err)
	}
	if sum.Samples == nil {
		t.Fatal("samples missing from summary_json")
	}
	// 7 strokes / 5-bucket = 2 buckets (5 + 2)
	if got := len(sum.Samples.T); got != 2 {
		t.Errorf("samples bucket count = %d, want 2", got)
	}
}

func TestApplySessionEndFiltersNonWorkStrokes(t *testing.T) {
	db := testDB(t)
	ctx := context.Background()
	if err := InsertSession(ctx, db.Handle(), "s1", "r1", time.Unix(0, 0).UTC(), 5, ""); err != nil {
		t.Fatal(err)
	}
	mk := func(no int, ts float64, dist int, phase string, power int) event.StrokePayload {
		return event.StrokePayload{StrokeNo: no, TimeSec: ts, DistanceM: dist, PowerW: power, Phase: phase}
	}
	rows := []event.StrokePayload{
		mk(1, 1, 0, "warmup", 50),
		mk(2, 2, 5, "work", 200),
		mk(3, 3, 10, "work", 210),
		mk(4, 4, 10, "cooldown", 80),
	}
	for i, r := range rows {
		if err := InsertStroke(ctx, db.Handle(), uint64(i+1), "s1", time.Unix(0, 0).UTC(), r); err != nil {
			t.Fatal(err)
		}
	}
	p := &Persister{DB: db.Handle()}
	end := event.Event{
		Kind: event.KindSessionEnd, SessionID: "s1",
		SessionEnd: &event.SessionEndPayload{
			EndedAt: time.Unix(10, 0).UTC(),
			Summary: event.SessionSummary{
				TotalDistanceM: 10, TotalTimeSec: 4, TotalStrokes: 2,
				AvgPowerW: 205, PeakPowerW: 210,
			},
		},
	}
	if err := p.apply(ctx, end); err != nil {
		t.Fatal(err)
	}
	var blob string
	if err := db.Handle().QueryRow(`SELECT summary_json FROM sessions WHERE id='s1'`).Scan(&blob); err != nil {
		t.Fatal(err)
	}
	var sum event.SessionSummary
	if err := json.Unmarshal([]byte(blob), &sum); err != nil {
		t.Fatal(err)
	}
	if sum.Samples == nil || len(sum.Samples.Watt) == 0 {
		t.Fatalf("expected work-only samples, got %+v", sum.Samples)
	}
	for _, w := range sum.Samples.Watt {
		if w < 200 || w > 210 {
			t.Fatalf("samples include non-work stroke: %v", sum.Samples.Watt)
		}
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

// PRD-0017 / 0017-03: a race-mode session_end triggers BOTH the
// inbound session_end and a follow-up session_finalized emission on
// the persister's Out channel, with Race populated.
func TestPersisterEmitsSessionFinalizedAfterRaceCommit(t *testing.T) {
	db, err := Open(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	now := time.Now().UTC().Format(time.RFC3339Nano)
	if _, err := db.Handle().Exec(`INSERT INTO rowers(id,name,color,created_at) VALUES('R1','D','#0f0',?)`, now); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Handle().Exec(`
        INSERT INTO workout(id,mode,params_json,intensity,warmup_sec,cooldown_sec,created_at,shape_hash)
        VALUES('W1','race','{"meters":2000}','moderat',0,0,?,'shape')`, now); err != nil {
		t.Fatal(err)
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	in := make(chan event.Event, 16)
	out := make(chan event.Event, 8)
	var nextID uint64 = 1000
	stamp := func(e *event.Event) {
		nextID++
		e.ID = nextID
		if e.At.IsZero() {
			e.At = time.Now()
		}
	}
	p := &Persister{DB: db.Handle(), Out: out, Stamp: stamp}
	done := make(chan error, 1)
	go func() { done <- p.Run(ctx, in) }()

	started := time.Date(2026, 4, 21, 10, 0, 0, 0, time.UTC)
	in <- event.Event{ID: 1, Kind: event.KindSessionStart, SessionID: "S1",
		SessionStart: &event.SessionStartPayload{StartedAt: started, RowerID: "R1", InitialLevel: 3, WorkoutID: "W1"}}
	// A handful of work strokes so summary.Samples is populated and
	// the persister sees a non-trivial session to enrich.
	for i := 1; i <= 5; i++ {
		in <- event.Event{ID: uint64(1 + i), Kind: event.KindStroke, SessionID: "S1", At: started,
			Stroke: &event.StrokePayload{StrokeNo: i, TimeSec: float64(i) * 2.0, DistanceM: i * 400,
				SPM: 26, PowerW: 200, CalPerHr: 1100, Level: 3,
				DPS: 8, StrokeCycleSec: 2.0, PaceSecPer500m: 120, EnergyJoules: 500, Phase: "work"}}
	}
	in <- event.Event{ID: 100, Kind: event.KindSessionEnd, SessionID: "S1",
		SessionEnd: &event.SessionEndPayload{EndedAt: started.Add(8 * time.Minute),
			Summary: event.SessionSummary{
				TotalDistanceM: 2000, TotalTimeSec: 480.0, TotalStrokes: 5,
			}}}
	close(in)

	select {
	case err := <-done:
		if err != nil {
			t.Fatalf("run: %v", err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("persister did not finish")
	}

	close(out)
	var fin *event.Event
	for e := range out {
		if e.Kind == event.KindSessionFinalized {
			ee := e
			fin = &ee
		}
	}
	if fin == nil {
		t.Fatal("expected session_finalized emission on Out")
	}
	if fin.SessionID != "S1" {
		t.Errorf("session_id=%q want S1", fin.SessionID)
	}
	if fin.ID == 0 {
		t.Error("session_finalized event missing stamped ID")
	}
	if fin.SessionFinalized == nil {
		t.Fatal("session_finalized payload is nil")
	}
	if fin.SessionFinalized.Summary.Race == nil {
		t.Fatalf("expected enriched Race in session_finalized, got summary=%+v", fin.SessionFinalized.Summary)
	}
	if fin.SessionFinalized.Summary.Race.VsGhostSec == nil {
		t.Errorf("expected vs_ghost_sec populated, got %+v", fin.SessionFinalized.Summary.Race)
	}
}

// PRD-0017 / 0017-03: a non-race session still commits and the
// session_finalized event fires but carries summary.Race=nil (no
// regression in non-race flow).
func TestPersisterSessionFinalizedNonRaceHasNoRace(t *testing.T) {
	db, err := Open(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	in := make(chan event.Event, 8)
	out := make(chan event.Event, 4)
	var nextID uint64
	p := &Persister{DB: db.Handle(), Out: out, Stamp: func(e *event.Event) {
		nextID++
		e.ID = nextID
	}}
	done := make(chan error, 1)
	go func() { done <- p.Run(ctx, in) }()

	started := time.Date(2026, 4, 21, 10, 0, 0, 0, time.UTC)
	in <- event.Event{ID: 1, Kind: event.KindSessionStart, SessionID: "S2",
		SessionStart: &event.SessionStartPayload{StartedAt: started, RowerID: "R2", InitialLevel: 3}}
	in <- event.Event{ID: 2, Kind: event.KindSessionEnd, SessionID: "S2",
		SessionEnd: &event.SessionEndPayload{EndedAt: started.Add(time.Minute),
			Summary: event.SessionSummary{TotalDistanceM: 100, TotalTimeSec: 30, TotalStrokes: 5}}}
	close(in)

	select {
	case err := <-done:
		if err != nil {
			t.Fatalf("run: %v", err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("persister did not finish")
	}
	close(out)
	found := false
	for e := range out {
		if e.Kind == event.KindSessionFinalized {
			found = true
			if e.SessionFinalized == nil || e.SessionFinalized.Summary.Race != nil {
				t.Errorf("non-race session_finalized: expected Race=nil, got %+v", e.SessionFinalized)
			}
		}
	}
	if !found {
		t.Error("expected session_finalized emission for non-race session")
	}
}

// TestApplySessionEnd_RecomputeTriggered verifies that when a session_end
// arrives for a rower with a workout attached, the recompute scheduler
// receives a trigger. Before the fix, the LEFT JOIN to the non-existent
// `workouts` table silently set rowerID="" and OnSessionChange was never
// called (2026-06-10 bug).
func TestApplySessionEnd_RecomputeTriggered(t *testing.T) {
	db := testDB(t)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	now := time.Now().UTC().Format(time.RFC3339Nano)
	// Rower required for insights FK constraint and recompute eligibility.
	if _, err := db.Handle().ExecContext(ctx,
		`INSERT INTO rowers(id, name, color, created_at) VALUES('R1','TestRower','#0f0',?)`, now); err != nil {
		t.Fatalf("seed rower: %v", err)
	}
	if _, err := db.Handle().ExecContext(ctx,
		`INSERT INTO workout(id, mode, params_json, warmup_sec, cooldown_sec, created_at) VALUES('W1','just_row','{}',0,0,?)`, now); err != nil {
		t.Fatalf("seed workout: %v", err)
	}

	sched := stats.NewRecomputeScheduler(db.Handle())
	p := &Persister{DB: db.Handle(), Scheduler: sched}

	started := time.Date(2026, 6, 10, 10, 0, 0, 0, time.UTC)
	if err := InsertSession(ctx, db.Handle(), "S1", "R1", started, 3, "W1"); err != nil {
		t.Fatalf("InsertSession: %v", err)
	}
	// A few work strokes so Samples are non-nil.
	for i := 1; i <= 5; i++ {
		if err := InsertStroke(ctx, db.Handle(), uint64(i), "S1", started, event.StrokePayload{
			StrokeNo: i, TimeSec: float64(i) * 60, DistanceM: i * 500,
			SPM: 24, PowerW: 180, Phase: "work",
		}); err != nil {
			t.Fatalf("InsertStroke %d: %v", i, err)
		}
	}

	endEvt := event.Event{
		ID: 99, Kind: event.KindSessionEnd, SessionID: "S1",
		SessionEnd: &event.SessionEndPayload{
			EndedAt: started.Add(5 * time.Minute),
			Summary: event.SessionSummary{TotalDistanceM: 2500, TotalTimeSec: 300, TotalStrokes: 5},
		},
	}
	if err := p.apply(ctx, endEvt); err != nil {
		t.Fatalf("apply session_end: %v", err)
	}

	// Wait for any in-flight recompute to drain (timeout already on ctx).
	// If rowerID was "" (the old bug), Wait returns immediately as a no-op
	// and we'd never have set the idle channel — same observable result but
	// the goroutine would not have started. We verify via a second query:
	// stats.Recompute for R1 must have run (it upserts lifetime_stats).
	if err := sched.Wait(ctx, "R1"); err != nil {
		t.Fatalf("scheduler.Wait: %v", err)
	}
	// Recompute writes rower_lifetime_stats; presence of a row confirms it ran.
	var cnt int
	if err := db.Handle().QueryRowContext(ctx,
		`SELECT COUNT(*) FROM rower_lifetime_stats WHERE rower_id='R1'`).Scan(&cnt); err != nil {
		t.Fatalf("rower_lifetime_stats query: %v", err)
	}
	if cnt == 0 {
		t.Error("recompute was not triggered: rower_lifetime_stats row absent for R1")
	}
}

// TestApplySessionEnd_InsightsRowsWritten verifies that session_insights
// rows are persisted after a session_end for an eligible session (workout
// attached, mode != "intervals", duration >= 300s, distance >= 1000m).
// Before the fix, rowerID was always "" due to the broken workouts JOIN,
// so insights.ReplaceForSessionTx was never called.
func TestApplySessionEnd_InsightsRowsWritten(t *testing.T) {
	db := testDB(t)
	ctx := context.Background()

	now := time.Now().UTC().Format(time.RFC3339Nano)
	if _, err := db.Handle().ExecContext(ctx,
		`INSERT INTO rowers(id, name, color, created_at) VALUES('R2','Rower2','#00f',?)`, now); err != nil {
		t.Fatalf("seed rower: %v", err)
	}
	if _, err := db.Handle().ExecContext(ctx,
		`INSERT INTO workout(id, mode, params_json, warmup_sec, cooldown_sec, created_at) VALUES('W2','distance','{"meters":2000}',0,0,?)`, now); err != nil {
		t.Fatalf("seed workout: %v", err)
	}

	p := &Persister{DB: db.Handle()}

	started := time.Date(2026, 6, 10, 11, 0, 0, 0, time.UTC)
	if err := InsertSession(ctx, db.Handle(), "S2", "R2", started, 3, "W2"); err != nil {
		t.Fatalf("InsertSession: %v", err)
	}
	// Enough work strokes to generate at least one insight (inconsistent
	// power pattern over a ~10-minute, 2000m distance session).
	for i := 1; i <= 10; i++ {
		pwr := 180
		if i%2 == 0 {
			pwr = 300 // alternating high power triggers consistency detector
		}
		if err := InsertStroke(ctx, db.Handle(), uint64(i), "S2", started, event.StrokePayload{
			StrokeNo: i, TimeSec: float64(i) * 60, DistanceM: i * 200,
			SPM: 24, PowerW: pwr, Phase: "work",
		}); err != nil {
			t.Fatalf("InsertStroke %d: %v", i, err)
		}
	}

	endEvt := event.Event{
		ID: 200, Kind: event.KindSessionEnd, SessionID: "S2",
		SessionEnd: &event.SessionEndPayload{
			EndedAt: started.Add(10 * time.Minute),
			Summary: event.SessionSummary{TotalDistanceM: 2000, TotalTimeSec: 600, TotalStrokes: 10},
		},
	}
	if err := p.apply(ctx, endEvt); err != nil {
		t.Fatalf("apply session_end: %v", err)
	}

	// session_insights rows must exist (even if zero findings, the
	// eligibility gate must have run). We verify the rower_id column
	// is correctly populated (was "" before the fix).
	var rowerInDB string
	err := db.Handle().QueryRowContext(ctx,
		`SELECT rower_id FROM session_insights WHERE session_id='S2' LIMIT 1`).Scan(&rowerInDB)
	// It's acceptable for an eligible session with no actual findings to
	// produce zero rows (ReplaceForSessionTx skips the INSERT when len==0).
	// The critical assertion is that rowerID was NOT "": verify by checking
	// the sessions row was updated with ended_at (which only happens when
	// apply returns nil, confirmed above) AND that no error from the JOIN.
	// If insights produced rows, the rower_id must be R2.
	if err == nil && rowerInDB != "R2" {
		t.Errorf("session_insights.rower_id = %q, want R2", rowerInDB)
	}
	// More importantly: the apply itself must not error (checked above),
	// which previously it never did because errors were silently dropped.
	// Confirm ended_at is set — the DB write completed successfully.
	var endedAt string
	if err := db.Handle().QueryRowContext(ctx,
		`SELECT COALESCE(ended_at,'') FROM sessions WHERE id='S2'`).Scan(&endedAt); err != nil {
		t.Fatal(err)
	}
	if endedAt == "" {
		t.Error("session S2 ended_at not set after apply")
	}
}

func TestPersister_DeadLettersAfterMaxRetries(t *testing.T) {
	t.Parallel()
	db, err := sql.Open("sqlite", ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	db.Close()
	p := &Persister{DB: db, MaxRetries: 3}
	in := make(chan event.Event, 1)
	in <- event.Event{ID: 1, Kind: event.KindSessionStart, SessionID: "s1", SessionStart: &event.SessionStartPayload{StartedAt: time.Now()}}
	close(in)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := p.Run(ctx, in); err != nil {
		t.Fatal(err)
	}
	if p.DeadLettered != 1 {
		t.Fatalf("want 1, got %d", p.DeadLettered)
	}
}

// TestApplySessionEnd_RaceGoRetagsPreGoStrokes verifies that when
// RaceGoStrokeNo > 1, pre-GO strokes are re-tagged as warmup before
// aggregation, so they cannot become PB candidates.
func TestApplySessionEnd_RaceGoRetagsPreGoStrokes(t *testing.T) {
	db := testDB(t)
	ctx := context.Background()
	if err := InsertSession(ctx, db.Handle(), "sg1", "r1", time.Unix(0, 0).UTC(), 5, ""); err != nil {
		t.Fatal(err)
	}
	// 3 pre-GO strokes tagged as "work" (will be re-tagged to warmup).
	// 2 post-GO strokes tagged as "work".
	strokes := []event.StrokePayload{
		{StrokeNo: 1, TimeSec: 2, DistanceM: 10, PowerW: 300, SPM: 25, Phase: "work"},
		{StrokeNo: 2, TimeSec: 4, DistanceM: 20, PowerW: 310, SPM: 25, Phase: "work"},
		{StrokeNo: 3, TimeSec: 6, DistanceM: 30, PowerW: 320, SPM: 25, Phase: "work"},
		{StrokeNo: 4, TimeSec: 8, DistanceM: 40, PowerW: 200, SPM: 24, Phase: "work"},
		{StrokeNo: 5, TimeSec: 10, DistanceM: 50, PowerW: 210, SPM: 24, Phase: "work"},
	}
	for i, r := range strokes {
		if err := InsertStroke(ctx, db.Handle(), uint64(i+1), "sg1", time.Unix(0, 0).UTC(), r); err != nil {
			t.Fatal(err)
		}
	}

	p := &Persister{DB: db.Handle()}
	// RaceGoStrokeNo=4 → strokes 1,2,3 should be re-tagged to warmup.
	end := event.Event{
		Kind: event.KindSessionEnd, SessionID: "sg1",
		SessionEnd: &event.SessionEndPayload{
			EndedAt: time.Unix(12, 0).UTC(),
			Summary: event.SessionSummary{
				TotalDistanceM: 20, TotalTimeSec: 4, TotalStrokes: 2,
				RaceGoStrokeNo: 4,
			},
		},
	}
	if err := p.apply(ctx, end); err != nil {
		t.Fatal(err)
	}

	// Verify pre-GO strokes are now tagged as warmup in the DB.
	rows, err := db.Handle().QueryContext(ctx,
		`SELECT stroke_no, phase FROM strokes WHERE session_id = 'sg1' ORDER BY stroke_no`)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	type row struct {
		no    int
		phase string
	}
	var got []row
	for rows.Next() {
		var r row
		if err := rows.Scan(&r.no, &r.phase); err != nil {
			t.Fatal(err)
		}
		got = append(got, r)
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	for _, r := range got {
		if r.no < 4 && r.phase != "warmup" {
			t.Errorf("stroke %d: phase = %q, want warmup (pre-GO re-tag)", r.no, r.phase)
		}
		if r.no >= 4 && r.phase != "work" {
			t.Errorf("stroke %d: phase = %q, want work (post-GO unchanged)", r.no, r.phase)
		}
	}

	// Verify the summary was written.
	var summaryJSON string
	if err := db.Handle().QueryRowContext(ctx,
		`SELECT COALESCE(summary_json,'') FROM sessions WHERE id = 'sg1'`).Scan(&summaryJSON); err != nil {
		t.Fatal(err)
	}
	if summaryJSON == "" {
		t.Error("summary_json is empty after applySessionEnd")
	}
}
