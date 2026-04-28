package stats_test

import (
	"context"
	"testing"
	"time"

	"github.com/gloeckner-daniel/home-ergo/internal/stats"
)

// TestSchedulerWaitDrains: trigger a recompute, immediately call Wait,
// and confirm Wait returns after the in-flight job completes (the side
// effect — stats_version bump — is observable post-Wait).
func TestSchedulerWaitDrains(t *testing.T) {
	db := openDB(t)
	t0 := time.Date(2026, 4, 1, 8, 0, 0, 0, time.UTC)
	seedSession(t, db, "S1", "R1", t0, 5000, 500, 1500, &PBCandidates{
		Distance: []DistanceCandidate{{DistanceM: 2000, TimeSec: 480}},
	})

	sched := stats.NewRecomputeScheduler(db)
	sched.Trigger("R1")

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := sched.Wait(ctx, "R1"); err != nil {
		t.Fatalf("Wait: %v", err)
	}

	// After Wait returns the recompute side-effects must be visible.
	var version int
	if err := db.QueryRow(
		`SELECT stats_version FROM rower_lifetime_stats WHERE rower_id='R1'`).Scan(&version); err != nil {
		t.Fatalf("read stats_version: %v", err)
	}
	if version < 1 {
		t.Errorf("stats_version=%d, want >=1 after Wait", version)
	}

	// Wait when idle returns nil immediately.
	if err := sched.Wait(ctx, "R1"); err != nil {
		t.Errorf("Wait when idle: %v", err)
	}

	// Wait with empty rower returns nil.
	if err := sched.Wait(ctx, ""); err != nil {
		t.Errorf("Wait empty: %v", err)
	}
}

// TestSchedulerWaitCoalesces: a Trigger while running coalesces into a
// pending job; Wait must drain both runs.
func TestSchedulerWaitCoalesces(t *testing.T) {
	db := openDB(t)
	t0 := time.Date(2026, 4, 1, 8, 0, 0, 0, time.UTC)
	seedSession(t, db, "S1", "R1", t0, 5000, 500, 1500, nil)

	sched := stats.NewRecomputeScheduler(db)
	sched.Trigger("R1")
	sched.Trigger("R1")
	sched.Trigger("R1")

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := sched.Wait(ctx, "R1"); err != nil {
		t.Fatalf("Wait: %v", err)
	}
}
