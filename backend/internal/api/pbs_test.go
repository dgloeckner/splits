package api_test

import (
	"context"
	"encoding/json"
	"net/http/httptest"
	"path/filepath"
	"testing"
	"time"

	"github.com/gloeckner-daniel/home-ergo/internal/api"
	"github.com/gloeckner-daniel/home-ergo/internal/stats"
	"github.com/gloeckner-daniel/home-ergo/internal/storage"
)

func TestPBsHandlerSmoke(t *testing.T) {
	db, err := storage.Open(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	ctx := context.Background()
	if _, err := db.Handle().Exec(
		`INSERT INTO rowers(id, name, color, created_at) VALUES('R1','D','#0f0',?)`,
		time.Now().UTC().Format(time.RFC3339Nano)); err != nil {
		t.Fatal(err)
	}
	type sumWire struct {
		PBCandidates *stats.PBCandidates `json:"pb_candidates"`
	}
	blob, _ := json.Marshal(sumWire{&stats.PBCandidates{
		Distance: []stats.DistanceCandidate{{DistanceM: 2000, TimeSec: 480, WindowEndStroke: 200, WindowStartStroke: 1}},
	}})
	t0 := time.Date(2026, 4, 1, 8, 0, 0, 0, time.UTC)
	if _, err := db.Handle().Exec(`INSERT INTO sessions(id, rower_id, started_at, ended_at,
		initial_level, total_distance_m, total_time_sec, total_strokes, summary_json)
		VALUES('S1','R1',?,?,3,5000,1500,500,?)`,
		t0.Format(time.RFC3339Nano), t0.Add(time.Minute).Format(time.RFC3339Nano), string(blob)); err != nil {
		t.Fatal(err)
	}
	if err := stats.Recompute(ctx, db.Handle(), "R1"); err != nil {
		t.Fatal(err)
	}

	h := api.PBsHandler(db.Handle())

	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest("GET", "/api/v1/rowers/R1/pbs", nil))
	if rec.Code != 200 {
		t.Fatalf("pbs: %d %s", rec.Code, rec.Body.String())
	}
	var pbs struct {
		Distance []map[string]any `json:"distance"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &pbs); err != nil {
		t.Fatal(err)
	}
	if len(pbs.Distance) != 1 || pbs.Distance[0]["distance_m"].(float64) != 2000 {
		t.Errorf("distance pbs: %+v", pbs.Distance)
	}

	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest("GET", "/api/v1/rowers/R1/lifetime", nil))
	var life map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &life); err != nil {
		t.Fatal(err)
	}
	if v, _ := life["total_distance_m"].(float64); v != 5000 {
		t.Errorf("lifetime total_distance_m = %v", v)
	}
	if v, _ := life["stats_version"].(float64); v != 1 {
		t.Errorf("stats_version = %v", v)
	}

	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest("GET", "/api/v1/sessions/S1/pb-banners", nil))
	if rec.Code != 200 {
		t.Fatalf("pb-banners: %d %s", rec.Code, rec.Body.String())
	}
	var banners struct {
		Distance []map[string]any `json:"distance"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &banners)
	if len(banners.Distance) != 1 {
		t.Errorf("session banners: %+v", banners)
	}
}
