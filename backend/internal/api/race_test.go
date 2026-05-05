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
