package storage

import (
	"context"
	"encoding/json"
	"path/filepath"
	"testing"
	"time"
)

func TestComputeRaceResult_NonRaceReturnsNil(t *testing.T) {
	db, err := Open(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	now := time.Now().UTC().Format(time.RFC3339Nano)
	db.Handle().Exec(`INSERT INTO rowers(id,name,color,created_at) VALUES('R1','D','#0f0',?)`, now)
	db.Handle().Exec(`
        INSERT INTO workout(id,mode,params_json,intensity,warmup_sec,cooldown_sec,created_at,shape_hash)
        VALUES('W1','distance','{"meters":2000}','moderat',0,0,?,'shape')`, now)
	res, err := ComputeRaceResult(context.Background(), db.Handle(), "W1", "R1", 2000, 470)
	if err != nil {
		t.Fatal(err)
	}
	if res != nil {
		t.Fatalf("expected nil for non-race workout, got %+v", res)
	}
}

func TestComputeRaceResult_RaceWorkoutSynthGhost(t *testing.T) {
	db, err := Open(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	now := time.Now().UTC().Format(time.RFC3339Nano)
	db.Handle().Exec(`INSERT INTO rowers(id,name,color,created_at) VALUES('R1','D','#0f0',?)`, now)
	db.Handle().Exec(`
        INSERT INTO workout(id,mode,params_json,intensity,warmup_sec,cooldown_sec,created_at,shape_hash)
        VALUES('W1','race','{"meters":2000}','moderat',0,0,?,'shape')`, now)

	// User: 2000 m in 480 s. Synth-moderat = 120 split = 480 s. Gap ~0.
	res, err := ComputeRaceResult(context.Background(), db.Handle(), "W1", "R1", 2000, 480.0)
	if err != nil {
		t.Fatal(err)
	}
	if res == nil || res.VsGhostSec == nil {
		t.Fatalf("expected ghost gap, got %+v", res)
	}
	if *res.VsGhostSec < -1 || *res.VsGhostSec > 1 {
		t.Errorf("expected ~0 gap, got %v", *res.VsGhostSec)
	}
	if res.GhostKind != "synth" {
		t.Errorf("kind=%q want synth", res.GhostKind)
	}
	if _, err := json.Marshal(res); err != nil {
		t.Fatal(err)
	}
}

func TestComputeRaceResult_AbortBeforeGoalReturnsNil(t *testing.T) {
	db, err := Open(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	now := time.Now().UTC().Format(time.RFC3339Nano)
	db.Handle().Exec(`INSERT INTO rowers(id,name,color,created_at) VALUES('R1','D','#0f0',?)`, now)
	db.Handle().Exec(`
        INSERT INTO workout(id,mode,params_json,intensity,warmup_sec,cooldown_sec,created_at,shape_hash)
        VALUES('W1','race','{"meters":2000}','moderat',0,0,?,'shape')`, now)
	// User quit at 1500m of a 2000m race.
	res, err := ComputeRaceResult(context.Background(), db.Handle(), "W1", "R1", 1500, 360.0)
	if err != nil {
		t.Fatal(err)
	}
	if res != nil {
		t.Fatalf("expected nil for early-quit race, got %+v", res)
	}
}

// TestSamplesFromSummaryJSON_TimeBaseNormalisation verifies that a ghost
// source session with a warmup offset (t_sec starting at 60) produces the
// same gap as the same source without warmup (t_sec starting at 0).
// Before the fix, the warmup duration was subtracted from the user's
// apparent advantage, flattering the user by the opponent's warmup (2026-06-10).
func TestSamplesFromSummaryJSON_TimeBaseNormalisation(t *testing.T) {
	// Construct two summary JSON blobs: one with t_sec starting at 0 (no
	// warmup), one with t_sec starting at 60 (60-second warmup). Both
	// represent the same actual rowing performance — constant 120 s/500m
	// split, 2000 m in 480 s of work.
	makeSummary := func(origin float64) string {
		// 4 buckets of 500 m, 120 s each.
		tSec := []float64{origin + 120, origin + 240, origin + 360, origin + 480}
		split := []float64{120, 120, 120, 120}
		type samples struct {
			TSec  []float64 `json:"t_sec"`
			Split []float64 `json:"split"`
		}
		type payload struct {
			Samples samples `json:"samples"`
		}
		b, _ := json.Marshal(payload{Samples: samples{TSec: tSec, Split: split}})
		return string(b)
	}

	summaryNoWarmup := makeSummary(0)
	summaryWithWarmup := makeSummary(60)

	tNoWarmup, spNoWarmup, ok := samplesFromSummaryJSON(summaryNoWarmup)
	if !ok {
		t.Fatal("samplesFromSummaryJSON: no-warmup parse failed")
	}
	tWithWarmup, spWithWarmup, ok := samplesFromSummaryJSON(summaryWithWarmup)
	if !ok {
		t.Fatal("samplesFromSummaryJSON: with-warmup parse failed")
	}

	// Both normalised curves should start at 0.
	if tNoWarmup[0] != 0 {
		t.Errorf("no-warmup t[0] = %v, want 0", tNoWarmup[0])
	}
	if tWithWarmup[0] != 0 {
		t.Errorf("with-warmup t[0] after normalisation = %v, want 0", tWithWarmup[0])
	}

	// User: same 2000m in 480s. Gap should be identical (≈0) for both curves.
	userDist := 2000.0
	userTime := 480.0
	gapNoWarmup := gapAtDistance(tNoWarmup, spNoWarmup, userDist, userTime)
	gapWithWarmup := gapAtDistance(tWithWarmup, spWithWarmup, userDist, userTime)

	const tol = 0.01
	if diff := gapNoWarmup - gapWithWarmup; diff > tol || diff < -tol {
		t.Errorf("warmup should not affect gap: no-warmup=%v with-warmup=%v diff=%v",
			gapNoWarmup, gapWithWarmup, diff)
	}
}

func TestComputeRaceResult_NoWorkoutIDReturnsNil(t *testing.T) {
	db, err := Open(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	res, err := ComputeRaceResult(context.Background(), db.Handle(), "", "R1", 0, 0)
	if err != nil {
		t.Fatal(err)
	}
	if res != nil {
		t.Fatalf("expected nil for empty workoutID, got %+v", res)
	}
}
