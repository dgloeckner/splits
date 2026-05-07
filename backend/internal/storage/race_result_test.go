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
