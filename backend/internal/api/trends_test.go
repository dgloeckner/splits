package api_test

import (
	"context"
	"encoding/json"
	"net/http/httptest"
	"path/filepath"
	"testing"
	"time"

	"github.com/gloeckner-daniel/home-ergo/internal/api"
	"github.com/gloeckner-daniel/home-ergo/internal/rower"
	"github.com/gloeckner-daniel/home-ergo/internal/storage"
)

type seedSession struct {
	id        string
	startedAt time.Time
	endedAt   time.Time
	distM     int
	timeSec   float64
	avgPower  float64
	avgPace   float64
	avgDPS    float64
	avgSPI    float64
	deleted   bool
}

func seedRower(t *testing.T, db *storage.DB, id string) {
	t.Helper()
	if _, err := db.Handle().Exec(
		`INSERT INTO rowers(id, name, color, created_at) VALUES(?,'D','#0f0',?)`,
		id, time.Now().UTC().Format(time.RFC3339Nano)); err != nil {
		t.Fatal(err)
	}
}

func seedSessions(t *testing.T, db *storage.DB, rowerID string, ss []seedSession) {
	t.Helper()
	for _, s := range ss {
		var deletedAt any
		if s.deleted {
			deletedAt = s.endedAt.UTC().Format(time.RFC3339Nano)
		}
		if _, err := db.Handle().Exec(`
			INSERT INTO sessions(id, rower_id, started_at, ended_at, initial_level,
				total_distance_m, total_time_sec, total_strokes,
				avg_power_w, avg_pace_sec_per_500m, avg_dps, avg_spi,
				deleted_at)
			VALUES(?, ?, ?, ?, 3, ?, ?, 100, ?, ?, ?, ?, ?)`,
			s.id, rowerID,
			s.startedAt.UTC().Format(time.RFC3339Nano),
			s.endedAt.UTC().Format(time.RFC3339Nano),
			s.distM, s.timeSec,
			s.avgPower, s.avgPace, s.avgDPS, s.avgSPI,
			deletedAt,
		); err != nil {
			t.Fatal(err)
		}
	}
}

func mustGetTrends(t *testing.T, db *storage.DB, rowerID, rng string) map[string]any {
	t.Helper()
	h := api.TrendsHandler(db.Handle(), rower.NewRepo(db.Handle()))
	rec := httptest.NewRecorder()
	url := "/api/v1/rowers/" + rowerID + "/trends"
	if rng != "" {
		url += "?range=" + rng
	}
	h.ServeHTTP(rec, httptest.NewRequest("GET", url, nil))
	if rec.Code != 200 {
		t.Fatalf("trends %s: %d %s", rng, rec.Code, rec.Body.String())
	}
	var out map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatal(err)
	}
	return out
}

func TestTrendsEmptyRower(t *testing.T) {
	db, err := storage.Open(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	_ = context.Background()
	seedRower(t, db, "R1")

	got := mustGetTrends(t, db, "R1", "month")
	totals := got["totals"].(map[string]any)
	if totals["sessions"].(float64) != 0 || totals["distance_m"].(float64) != 0 {
		t.Errorf("expected zero totals, got %+v", totals)
	}
	if perf := got["performance"].(map[string]any); len(perf["points"].([]any)) != 0 {
		t.Errorf("expected empty perf points")
	}
	if eff := got["efficiency"].(map[string]any); len(eff["points"].([]any)) != 0 {
		t.Errorf("expected empty eff points")
	}
}

func TestTrendsSingleSessionCurrentMonth(t *testing.T) {
	db, err := storage.Open(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	seedRower(t, db, "R1")

	loc, _ := time.LoadLocation("Europe/Berlin")
	now := time.Now().In(loc)
	// Mid-current-month session.
	start := time.Date(now.Year(), now.Month(), 1, 10, 0, 0, 0, loc).Add(2 * 24 * time.Hour)
	if start.After(now) {
		start = now.Add(-1 * time.Hour)
	}
	seedSessions(t, db, "R1", []seedSession{{
		id: "S1", startedAt: start, endedAt: start.Add(30 * time.Minute),
		distM: 5000, timeSec: 1500, avgPower: 200, avgPace: 124, avgDPS: 9.5, avgSPI: 8,
	}})

	got := mustGetTrends(t, db, "R1", "month")
	totals := got["totals"].(map[string]any)
	if totals["sessions"].(float64) != 1 || totals["distance_m"].(float64) != 5000 {
		t.Errorf("totals = %+v", totals)
	}
	perf := got["performance"].(map[string]any)
	if len(perf["points"].([]any)) != 1 {
		t.Errorf("expected 1 perf point, got %d", len(perf["points"].([]any)))
	}
	if perf["avg_power_w"].(float64) != 200 {
		t.Errorf("avg_power_w = %v", perf["avg_power_w"])
	}
}

func TestTrendsZeroDistanceExcludedFromChartButCounted(t *testing.T) {
	db, err := storage.Open(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	seedRower(t, db, "R1")

	loc, _ := time.LoadLocation("Europe/Berlin")
	now := time.Now().In(loc)
	start := time.Date(now.Year(), now.Month(), 1, 10, 0, 0, 0, loc)
	if start.After(now) {
		start = now.Add(-1 * time.Hour)
	}
	seedSessions(t, db, "R1", []seedSession{{
		id: "S1", startedAt: start, endedAt: start.Add(5 * time.Minute),
		distM: 0, timeSec: 300, avgPower: 0, avgPace: 0, avgDPS: 0, avgSPI: 0,
	}})

	got := mustGetTrends(t, db, "R1", "month")
	totals := got["totals"].(map[string]any)
	if totals["sessions"].(float64) != 1 {
		t.Errorf("sessions count should include zero-distance session: %+v", totals)
	}
	perf := got["performance"].(map[string]any)
	if len(perf["points"].([]any)) != 0 {
		t.Errorf("zero-distance excluded from chart, got %d points", len(perf["points"].([]any)))
	}
}

func TestTrendsSoftDeletedExcluded(t *testing.T) {
	db, err := storage.Open(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	seedRower(t, db, "R1")

	loc, _ := time.LoadLocation("Europe/Berlin")
	now := time.Now().In(loc)
	start := time.Date(now.Year(), now.Month(), 1, 10, 0, 0, 0, loc)
	if start.After(now) {
		start = now.Add(-1 * time.Hour)
	}
	seedSessions(t, db, "R1", []seedSession{{
		id: "S1", startedAt: start, endedAt: start.Add(20 * time.Minute),
		distM: 4000, timeSec: 1200, avgPower: 180, avgPace: 130, avgDPS: 9, avgSPI: 7,
		deleted: true,
	}})

	got := mustGetTrends(t, db, "R1", "month")
	totals := got["totals"].(map[string]any)
	if totals["sessions"].(float64) != 0 {
		t.Errorf("soft-deleted session must not count: %+v", totals)
	}
}

func TestTrendsAllRangeOmitsPrior(t *testing.T) {
	db, err := storage.Open(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	seedRower(t, db, "R1")

	got := mustGetTrends(t, db, "R1", "all")
	if _, ok := got["prior"]; ok {
		t.Errorf("range=all must not include prior, got %+v", got["prior"])
	}
	if got["range"].(string) != "all" {
		t.Errorf("range mismatch: %v", got["range"])
	}
	if period := got["period"].(map[string]any); period["label"].(string) != "Insgesamt" {
		t.Errorf("label = %v", period["label"])
	}
}

func TestTrendsWeekRangeIncludesPrior(t *testing.T) {
	db, err := storage.Open(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	seedRower(t, db, "R1")

	loc, _ := time.LoadLocation("Europe/Berlin")
	now := time.Now().In(loc)
	// Session in current week + one in prior week.
	cur := now.Add(-1 * time.Hour)
	prior := now.AddDate(0, 0, -8)
	seedSessions(t, db, "R1", []seedSession{
		{id: "S1", startedAt: cur, endedAt: cur.Add(20 * time.Minute),
			distM: 4000, timeSec: 1200, avgPower: 200, avgPace: 130, avgDPS: 9, avgSPI: 7},
		{id: "S2", startedAt: prior, endedAt: prior.Add(20 * time.Minute),
			distM: 3000, timeSec: 1100, avgPower: 180, avgPace: 135, avgDPS: 8.5, avgSPI: 6.5},
	})

	got := mustGetTrends(t, db, "R1", "week")
	totals := got["totals"].(map[string]any)
	priorBlock, ok := got["prior"].(map[string]any)
	if !ok {
		t.Fatalf("expected prior block")
	}
	if totals["distance_m"].(float64) != 4000 {
		t.Errorf("current totals: %+v", totals)
	}
	if priorBlock["distance_m"].(float64) != 3000 {
		t.Errorf("prior totals: %+v", priorBlock)
	}
}

func TestTrends14DayDelta(t *testing.T) {
	db, err := storage.Open(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	seedRower(t, db, "R1")

	loc, _ := time.LoadLocation("Europe/Berlin")
	now := time.Now().In(loc)
	recent := now.Add(-3 * 24 * time.Hour)
	previous := now.Add(-20 * 24 * time.Hour)
	seedSessions(t, db, "R1", []seedSession{
		{id: "R1S", startedAt: recent, endedAt: recent.Add(20 * time.Minute),
			distM: 4000, timeSec: 1200, avgPower: 200, avgPace: 130, avgDPS: 10, avgSPI: 8},
		{id: "P1S", startedAt: previous, endedAt: previous.Add(20 * time.Minute),
			distM: 3500, timeSec: 1100, avgPower: 180, avgPace: 135, avgDPS: 8, avgSPI: 6},
	})

	got := mustGetTrends(t, db, "R1", "year")
	eff := got["efficiency"].(map[string]any)
	dDPS := eff["delta_dps"].(float64)
	dSPI := eff["delta_spi"].(float64)
	if !floatNear(dDPS, 2.0, 0.01) {
		t.Errorf("delta_dps = %v want ~2.0", dDPS)
	}
	if !floatNear(dSPI, 2.0, 0.01) {
		t.Errorf("delta_spi = %v want ~2.0", dSPI)
	}
}

func TestTrendsInvalidRange(t *testing.T) {
	db, err := storage.Open(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	seedRower(t, db, "R1")

	h := api.TrendsHandler(db.Handle(), rower.NewRepo(db.Handle()))
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest("GET", "/api/v1/rowers/R1/trends?range=quarter", nil))
	if rec.Code != 400 {
		t.Errorf("expected 400, got %d", rec.Code)
	}
}

func floatNear(a, b, tol float64) bool {
	d := a - b
	if d < 0 {
		d = -d
	}
	return d <= tol
}
