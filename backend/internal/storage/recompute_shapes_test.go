package storage_test

import (
	"context"
	"database/sql"
	"path/filepath"
	"testing"
	"time"

	"github.com/gloeckner-daniel/splits/internal/storage"
	"github.com/gloeckner-daniel/splits/internal/workout"
)

func TestRecomputeShapes_PopulatesNullHashes(t *testing.T) {
	db, err := storage.Open(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)

	// Seed two workouts with null shape_hash (mimicking the post-migration state).
	// They have identical params but different warmup/cooldown — must hash equal
	// under the new (params-only) ShapeHash.
	if _, err := db.Handle().Exec(
		`INSERT INTO workout(id, mode, params_json, intensity, warmup_sec, cooldown_sec, created_at, shape_hash)
		 VALUES('w1', 'distance', '{"meters":5000}', 'moderat', 60, 120, ?, NULL),
		       ('w2', 'distance', '{"meters":5000}', 'hart',    0,  0,   ?, NULL)`,
		now, now); err != nil {
		t.Fatal(err)
	}

	if err := storage.RecomputeShapes(context.Background(), db.Handle(), workout.ShapeHash); err != nil {
		t.Fatal(err)
	}

	var h1, h2 sql.NullString
	if err := db.Handle().QueryRow(`SELECT shape_hash FROM workout WHERE id='w1'`).Scan(&h1); err != nil {
		t.Fatal(err)
	}
	if err := db.Handle().QueryRow(`SELECT shape_hash FROM workout WHERE id='w2'`).Scan(&h2); err != nil {
		t.Fatal(err)
	}
	if !h1.Valid || h1.String == "" {
		t.Fatal("w1.shape_hash still null")
	}
	if !h2.Valid || h2.String == "" {
		t.Fatal("w2.shape_hash still null")
	}
	if h1.String != h2.String {
		t.Fatalf("expected w1 and w2 to share hash (same params), got %q vs %q", h1.String, h2.String)
	}

	// Confirm the hash matches workout.ShapeHash directly.
	wantH, err := workout.ShapeHash([]byte(`{"meters":5000}`))
	if err != nil {
		t.Fatal(err)
	}
	if h1.String != wantH {
		t.Fatalf("w1.shape_hash = %q, want %q (workout.ShapeHash output)", h1.String, wantH)
	}
}

func TestRecomputeShapes_Idempotent(t *testing.T) {
	db, err := storage.Open(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	if _, err := db.Handle().Exec(
		`INSERT INTO workout(id, mode, params_json, intensity, warmup_sec, cooldown_sec, created_at, shape_hash)
		 VALUES('w1', 'distance', '{"meters":5000}', 'moderat', 60, 120, ?, NULL)`, now); err != nil {
		t.Fatal(err)
	}

	if err := storage.RecomputeShapes(context.Background(), db.Handle(), workout.ShapeHash); err != nil {
		t.Fatal(err)
	}
	var hAfterFirst string
	if err := db.Handle().QueryRow(`SELECT shape_hash FROM workout WHERE id='w1'`).Scan(&hAfterFirst); err != nil {
		t.Fatal(err)
	}

	// Re-run: must be a no-op (no NULL rows left).
	if err := storage.RecomputeShapes(context.Background(), db.Handle(), workout.ShapeHash); err != nil {
		t.Fatal(err)
	}
	var hAfterSecond string
	if err := db.Handle().QueryRow(`SELECT shape_hash FROM workout WHERE id='w1'`).Scan(&hAfterSecond); err != nil {
		t.Fatal(err)
	}
	if hAfterFirst != hAfterSecond {
		t.Fatalf("hash drifted between runs: %q → %q", hAfterFirst, hAfterSecond)
	}
}
