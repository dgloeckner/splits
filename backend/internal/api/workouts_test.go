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

	mux := http.NewServeMux()
	workouts := WorkoutsHandler(repo)
	mux.Handle("POST /api/v1/workouts", workouts)
	mux.Handle("GET /api/v1/workouts/{id}", workouts)
	mux.Handle("GET /api/v1/workouts/last", workouts)

	favs := FavoritesHandler(repo)
	mux.Handle("POST /api/v1/favorites", favs)
	mux.Handle("GET /api/v1/favorites", favs)
	mux.Handle("DELETE /api/v1/favorites/{id}", favs)

	srv := httptest.NewServer(mux)
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

func TestGetLastWorkout(t *testing.T) {
	srv, repo := newWorkoutTestServer(t)
	dbh := repo.DB()
	rowerID := "r1"
	if _, err := dbh.Exec(
		`INSERT INTO rowers(id, name, color, created_at) VALUES(?, 'A', '#fff', datetime('now'))`,
		rowerID,
	); err != nil {
		t.Fatal(err)
	}
	w, err := repo.CreateWorkout(context.Background(), workout.CreateWorkoutInput{
		Mode:       workout.ModeTime,
		ParamsJSON: json.RawMessage(`{"seconds":600}`),
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := dbh.Exec(
		`INSERT INTO sessions(id, rower_id, started_at, initial_level, workout_id) VALUES('s1', ?, datetime('now'), 1, ?)`,
		rowerID, w.ID,
	); err != nil {
		t.Fatal(err)
	}

	resp, err := http.Get(srv.URL + "/api/v1/workouts/last?rower_id=" + rowerID)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status=%d", resp.StatusCode)
	}
	var got workout.Workout
	if err := json.NewDecoder(resp.Body).Decode(&got); err != nil {
		t.Fatal(err)
	}
	if got.ID != w.ID {
		t.Fatalf("unexpected: %+v", got)
	}
}

func TestGetLastWorkoutRequiresRowerID(t *testing.T) {
	srv, _ := newWorkoutTestServer(t)
	resp, err := http.Get(srv.URL + "/api/v1/workouts/last")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("status=%d", resp.StatusCode)
	}
}

func TestGetLastWorkoutNotFound(t *testing.T) {
	srv, _ := newWorkoutTestServer(t)
	resp, err := http.Get(srv.URL + "/api/v1/workouts/last?rower_id=none")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusNotFound {
		t.Fatalf("status=%d", resp.StatusCode)
	}
}

func TestFavoritesHTTP(t *testing.T) {
	srv, repo := newWorkoutTestServer(t)
	dbh := repo.DB()
	rowerID := "r2"
	if _, err := dbh.Exec(
		`INSERT INTO rowers(id, name, color, created_at) VALUES(?, 'B', '#fff', datetime('now'))`,
		rowerID,
	); err != nil {
		t.Fatal(err)
	}

	body := `{"rower_id":"r2","name":"Fav1","mode":"distance","params":{"meters":2000},"intensity":"hart"}`
	resp, err := http.Post(srv.URL+"/api/v1/favorites", "application/json", bytes.NewBufferString(body))
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("create status=%d", resp.StatusCode)
	}
	var created workout.Favorite
	_ = json.NewDecoder(resp.Body).Decode(&created)
	resp.Body.Close()

	resp, err = http.Get(srv.URL + "/api/v1/favorites?rower_id=r2")
	if err != nil {
		t.Fatal(err)
	}
	var list struct {
		Favorites []workout.Favorite `json:"favorites"`
	}
	_ = json.NewDecoder(resp.Body).Decode(&list)
	resp.Body.Close()
	if len(list.Favorites) != 1 {
		t.Fatalf("expected 1 got %d", len(list.Favorites))
	}

	req, _ := http.NewRequest("DELETE", srv.URL+"/api/v1/favorites/"+created.ID, nil)
	resp, err = http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != http.StatusNoContent {
		t.Fatalf("delete status=%d", resp.StatusCode)
	}
}

func TestFavoritesGetRequiresRowerID(t *testing.T) {
	srv, _ := newWorkoutTestServer(t)
	resp, err := http.Get(srv.URL + "/api/v1/favorites")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("status=%d", resp.StatusCode)
	}
}

func TestCreateFavoriteRequiresName(t *testing.T) {
	srv, repo := newWorkoutTestServer(t)
	dbh := repo.DB()
	if _, err := dbh.Exec(`INSERT INTO rowers(id, name, color, created_at) VALUES('r3', 'C', '#fff', datetime('now'))`); err != nil {
		t.Fatal(err)
	}
	body := `{"rower_id":"r3","name":"","mode":"distance","params":{"meters":2000}}`
	resp, err := http.Post(srv.URL+"/api/v1/favorites", "application/json", bytes.NewBufferString(body))
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("status=%d", resp.StatusCode)
	}
}
