package api_test

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"
	"time"

	"github.com/gloeckner-daniel/splits/internal/api"
	"github.com/gloeckner-daniel/splits/internal/storage"
)

func raceOpponentsSeed(t *testing.T) (db *storage.DB, rowerID, workoutID, shapeHash string) {
	t.Helper()
	db, err := storage.Open(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	rowerID = "R1"
	workoutID = "W1"
	shapeHash = "shape2k"
	now := time.Now().UTC().Format(time.RFC3339Nano)
	if _, err := db.Handle().Exec(
		`INSERT INTO rowers(id, name, color, created_at) VALUES(?,?,?,?)`,
		rowerID, "Alice", "#0f0", now); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Handle().Exec(
		`INSERT INTO workout(id, mode, params_json, intensity, warmup_sec, cooldown_sec, created_at, shape_hash)
         VALUES(?,'race','{"meters":2000}','moderat',0,0,?,?)`,
		workoutID, now, shapeHash); err != nil {
		t.Fatal(err)
	}
	return db, rowerID, workoutID, shapeHash
}

func TestWorkoutOpponents_SynthGhostWhenNoPriorSession(t *testing.T) {
	db, rowerID, workoutID, _ := raceOpponentsSeed(t)
	h := api.WorkoutOpponentsHandler(db.Handle())
	req := httptest.NewRequest("GET",
		fmt.Sprintf("/api/v1/workouts/%s/opponents?rower_id=%s", workoutID, rowerID), nil)
	req.SetPathValue("id", workoutID)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d body %s", rec.Code, rec.Body.String())
	}
	var got struct {
		Ghost *struct {
			Kind  string    `json:"kind"`
			TSec  []float64 `json:"t_sec"`
			Split []float64 `json:"split"`
		} `json:"ghost"`
		PB *json.RawMessage `json:"pb"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if got.Ghost == nil {
		t.Fatal("expected synth ghost")
	}
	if got.Ghost.Kind != "synth" {
		t.Fatalf("kind=%q want synth", got.Ghost.Kind)
	}
	if len(got.Ghost.TSec) < 5 {
		t.Fatalf("samples too short: %d", len(got.Ghost.TSec))
	}
	if got.PB != nil && string(*got.PB) != "null" {
		t.Fatalf("pb should be null, got %s", string(*got.PB))
	}
}
