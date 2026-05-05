package api_test

import (
	"database/sql"
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

// --- T3: PB resolution -------------------------------------------------

// mustExec executes a SQL statement and fails the test on error. Cuts
// the boilerplate out of the dense seeding blocks below.
func mustExec(t *testing.T, db interface {
	Exec(query string, args ...any) (sql.Result, error)
}, q string, args ...any) {
	t.Helper()
	if _, err := db.Exec(q, args...); err != nil {
		t.Fatal(err)
	}
}

func TestRaceOpponents_PBFromWorkoutShape(t *testing.T) {
	t.Parallel()
	db, err := storage.Open(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	now := time.Now().UTC().Format(time.RFC3339Nano)
	mustExec(t, db.Handle(),
		`INSERT INTO rowers(id, name, color, created_at) VALUES('R1','D','#0f0',?)`, now)
	mustExec(t, db.Handle(),
		`INSERT INTO workout(id, mode, params_json, intensity, warmup_sec, cooldown_sec, created_at, shape_hash)
		 VALUES('W1','distance','{"meters":2000}','allout',0,0,?, 'shapeA')`, now)

	tPB := time.Date(2026, 3, 1, 10, 0, 0, 0, time.UTC)
	mustExec(t, db.Handle(),
		`INSERT INTO sessions(id, rower_id, started_at, ended_at, workout_id, summary_json, initial_level)
		 VALUES('S_PB','R1',?,?,'W1',?,3)`,
		tPB.Format(time.RFC3339Nano), tPB.Add(time.Minute*7).Format(time.RFC3339Nano),
		`{"samples":{"t_sec":[0,5,10],"split":[110,108,106]}}`)

	mustExec(t, db.Handle(),
		`INSERT INTO pb_workout(rower_id, shape_hash, mode, params_json, value_kind, value,
		    source_session_id, source_session_started_at, achieved_at)
		 VALUES('R1','shapeA','distance','{"meters":2000}','time_sec',400,'S_PB',?,?)`,
		tPB.Format(time.RFC3339Nano), tPB.Format(time.RFC3339Nano))

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
	if resp.PB == nil {
		t.Fatalf("pb = nil, want S_PB")
	}
	if resp.PB.SourceSessionID != "S_PB" {
		t.Errorf("pb.SourceSessionID = %s, want S_PB", resp.PB.SourceSessionID)
	}
	if resp.PB.Label != "pb" {
		t.Errorf("pb.Label = %q, want %q", resp.PB.Label, "pb")
	}
	if len(resp.PB.TSec) != 3 || resp.PB.TSec[2] != 10 {
		t.Errorf("pb.TSec = %v", resp.PB.TSec)
	}
	if len(resp.PB.Split) != 3 || resp.PB.Split[0] != 110 {
		t.Errorf("pb.Split = %v", resp.PB.Split)
	}
}

func TestRaceOpponents_PBFallsBackToDistancePBWhenFaster(t *testing.T) {
	t.Parallel()
	db, err := storage.Open(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	now := time.Now().UTC().Format(time.RFC3339Nano)
	mustExec(t, db.Handle(),
		`INSERT INTO rowers(id, name, color, created_at) VALUES('R1','D','#0f0',?)`, now)
	mustExec(t, db.Handle(),
		`INSERT INTO workout(id, mode, params_json, intensity, warmup_sec, cooldown_sec, created_at, shape_hash)
		 VALUES('W1','distance','{"meters":2000}','allout',0,0,?, 'shapeA')`, now)

	tSlow := time.Date(2026, 3, 1, 10, 0, 0, 0, time.UTC)
	mustExec(t, db.Handle(),
		`INSERT INTO sessions(id, rower_id, started_at, ended_at, workout_id, summary_json, initial_level)
		 VALUES('S_SLOW','R1',?,?,'W1',?,3)`,
		tSlow.Format(time.RFC3339Nano), tSlow.Add(time.Minute*8).Format(time.RFC3339Nano),
		`{"samples":{"t_sec":[0,5,10],"split":[120,118,116]}}`)
	tFast := time.Date(2026, 4, 1, 10, 0, 0, 0, time.UTC)
	mustExec(t, db.Handle(),
		`INSERT INTO sessions(id, rower_id, started_at, ended_at, workout_id, summary_json, initial_level)
		 VALUES('S_FAST','R1',?,?,'W1',?,3)`,
		tFast.Format(time.RFC3339Nano), tFast.Add(time.Minute*7).Format(time.RFC3339Nano),
		`{"samples":{"t_sec":[0,4,8],"split":[100,99,98]}}`)

	mustExec(t, db.Handle(),
		`INSERT INTO pb_workout(rower_id, shape_hash, mode, params_json, value_kind, value,
		    source_session_id, source_session_started_at, achieved_at)
		 VALUES('R1','shapeA','distance','{"meters":2000}','time_sec',472,'S_SLOW',?,?)`,
		tSlow.Format(time.RFC3339Nano), tSlow.Format(time.RFC3339Nano))
	mustExec(t, db.Handle(),
		`INSERT INTO pb_distance(rower_id, distance_m, time_sec, source_session_id,
		    source_session_started_at, achieved_at, window_start_stroke, window_end_stroke)
		 VALUES('R1',2000,410,'S_FAST',?,?,0,200)`,
		tFast.Format(time.RFC3339Nano), tFast.Format(time.RFC3339Nano))

	h := api.RaceOpponentsHandler(db.Handle())
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest("GET", "/api/v1/race/opponents?workout_id=W1&rower_id=R1", nil))
	if rec.Code != 200 {
		t.Fatalf("status: %d body=%s", rec.Code, rec.Body.String())
	}
	var resp struct {
		PB *api.RaceOpponent `json:"pb"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if resp.PB == nil {
		t.Fatalf("pb = nil, want S_FAST")
	}
	if resp.PB.SourceSessionID != "S_FAST" {
		t.Errorf("pb.SourceSessionID = %s, want S_FAST", resp.PB.SourceSessionID)
	}
}

func TestRaceOpponents_PBPicksWorkoutPBWhenFaster(t *testing.T) {
	t.Parallel()
	db, err := storage.Open(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	now := time.Now().UTC().Format(time.RFC3339Nano)
	mustExec(t, db.Handle(),
		`INSERT INTO rowers(id, name, color, created_at) VALUES('R1','D','#0f0',?)`, now)
	mustExec(t, db.Handle(),
		`INSERT INTO workout(id, mode, params_json, intensity, warmup_sec, cooldown_sec, created_at, shape_hash)
		 VALUES('W1','distance','{"meters":2000}','allout',0,0,?, 'shapeA')`, now)

	tA := time.Date(2026, 3, 1, 10, 0, 0, 0, time.UTC)
	mustExec(t, db.Handle(),
		`INSERT INTO sessions(id, rower_id, started_at, ended_at, workout_id, summary_json, initial_level)
		 VALUES('S_WPB','R1',?,?,'W1',?,3)`,
		tA.Format(time.RFC3339Nano), tA.Add(time.Minute*7).Format(time.RFC3339Nano),
		`{"samples":{"t_sec":[0,4,8],"split":[100,99,98]}}`)
	tB := time.Date(2026, 4, 1, 10, 0, 0, 0, time.UTC)
	mustExec(t, db.Handle(),
		`INSERT INTO sessions(id, rower_id, started_at, ended_at, workout_id, summary_json, initial_level)
		 VALUES('S_DPB','R1',?,?,'W1',?,3)`,
		tB.Format(time.RFC3339Nano), tB.Add(time.Minute*7).Format(time.RFC3339Nano),
		`{"samples":{"t_sec":[0,4,8],"split":[105,104,103]}}`)

	mustExec(t, db.Handle(),
		`INSERT INTO pb_workout(rower_id, shape_hash, mode, params_json, value_kind, value,
		    source_session_id, source_session_started_at, achieved_at)
		 VALUES('R1','shapeA','distance','{"meters":2000}','time_sec',400,'S_WPB',?,?)`,
		tA.Format(time.RFC3339Nano), tA.Format(time.RFC3339Nano))
	mustExec(t, db.Handle(),
		`INSERT INTO pb_distance(rower_id, distance_m, time_sec, source_session_id,
		    source_session_started_at, achieved_at, window_start_stroke, window_end_stroke)
		 VALUES('R1',2000,420,'S_DPB',?,?,0,200)`,
		tB.Format(time.RFC3339Nano), tB.Format(time.RFC3339Nano))

	h := api.RaceOpponentsHandler(db.Handle())
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest("GET", "/api/v1/race/opponents?workout_id=W1&rower_id=R1", nil))
	if rec.Code != 200 {
		t.Fatalf("status: %d body=%s", rec.Code, rec.Body.String())
	}
	var resp struct {
		PB *api.RaceOpponent `json:"pb"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if resp.PB == nil {
		t.Fatalf("pb = nil, want S_WPB")
	}
	if resp.PB.SourceSessionID != "S_WPB" {
		t.Errorf("pb.SourceSessionID = %s, want S_WPB", resp.PB.SourceSessionID)
	}
}

func TestRaceOpponents_PBPicksWorkoutPBOnTie(t *testing.T) {
	t.Parallel()
	db, err := storage.Open(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	now := time.Now().UTC().Format(time.RFC3339Nano)
	mustExec(t, db.Handle(),
		`INSERT INTO rowers(id, name, color, created_at) VALUES('R1','D','#0f0',?)`, now)
	mustExec(t, db.Handle(),
		`INSERT INTO workout(id, mode, params_json, intensity, warmup_sec, cooldown_sec, created_at, shape_hash)
		 VALUES('W1','distance','{"meters":2000}','allout',0,0,?, 'shapeA')`, now)

	tA := time.Date(2026, 3, 1, 10, 0, 0, 0, time.UTC)
	mustExec(t, db.Handle(),
		`INSERT INTO sessions(id, rower_id, started_at, ended_at, workout_id, summary_json, initial_level)
		 VALUES('S_WPB','R1',?,?,'W1',?,3)`,
		tA.Format(time.RFC3339Nano), tA.Add(time.Minute*7).Format(time.RFC3339Nano),
		`{"samples":{"t_sec":[0,4,8],"split":[100,99,98]}}`)
	tB := time.Date(2026, 4, 1, 10, 0, 0, 0, time.UTC)
	mustExec(t, db.Handle(),
		`INSERT INTO sessions(id, rower_id, started_at, ended_at, workout_id, summary_json, initial_level)
		 VALUES('S_DPB','R1',?,?,'W1',?,3)`,
		tB.Format(time.RFC3339Nano), tB.Add(time.Minute*7).Format(time.RFC3339Nano),
		`{"samples":{"t_sec":[0,4,8],"split":[105,104,103]}}`)

	mustExec(t, db.Handle(),
		`INSERT INTO pb_workout(rower_id, shape_hash, mode, params_json, value_kind, value,
		    source_session_id, source_session_started_at, achieved_at)
		 VALUES('R1','shapeA','distance','{"meters":2000}','time_sec',410,'S_WPB',?,?)`,
		tA.Format(time.RFC3339Nano), tA.Format(time.RFC3339Nano))
	mustExec(t, db.Handle(),
		`INSERT INTO pb_distance(rower_id, distance_m, time_sec, source_session_id,
		    source_session_started_at, achieved_at, window_start_stroke, window_end_stroke)
		 VALUES('R1',2000,410,'S_DPB',?,?,0,200)`,
		tB.Format(time.RFC3339Nano), tB.Format(time.RFC3339Nano))

	h := api.RaceOpponentsHandler(db.Handle())
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest("GET", "/api/v1/race/opponents?workout_id=W1&rower_id=R1", nil))
	if rec.Code != 200 {
		t.Fatalf("status: %d body=%s", rec.Code, rec.Body.String())
	}
	var resp struct {
		PB *api.RaceOpponent `json:"pb"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if resp.PB == nil {
		t.Fatalf("pb = nil, want S_WPB")
	}
	if resp.PB.SourceSessionID != "S_WPB" {
		t.Errorf("pb.SourceSessionID = %s, want S_WPB", resp.PB.SourceSessionID)
	}
}

func TestRaceOpponents_PBNoneWhenSourceSessionDeleted(t *testing.T) {
	t.Parallel()
	db, err := storage.Open(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	now := time.Now().UTC().Format(time.RFC3339Nano)
	mustExec(t, db.Handle(),
		`INSERT INTO rowers(id, name, color, created_at) VALUES('R1','D','#0f0',?)`, now)
	mustExec(t, db.Handle(),
		`INSERT INTO workout(id, mode, params_json, intensity, warmup_sec, cooldown_sec, created_at, shape_hash)
		 VALUES('W1','distance','{"meters":2000}','allout',0,0,?, 'shapeA')`, now)

	tDel := time.Date(2026, 3, 1, 10, 0, 0, 0, time.UTC)
	mustExec(t, db.Handle(),
		`INSERT INTO sessions(id, rower_id, started_at, ended_at, workout_id, summary_json, initial_level, deleted_at)
		 VALUES('S_DEL','R1',?,?,'W1',?,3,?)`,
		tDel.Format(time.RFC3339Nano), tDel.Add(time.Minute*7).Format(time.RFC3339Nano),
		`{"samples":{"t_sec":[0,5],"split":[110,108]}}`,
		tDel.Add(time.Hour).Format(time.RFC3339Nano))

	mustExec(t, db.Handle(),
		`INSERT INTO pb_workout(rower_id, shape_hash, mode, params_json, value_kind, value,
		    source_session_id, source_session_started_at, achieved_at)
		 VALUES('R1','shapeA','distance','{"meters":2000}','time_sec',400,'S_DEL',?,?)`,
		tDel.Format(time.RFC3339Nano), tDel.Format(time.RFC3339Nano))

	h := api.RaceOpponentsHandler(db.Handle())
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest("GET", "/api/v1/race/opponents?workout_id=W1&rower_id=R1", nil))
	if rec.Code != 200 {
		t.Fatalf("status: %d body=%s", rec.Code, rec.Body.String())
	}
	var resp struct {
		PB *api.RaceOpponent `json:"pb"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if resp.PB != nil {
		t.Errorf("pb = %+v, want nil (source session deleted)", resp.PB)
	}
}

func TestRaceOpponents_DistancePBIgnoredForNonStandardDistance(t *testing.T) {
	t.Parallel()
	db, err := storage.Open(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	now := time.Now().UTC().Format(time.RFC3339Nano)
	mustExec(t, db.Handle(),
		`INSERT INTO rowers(id, name, color, created_at) VALUES('R1','D','#0f0',?)`, now)
	mustExec(t, db.Handle(),
		`INSERT INTO workout(id, mode, params_json, intensity, warmup_sec, cooldown_sec, created_at, shape_hash)
		 VALUES('W1','distance','{"meters":1234}','allout',0,0,?, 'shapeOdd')`, now)

	tFast := time.Date(2026, 3, 1, 10, 0, 0, 0, time.UTC)
	mustExec(t, db.Handle(),
		`INSERT INTO sessions(id, rower_id, started_at, ended_at, workout_id, summary_json, initial_level)
		 VALUES('S_FAST','R1',?,?,'W1',?,3)`,
		tFast.Format(time.RFC3339Nano), tFast.Add(time.Minute*5).Format(time.RFC3339Nano),
		`{"samples":{"t_sec":[0,4,8],"split":[100,99,98]}}`)

	// Defensively insert a pb_distance for 1234 — should be ignored.
	mustExec(t, db.Handle(),
		`INSERT INTO pb_distance(rower_id, distance_m, time_sec, source_session_id,
		    source_session_started_at, achieved_at, window_start_stroke, window_end_stroke)
		 VALUES('R1',1234,300,'S_FAST',?,?,0,100)`,
		tFast.Format(time.RFC3339Nano), tFast.Format(time.RFC3339Nano))

	h := api.RaceOpponentsHandler(db.Handle())
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest("GET", "/api/v1/race/opponents?workout_id=W1&rower_id=R1", nil))
	if rec.Code != 200 {
		t.Fatalf("status: %d body=%s", rec.Code, rec.Body.String())
	}
	var resp struct {
		PB *api.RaceOpponent `json:"pb"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if resp.PB != nil {
		t.Errorf("pb = %+v, want nil (1234m is not a standard PB distance)", resp.PB)
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
