package api_test

import (
	"database/sql"
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

func seedRaceSession(t *testing.T, db *storage.DB, sessionID, rowerID, workoutID, startedAt, samples string, deleted, ended bool) {
	t.Helper()
	var endedAt sql.NullString
	if ended {
		endedAt.String = startedAt
		endedAt.Valid = true
	}
	var deletedAt sql.NullString
	if deleted {
		deletedAt.String = startedAt
		deletedAt.Valid = true
	}
	summary := `{"samples":{"t_sec":` + samples + `,"split":[120,120,120]}}`
	if samples == "" {
		summary = `{"samples":{"t_sec":[0,5,10],"split":[120,120,120]}}`
	}
	if _, err := db.Handle().Exec(`
        INSERT INTO sessions(id, rower_id, started_at, ended_at, deleted_at, workout_id,
            initial_level, total_distance_m, total_time_sec, total_strokes, summary_json)
        VALUES(?,?,?,?,?,?,3,0,0,0,?)`,
		sessionID, rowerID, startedAt, endedAt, deletedAt, workoutID, summary); err != nil {
		t.Fatal(err)
	}
}

func TestWorkoutOpponents_RealGhostFromMatchingSession(t *testing.T) {
	db, rowerID, workoutID, _ := raceOpponentsSeed(t)
	seedRaceSession(t, db, "S_OLD", rowerID, workoutID, "2026-04-01T10:00:00Z", "[0,5,10]", false, true)

	h := api.WorkoutOpponentsHandler(db.Handle())
	req := httptest.NewRequest("GET",
		fmt.Sprintf("/api/v1/workouts/%s/opponents?rower_id=%s", workoutID, rowerID), nil)
	req.SetPathValue("id", workoutID)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d body %s", rec.Code, rec.Body.String())
	}
	var got api.WorkoutOpponentsResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if got.Ghost == nil || got.Ghost.Kind != "session" || got.Ghost.SourceSessionID != "S_OLD" {
		t.Fatalf("ghost=%+v", got.Ghost)
	}
}

func TestWorkoutOpponents_PBFromWorkoutShape(t *testing.T) {
	db, rowerID, workoutID, shape := raceOpponentsSeed(t)
	seedRaceSession(t, db, "S_PB", rowerID, workoutID, "2026-03-01T10:00:00Z", "", false, true)
	if _, err := db.Handle().Exec(`
        INSERT INTO pb_workout(rower_id, shape_hash, mode, params_json, value_kind, value,
            source_session_id, source_session_started_at, achieved_at)
        VALUES(?,?,?,?,?,?,?,?,?)`,
		rowerID, shape, "race", `{"meters":2000}`, "time_sec", 400.0,
		"S_PB", "2026-03-01T10:00:00Z", "2026-03-01T10:30:00Z"); err != nil {
		t.Fatal(err)
	}

	h := api.WorkoutOpponentsHandler(db.Handle())
	req := httptest.NewRequest("GET",
		fmt.Sprintf("/api/v1/workouts/%s/opponents?rower_id=%s", workoutID, rowerID), nil)
	req.SetPathValue("id", workoutID)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	var got api.WorkoutOpponentsResponse
	_ = json.Unmarshal(rec.Body.Bytes(), &got)
	if got.PB == nil || got.PB.SourceSessionID != "S_PB" {
		t.Fatalf("pb=%+v", got.PB)
	}
}

func TestWorkoutOpponents_RejectsNonRaceWorkout(t *testing.T) {
	db, _, _, _ := raceOpponentsSeed(t)
	if _, err := db.Handle().Exec(`
        INSERT INTO workout(id, mode, params_json, intensity, warmup_sec, cooldown_sec, created_at, shape_hash)
        VALUES('W_DIST','distance','{"meters":2000}','moderat',0,0,?,'shape2k')`,
		time.Now().UTC().Format(time.RFC3339Nano)); err != nil {
		t.Fatal(err)
	}
	h := api.WorkoutOpponentsHandler(db.Handle())
	req := httptest.NewRequest("GET", "/api/v1/workouts/W_DIST/opponents?rower_id=R1", nil)
	req.SetPathValue("id", "W_DIST")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status=%d body=%s", rec.Code, rec.Body.String())
	}
}

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
