package api

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"

	"github.com/gloeckner-daniel/home-ergo/internal/storage"
	"github.com/gloeckner-daniel/home-ergo/internal/workout"
)

func newWorkoutTestServer(t *testing.T) (*httptest.Server, *workout.Repo) {
	t.Helper()
	db, err := storage.Open(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	repo := workout.NewRepo(db.Handle())
	srv := httptest.NewServer(WorkoutsHandler(repo))
	t.Cleanup(srv.Close)
	return srv, repo
}

func TestPostWorkoutValid(t *testing.T) {
	srv, _ := newWorkoutTestServer(t)
	body := `{"mode":"distance","params":{"meters":5000},"intensity":"moderat","warmup_sec":300}`
	resp, err := http.Post(srv.URL+"/api/v1/workouts", "application/json", bytes.NewBufferString(body))
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("status=%d", resp.StatusCode)
	}
	var out workout.Workout
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		t.Fatal(err)
	}
	if out.ID == "" || out.Mode != workout.ModeDistance {
		t.Fatalf("unexpected: %+v", out)
	}
}

func TestPostWorkoutInvalid(t *testing.T) {
	srv, _ := newWorkoutTestServer(t)
	body := `{"mode":"distance","params":{"meters":-1}}`
	resp, err := http.Post(srv.URL+"/api/v1/workouts", "application/json", bytes.NewBufferString(body))
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("status=%d", resp.StatusCode)
	}
}

func TestGetWorkoutByID(t *testing.T) {
	srv, repo := newWorkoutTestServer(t)
	ctx := context.Background()
	w, err := repo.CreateWorkout(ctx, workout.CreateWorkoutInput{
		Mode:       workout.ModeTime,
		ParamsJSON: json.RawMessage(`{"seconds":600}`),
	})
	if err != nil {
		t.Fatal(err)
	}
	resp, err := http.Get(srv.URL + "/api/v1/workouts/" + w.ID)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status=%d", resp.StatusCode)
	}
}

func TestGetWorkoutNotFound(t *testing.T) {
	srv, _ := newWorkoutTestServer(t)
	resp, err := http.Get(srv.URL + "/api/v1/workouts/nope")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusNotFound {
		t.Fatalf("status=%d", resp.StatusCode)
	}
}
