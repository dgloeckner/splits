package api_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"
	"time"

	"github.com/gloeckner-daniel/home-ergo/internal/api"
	"github.com/gloeckner-daniel/home-ergo/internal/rower"
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
	t0 := time.Date(2026, 4, 1, 8, 0, 0, 0, time.UTC)
	startedStr := t0.Format(time.RFC3339Nano)
	if _, err := db.Handle().Exec(`INSERT INTO sessions(id, rower_id, started_at, ended_at,
		initial_level, total_distance_m, total_time_sec, total_strokes)
		VALUES('S1','R1',?,?,3,5000,1500,500)`,
		startedStr, t0.Add(time.Minute).Format(time.RFC3339Nano)); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Handle().Exec(`
		INSERT INTO session_pb_distance_candidates(session_id, rower_id, started_at,
			distance_m, time_sec, window_start_stroke, window_end_stroke)
		VALUES('S1','R1',?,2000,480,1,200)`, startedStr); err != nil {
		t.Fatal(err)
	}
	if err := stats.Recompute(ctx, db.Handle(), "R1"); err != nil {
		t.Fatal(err)
	}

	h := api.PBsHandler(db.Handle(), rower.NewRepo(db.Handle()))

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

func TestRowerEndpoints_UnknownRowerReturns404(t *testing.T) {
	t.Parallel()
	db, err := storage.Open(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	repo := rower.NewRepo(db.Handle())
	pbs := api.PBsHandler(db.Handle(), repo)
	trends := api.TrendsHandler(db.Handle(), repo)

	for _, tc := range []struct {
		path string
		h    http.Handler
	}{
		{"/api/v1/rowers/missing/pbs", pbs},
		{"/api/v1/rowers/missing/pbs/history", pbs},
		{"/api/v1/rowers/missing/lifetime", pbs},
		{"/api/v1/rowers/missing/achievements", pbs},
		{"/api/v1/rowers/missing/trends", trends},
	} {
		t.Run(tc.path, func(t *testing.T) {
			rec := httptest.NewRecorder()
			tc.h.ServeHTTP(rec, httptest.NewRequest("GET", tc.path, nil))
			if rec.Code != http.StatusNotFound {
				t.Errorf("%s: want 404, got %d body=%s", tc.path, rec.Code, rec.Body.String())
			}
		})
	}
}
