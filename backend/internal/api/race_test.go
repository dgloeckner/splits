package api_test

import (
	"encoding/json"
	"net/http/httptest"
	"path/filepath"
	"testing"
	"time"

	"github.com/gloeckner-daniel/splits/internal/api"
	"github.com/gloeckner-daniel/splits/internal/storage"
)

func TestRaceOpponents_NoEligibleSessions(t *testing.T) {
	t.Parallel()
	db, err := storage.Open(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	now := time.Now().UTC().Format(time.RFC3339Nano)
	if _, err := db.Handle().Exec(
		`INSERT INTO rowers(id, name, color, created_at) VALUES('R1','D','#0f0',?)`,
		now); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Handle().Exec(
		`INSERT INTO workout(id, mode, params_json, intensity, warmup_sec, cooldown_sec, created_at, shape_hash)
		 VALUES('W1','distance','{"meters":2000}','allout',0,0,?, 'h1')`,
		now); err != nil {
		t.Fatal(err)
	}

	h := api.RaceOpponentsHandler(db.Handle())
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest("GET", "/api/v1/race/opponents?workout_id=W1&rower_id=R1", nil))
	if rec.Code != 200 {
		t.Fatalf("status: %d body=%s", rec.Code, rec.Body.String())
	}

	var resp struct {
		Ghost json.RawMessage `json:"ghost"`
		PB    json.RawMessage `json:"pb"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("unmarshal: %v body=%s", err, rec.Body.String())
	}
	if string(resp.Ghost) != "null" {
		t.Errorf("ghost = %s, want null", resp.Ghost)
	}
	if string(resp.PB) != "null" {
		t.Errorf("pb = %s, want null", resp.PB)
	}
}

func TestRaceOpponents_GhostFromLastMatchingSession(t *testing.T) {
	t.Parallel()
	db, err := storage.Open(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	now := time.Now().UTC().Format(time.RFC3339Nano)
	if _, err := db.Handle().Exec(
		`INSERT INTO rowers(id, name, color, created_at) VALUES('R1','D','#0f0',?)`,
		now); err != nil {
		t.Fatal(err)
	}
	// Current workout (W1) and an older sibling workout (W_OLD) sharing shape_hash.
	if _, err := db.Handle().Exec(
		`INSERT INTO workout(id, mode, params_json, intensity, warmup_sec, cooldown_sec, created_at, shape_hash)
		 VALUES('W1','distance','{"meters":2000}','allout',0,0,?, 'shapeA')`,
		now); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Handle().Exec(
		`INSERT INTO workout(id, mode, params_json, intensity, warmup_sec, cooldown_sec, created_at, shape_hash)
		 VALUES('W_OLD','distance','{"meters":2000}','moderat',0,0,?, 'shapeA')`,
		now); err != nil {
		t.Fatal(err)
	}
	// A different-shape workout (newer session uses this; must NOT be picked).
	if _, err := db.Handle().Exec(
		`INSERT INTO workout(id, mode, params_json, intensity, warmup_sec, cooldown_sec, created_at, shape_hash)
		 VALUES('W_DIFF','distance','{"meters":5000}','allout',0,0,?, 'shapeB')`,
		now); err != nil {
		t.Fatal(err)
	}

	// Older matching-shape session.
	tOld := time.Date(2026, 4, 1, 8, 0, 0, 0, time.UTC)
	if _, err := db.Handle().Exec(`INSERT INTO sessions(id, rower_id, started_at, ended_at, workout_id,
		summary_json, initial_level, total_distance_m, total_time_sec, total_strokes)
		VALUES('S_OLD','R1',?,?,'W_OLD',?,3,2000,480,200)`,
		tOld.Format(time.RFC3339Nano), tOld.Add(time.Minute*8).Format(time.RFC3339Nano),
		`{"samples":{"t_sec":[0,5,10],"split":[120,118,116]}}`); err != nil {
		t.Fatal(err)
	}
	// Newer different-shape session — must be ignored.
	tNew := time.Date(2026, 5, 1, 8, 0, 0, 0, time.UTC)
	if _, err := db.Handle().Exec(`INSERT INTO sessions(id, rower_id, started_at, ended_at, workout_id,
		summary_json, initial_level, total_distance_m, total_time_sec, total_strokes)
		VALUES('S_NEW','R1',?,?,'W_DIFF',?,3,5000,1500,500)`,
		tNew.Format(time.RFC3339Nano), tNew.Add(time.Minute*25).Format(time.RFC3339Nano),
		`{"samples":{"t_sec":[0,5,10],"split":[130,130,130]}}`); err != nil {
		t.Fatal(err)
	}

	h := api.RaceOpponentsHandler(db.Handle())
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest("GET", "/api/v1/race/opponents?workout_id=W1&rower_id=R1", nil))
	if rec.Code != 200 {
		t.Fatalf("status: %d body=%s", rec.Code, rec.Body.String())
	}

	var resp struct {
		Ghost *api.RaceOpponent `json:"ghost"`
		PB    *api.RaceOpponent `json:"pb"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("unmarshal: %v body=%s", err, rec.Body.String())
	}
	if resp.Ghost == nil {
		t.Fatalf("ghost = nil, want session S_OLD")
	}
	if resp.Ghost.SourceSessionID != "S_OLD" {
		t.Errorf("ghost.SourceSessionID = %s, want S_OLD", resp.Ghost.SourceSessionID)
	}
	if resp.Ghost.Label != "ghost" {
		t.Errorf("ghost.Label = %q, want %q", resp.Ghost.Label, "ghost")
	}
	if len(resp.Ghost.TSec) != 3 || resp.Ghost.TSec[2] != 10 {
		t.Errorf("ghost.TSec = %v", resp.Ghost.TSec)
	}
	if len(resp.Ghost.Split) != 3 || resp.Ghost.Split[0] != 120 {
		t.Errorf("ghost.Split = %v", resp.Ghost.Split)
	}
	if resp.PB != nil {
		t.Errorf("pb = %+v, want nil", resp.PB)
	}
}

func TestRaceOpponents_GhostExcludesDeletedAndIncomplete(t *testing.T) {
	t.Parallel()
	db, err := storage.Open(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	now := time.Now().UTC().Format(time.RFC3339Nano)
	if _, err := db.Handle().Exec(
		`INSERT INTO rowers(id, name, color, created_at) VALUES('R1','D','#0f0',?)`,
		now); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Handle().Exec(
		`INSERT INTO workout(id, mode, params_json, intensity, warmup_sec, cooldown_sec, created_at, shape_hash)
		 VALUES('W1','distance','{"meters":2000}','allout',0,0,?, 'shapeA')`,
		now); err != nil {
		t.Fatal(err)
	}

	// Newest: in-progress (ended_at NULL) — should not be picked.
	tInProgress := time.Date(2026, 5, 3, 8, 0, 0, 0, time.UTC)
	if _, err := db.Handle().Exec(`INSERT INTO sessions(id, rower_id, started_at, ended_at, workout_id, summary_json, initial_level)
		VALUES('S_INPROG','R1',?,NULL,'W1',?,3)`,
		tInProgress.Format(time.RFC3339Nano),
		`{"samples":{"t_sec":[0],"split":[100]}}`); err != nil {
		t.Fatal(err)
	}
	// Soft-deleted — should not be picked.
	tDel := time.Date(2026, 5, 2, 8, 0, 0, 0, time.UTC)
	if _, err := db.Handle().Exec(`INSERT INTO sessions(id, rower_id, started_at, ended_at, workout_id, summary_json, initial_level, deleted_at)
		VALUES('S_DEL','R1',?,?,'W1',?,3,?)`,
		tDel.Format(time.RFC3339Nano), tDel.Add(time.Minute*8).Format(time.RFC3339Nano),
		`{"samples":{"t_sec":[0],"split":[200]}}`,
		tDel.Add(time.Hour).Format(time.RFC3339Nano)); err != nil {
		t.Fatal(err)
	}
	// Normal completed — must be picked.
	tOK := time.Date(2026, 5, 1, 8, 0, 0, 0, time.UTC)
	if _, err := db.Handle().Exec(`INSERT INTO sessions(id, rower_id, started_at, ended_at, workout_id, summary_json, initial_level)
		VALUES('S_OK','R1',?,?,'W1',?,3)`,
		tOK.Format(time.RFC3339Nano), tOK.Add(time.Minute*8).Format(time.RFC3339Nano),
		`{"samples":{"t_sec":[0,5,10],"split":[120,118,116]}}`); err != nil {
		t.Fatal(err)
	}

	h := api.RaceOpponentsHandler(db.Handle())
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest("GET", "/api/v1/race/opponents?workout_id=W1&rower_id=R1", nil))
	if rec.Code != 200 {
		t.Fatalf("status: %d body=%s", rec.Code, rec.Body.String())
	}
	var resp struct {
		Ghost *api.RaceOpponent `json:"ghost"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if resp.Ghost == nil {
		t.Fatalf("ghost = nil, want S_OK")
	}
	if resp.Ghost.SourceSessionID != "S_OK" {
		t.Errorf("ghost.SourceSessionID = %s, want S_OK", resp.Ghost.SourceSessionID)
	}
}

func TestRaceOpponents_MissingParamsReturns400(t *testing.T) {
	t.Parallel()
	db, err := storage.Open(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	h := api.RaceOpponentsHandler(db.Handle())
	for _, path := range []string{
		"/api/v1/race/opponents",
		"/api/v1/race/opponents?workout_id=W1",
		"/api/v1/race/opponents?rower_id=R1",
	} {
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, httptest.NewRequest("GET", path, nil))
		if rec.Code != 400 {
			t.Errorf("%s: want 400, got %d", path, rec.Code)
		}
	}
}
