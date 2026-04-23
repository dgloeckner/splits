package workout

import (
	"context"
	"database/sql"
	"encoding/json"
	"path/filepath"
	"testing"
	"time"

	"github.com/gloeckner-daniel/home-ergo/internal/storage"
	"github.com/google/uuid"
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

func TestFavoritesCRUD(t *testing.T) {
	repo, db := newTestRepo(t)
	ctx := context.Background()
	rowerID := seedRower(t, db.Handle(), "Alice")

	created, err := repo.CreateFavorite(ctx, CreateFavoriteInput{
		RowerID:    rowerID,
		Name:       "My 5k",
		Mode:       ModeDistance,
		ParamsJSON: json.RawMessage(`{"meters":5000}`),
		Intensity:  IntensityModerat,
		WarmupSec:  300,
	})
	if err != nil {
		t.Fatalf("create favorite: %v", err)
	}
	if created.Name != "My 5k" {
		t.Fatalf("bad name: %q", created.Name)
	}

	list, err := repo.ListFavorites(ctx, rowerID)
	if err != nil {
		t.Fatal(err)
	}
	if len(list) != 1 {
		t.Fatalf("expected 1, got %d", len(list))
	}

	if err := repo.DeleteFavorite(ctx, created.ID); err != nil {
		t.Fatal(err)
	}
	list, _ = repo.ListFavorites(ctx, rowerID)
	if len(list) != 0 {
		t.Fatalf("expected 0 after delete, got %d", len(list))
	}
}

func TestCreateFavoriteRequiresName(t *testing.T) {
	repo, db := newTestRepo(t)
	rowerID := seedRower(t, db.Handle(), "Bob")
	_, err := repo.CreateFavorite(context.Background(), CreateFavoriteInput{
		RowerID:    rowerID,
		Name:       "",
		Mode:       ModeTime,
		ParamsJSON: json.RawMessage(`{"seconds":600}`),
	})
	if err == nil {
		t.Fatal("expected ErrNameRequired")
	}
}

func seedRower(t *testing.T, db *sql.DB, name string) string {
	t.Helper()
	id := uuid.NewString()
	_, err := db.Exec(
		`INSERT INTO rowers(id, name, color, created_at) VALUES(?, ?, '#fff', ?)`,
		id, name, time.Now().UTC().Format(time.RFC3339Nano),
	)
	if err != nil {
		t.Fatal(err)
	}
	return id
}

func TestLastWorkoutForRower(t *testing.T) {
	repo, db := newTestRepo(t)
	ctx := context.Background()
	rowerID := seedRower(t, db.Handle(), "Carla")

	// No workout yet → nil.
	got, err := repo.LastWorkoutForRower(ctx, rowerID)
	if err != nil || got != nil {
		t.Fatalf("expected nil, got %v err=%v", got, err)
	}

	// Create workout + fake session linking.
	w, _ := repo.CreateWorkout(ctx, CreateWorkoutInput{
		Mode:       ModeTime,
		ParamsJSON: json.RawMessage(`{"seconds":1200}`),
	})
	seedSessionWithWorkout(t, db.Handle(), rowerID, w.ID)

	got, err = repo.LastWorkoutForRower(ctx, rowerID)
	if err != nil {
		t.Fatalf("err: %v", err)
	}
	if got == nil || got.ID != w.ID {
		t.Fatalf("unexpected: %+v", got)
	}
}

func seedSessionWithWorkout(t *testing.T, db *sql.DB, rowerID, workoutID string) {
	t.Helper()
	_, err := db.Exec(
		`INSERT INTO sessions(id, rower_id, started_at, initial_level, workout_id)
         VALUES(?, ?, ?, 1, ?)`,
		uuid.NewString(), rowerID, time.Now().UTC().Format(time.RFC3339Nano), workoutID,
	)
	if err != nil {
		t.Fatal(err)
	}
}

func TestCleanupOrphans(t *testing.T) {
	repo, db := newTestRepo(t)
	ctx := context.Background()

	// Orphan workout (no session references).
	orphan, err := repo.CreateWorkout(ctx, CreateWorkoutInput{
		Mode: ModeTime, ParamsJSON: json.RawMessage(`{"seconds":60}`),
	})
	if err != nil {
		t.Fatal(err)
	}

	// Referenced workout.
	rowerID := seedRower(t, db.Handle(), "X")
	referenced, err := repo.CreateWorkout(ctx, CreateWorkoutInput{
		Mode: ModeTime, ParamsJSON: json.RawMessage(`{"seconds":120}`),
	})
	if err != nil {
		t.Fatal(err)
	}
	seedSessionWithWorkout(t, db.Handle(), rowerID, referenced.ID)

	n, err := repo.CleanupOrphans(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if n != 1 {
		t.Fatalf("expected 1 deleted, got %d", n)
	}
	if got, _ := repo.GetWorkout(ctx, orphan.ID); got != nil {
		t.Fatal("orphan survived")
	}
	if got, _ := repo.GetWorkout(ctx, referenced.ID); got == nil {
		t.Fatal("referenced workout wrongly deleted")
	}
}
