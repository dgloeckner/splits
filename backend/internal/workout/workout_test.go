package workout

import (
	"context"
	"encoding/json"
	"path/filepath"
	"testing"

	"github.com/gloeckner-daniel/home-ergo/internal/storage"
)

func newTestRepo(t *testing.T) (*Repo, *storage.DB) {
	t.Helper()
	db, err := storage.Open(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	return NewRepo(db.Handle()), db
}

func TestCreateAndGetWorkout(t *testing.T) {
	repo, _ := newTestRepo(t)
	ctx := context.Background()

	in := CreateWorkoutInput{
		Mode:        ModeDistance,
		ParamsJSON:  json.RawMessage(`{"meters":5000}`),
		Intensity:   IntensityModerat,
		WarmupSec:   300,
		CooldownSec: 300,
	}
	out, err := repo.CreateWorkout(ctx, in)
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if out.ID == "" {
		t.Fatal("expected ULID/UUID")
	}

	got, err := repo.GetWorkout(ctx, out.ID)
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if got.Mode != ModeDistance || got.WarmupSec != 300 {
		t.Fatalf("unexpected workout: %+v", got)
	}
}

func TestCreateWorkoutValidatesParams(t *testing.T) {
	repo, _ := newTestRepo(t)
	_, err := repo.CreateWorkout(context.Background(), CreateWorkoutInput{
		Mode:       ModeDistance,
		ParamsJSON: json.RawMessage(`{"meters":-1}`),
	})
	if err == nil {
		t.Fatal("expected validation error")
	}
}

func TestGetWorkoutNotFound(t *testing.T) {
	repo, _ := newTestRepo(t)
	got, err := repo.GetWorkout(context.Background(), "does-not-exist")
	if err != nil {
		t.Fatalf("err: %v", err)
	}
	if got != nil {
		t.Fatalf("expected nil, got %+v", got)
	}
}
