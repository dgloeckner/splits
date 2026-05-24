package api_test

import (
	"context"
	"encoding/json"
	"net/http/httptest"
	"path/filepath"
	"testing"
	"time"

	"github.com/gloeckner-daniel/splits/internal/api"
	"github.com/gloeckner-daniel/splits/internal/rower"
	"github.com/gloeckner-daniel/splits/internal/storage"
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
	avgSPM    float64
	deleted   bool
	// optional workout assignment for series tests
	workoutID string
	mode      string
	params    string
	shapeHash string
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
		if s.workoutID != "" {
			if _, err := db.Handle().Exec(`
				INSERT INTO workout(id, mode, params_json, intensity, warmup_sec, cooldown_sec, created_at, shape_hash)
				VALUES(?, ?, ?, 'moderat', 0, 0, ?, ?)`,
				s.workoutID, s.mode, s.params,
				s.startedAt.UTC().Format(time.RFC3339Nano),
				s.shapeHash,
			); err != nil {
				t.Fatalf("insert workout: %v", err)
			}
		}
		var deletedAt any
		if s.deleted {
			deletedAt = s.endedAt.UTC().Format(time.RFC3339Nano)
		}
		var workoutID any
		if s.workoutID != "" {
			workoutID = s.workoutID
		}
		if _, err := db.Handle().Exec(`
			INSERT INTO sessions(id, rower_id, started_at, ended_at, initial_level,
				total_distance_m, total_time_sec, total_strokes,
				avg_power_w, avg_pace_sec_per_500m, avg_dps, avg_spi, avg_spm,
				deleted_at, workout_id)
			VALUES(?, ?, ?, ?, 3, ?, ?, 100, ?, ?, ?, ?, ?, ?, ?)`,
			s.id, rowerID,
			s.startedAt.UTC().Format(time.RFC3339Nano),
			s.endedAt.UTC().Format(time.RFC3339Nano),
			s.distM, s.timeSec,
			s.avgPower, s.avgPace, s.avgDPS, s.avgSPI, s.avgSPM,
			deletedAt, workoutID,
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
	// Session in current week + one in prior week. Compute the prior-
	// week Wednesday explicitly: a fixed -8d offset breaks on Mondays
	// because it falls on Sunday, which is the *previous* prior week
	// under ISO weeks (Mon–Sun).
	wd := int(now.Weekday())
	if wd == 0 { // Sunday in Go = 0 → ISO 7
		wd = 7
	}
	daysSinceMon := wd - 1
	priorWeekMon := now.AddDate(0, 0, -daysSinceMon-7)
	cur := now.Add(-1 * time.Hour)
	prior := time.Date(priorWeekMon.Year(), priorWeekMon.Month(), priorWeekMon.Day(),
		12, 0, 0, 0, loc).AddDate(0, 0, 2) // prior-week Wednesday noon
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

func TestTrendsHandlerReturnsSeriesByShape(t *testing.T) {
	db, err := storage.Open(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	rid := "r1"
	seedRower(t, db, rid)

	now := time.Now().UTC()
	day := 24 * time.Hour
	seedSessions(t, db, rid, []seedSession{
		// 4 completed 5k pieces over the last 2 weeks
		{id: "s1", startedAt: now.Add(-15 * day), endedAt: now.Add(-15 * day).Add(20 * time.Minute), distM: 5004, timeSec: 1138, avgPower: 374, avgPace: 110, avgDPS: 9.69, avgSPI: 12, avgSPM: 28.0, workoutID: "w-5k-1", mode: "distance", params: `{"meters":5000}`, shapeHash: "H_5K"},
		{id: "s2", startedAt: now.Add(-9 * day), endedAt: now.Add(-9 * day).Add(19 * time.Minute), distM: 5005, timeSec: 1122, avgPower: 375, avgPace: 109, avgDPS: 9.62, avgSPI: 12, avgSPM: 28.4, workoutID: "w-5k-2", mode: "distance", params: `{"meters":5000}`, shapeHash: "H_5K"},
		{id: "s3", startedAt: now.Add(-7 * day), endedAt: now.Add(-7 * day).Add(18 * time.Minute), distM: 5029, timeSec: 1102, avgPower: 379, avgPace: 107, avgDPS: 9.53, avgSPI: 12, avgSPM: 28.9, workoutID: "w-5k-3", mode: "distance", params: `{"meters":5000}`, shapeHash: "H_5K"},
		{id: "s4", startedAt: now.Add(-1 * day), endedAt: now.Add(-1 * day).Add(18 * time.Minute), distM: 5008, timeSec: 1082, avgPower: 382, avgPace: 107, avgDPS: 9.59, avgSPI: 12, avgSPM: 28.7, workoutID: "w-5k-4", mode: "distance", params: `{"meters":5000}`, shapeHash: "H_5K"},
		// 1 abandoned 500m (134m / 500m = 27%) — should NOT appear in any series
		{id: "s5", startedAt: now.Add(-2 * day), endedAt: now.Add(-2 * day).Add(40 * time.Second), distM: 134, timeSec: 36, avgPower: 182, avgPace: 143, avgDPS: 8.4, avgSPI: 7, avgSPM: 24, workoutID: "w-500", mode: "distance", params: `{"meters":500}`, shapeHash: "H_500"},
		// 1 completed race 2k
		{id: "s6", startedAt: now.Add(-5 * day), endedAt: now.Add(-5 * day).Add(7 * time.Minute), distM: 2010, timeSec: 420, avgPower: 410, avgPace: 105, avgDPS: 9.0, avgSPI: 13, avgSPM: 32.0, workoutID: "w-r2k", mode: "race", params: `{"meters":2000}`, shapeHash: "H_2K"},
	})

	// PB for 5k = s4 (1082 sec → pace 1082/10 = 108.2 s/500m)
	if _, err := db.Handle().Exec(`
		INSERT INTO pb_distance(rower_id, distance_m, time_sec, source_session_id, source_session_started_at, achieved_at, window_start_stroke, window_end_stroke)
		VALUES(?, 5000, 1082, 's4', ?, ?, 1, 480)`,
		rid, now.Add(-1*day).UTC().Format(time.RFC3339Nano), now.Add(-1*day).UTC().Format(time.RFC3339Nano)); err != nil {
		t.Fatalf("seed pb: %v", err)
	}

	repo := rower.NewRepo(db.Handle())
	req := httptest.NewRequest("GET", "/api/v1/rowers/"+rid+"/trends?range=month", nil)
	rec := httptest.NewRecorder()
	api.TrendsHandler(db.Handle(), repo).ServeHTTP(rec, req)
	if rec.Code != 200 {
		t.Fatalf("status %d, body %s", rec.Code, rec.Body.String())
	}

	var got struct {
		Series           []map[string]any `json:"series"`
		EfficiencySeries []map[string]any `json:"efficiency_series"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode: %v; body=%s", err, rec.Body.String())
	}

	if len(got.Series) != 2 {
		t.Fatalf("got %d series, want 2 (distance 5k + race 2k); body=%s", len(got.Series), rec.Body.String())
	}
	// Most-rowed first.
	first := got.Series[0]
	if first["display_name"] != "5 k" {
		t.Fatalf("first series display_name = %v, want \"5 k\"", first["display_name"])
	}
	pts, ok := first["points"].([]any)
	if !ok || len(pts) != 4 {
		t.Fatalf("first series points = %v, want 4 points", first["points"])
	}
	pb, _ := first["pb_pace_sec_per_500m"].(float64)
	if pb < 108.0 || pb > 108.5 {
		t.Fatalf("first series PB pace = %v, want ~108.2 s/500m", pb)
	}

	// 134m piece must NOT have created a distance|H_500 series.
	for _, s := range got.Series {
		key, _ := s["key"].(map[string]any)
		if key != nil && key["shape_hash"] == "H_500" {
			t.Fatalf("abandoned 134m piece leaked into series: %v", s)
		}
	}
}
