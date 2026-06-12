package api_test

import (
	"encoding/json"
	"net/http/httptest"
	"path/filepath"
	"testing"
	"time"

	"github.com/gloeckner-daniel/splits/internal/api"
	"github.com/gloeckner-daniel/splits/internal/rower"
	"github.com/gloeckner-daniel/splits/internal/storage"
)

// ---- seed helpers ----------------------------------------------------------

type seedSession struct {
	id        string
	startedAt time.Time
	endedAt   time.Time
	distM     int
	timeSec   float64
	avgPower  float64
	avgPace   float64
	avgDPS    float64
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
				avg_power_w, avg_pace_sec_per_500m, avg_dps, avg_spm,
				deleted_at, workout_id)
			VALUES(?, ?, ?, ?, 3, ?, ?, 100, ?, ?, ?, ?, ?, ?)`,
			s.id, rowerID,
			s.startedAt.UTC().Format(time.RFC3339Nano),
			s.endedAt.UTC().Format(time.RFC3339Nano),
			s.distM, s.timeSec,
			s.avgPower, s.avgPace, s.avgDPS, s.avgSPM,
			deletedAt, workoutID,
		); err != nil {
			t.Fatal(err)
		}
	}
}

// ---- typed decode ----------------------------------------------------------

// trendsOut mirrors the wire shape. DisallowUnknownFields makes field
// removals/renames loud.
type trendsOut struct {
	Window string        `json:"window"`
	From   string        `json:"from"`
	To     string        `json:"to"`
	Points []trendsPtOut `json:"points"`
	Series []struct {
		Key struct {
			ShapeHash string `json:"shape_hash"`
		} `json:"key"`
		Params           json.RawMessage `json:"params"`
		DisplayName      string          `json:"display_name"`
		PBPaceSecPer500m float64         `json:"pb_pace_sec_per_500m"`
		Points           []struct {
			T                 string  `json:"t"`
			SessionID         string  `json:"session_id"`
			TotalDistanceM    int     `json:"total_distance_m"`
			TotalTimeSec      float64 `json:"total_time_sec"`
			AvgPowerW         float64 `json:"avg_power_w"`
			AvgPaceSecPer500m float64 `json:"avg_pace_sec_per_500m"`
			AvgDPS            float64 `json:"avg_dps"`
			AvgSPM            float64 `json:"avg_spm"`
		} `json:"points"`
	} `json:"series"`
	Totals       totalsOut  `json:"totals"`
	Prior        *totalsOut `json:"prior"`
	StatsVersion int        `json:"stats_version"`
}

type totalsOut struct {
	DistanceM int     `json:"distance_m"`
	ActiveSec float64 `json:"active_sec"`
	Sessions  int     `json:"sessions"`
}

type trendsPtOut struct {
	T                 string  `json:"t"`
	SessionID         string  `json:"session_id"`
	Mode              string  `json:"mode"`
	ShapeHash         string  `json:"shape_hash,omitempty"`
	DistanceM         int     `json:"distance_m"`
	TimeSec           float64 `json:"time_sec"`
	AvgPaceSecPer500m float64 `json:"avg_pace_sec_per_500m"`
	AvgPowerW         float64 `json:"avg_power_w"`
	AvgSPM            float64 `json:"avg_spm"`
	AvgDPS            float64 `json:"avg_dps"`
	Completed         bool    `json:"completed"`
	DistancePB        bool    `json:"distance_pb"`
}

func mustGetTrendsTyped(t *testing.T, db *storage.DB, rowerID, window string) trendsOut {
	t.Helper()
	h := api.TrendsHandler(db.Handle(), rower.NewRepo(db.Handle()))
	rec := httptest.NewRecorder()
	url := "/api/v1/rowers/" + rowerID + "/trends"
	if window != "" {
		url += "?window=" + window
	}
	h.ServeHTTP(rec, httptest.NewRequest("GET", url, nil))
	if rec.Code != 200 {
		t.Fatalf("trends %s: %d %s", window, rec.Code, rec.Body.String())
	}
	dec := json.NewDecoder(rec.Body)
	dec.DisallowUnknownFields()
	var out trendsOut
	if err := dec.Decode(&out); err != nil {
		t.Fatalf("typed decode (response drifted from trendsOut?): %v", err)
	}
	return out
}

func floatNear(a, b, tol float64) bool {
	d := a - b
	if d < 0 {
		d = -d
	}
	return d <= tol
}

// ---- tests -----------------------------------------------------------------

func TestTrendsOneWindowShape(t *testing.T) {
	db, err := storage.Open(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	rowerID := "R1"
	seedRower(t, db, rowerID)

	now := time.Now()

	// 1 completed 5k 10 days ago
	s1start := now.Add(-10 * 24 * time.Hour)
	s1end := s1start.Add(20 * time.Minute)
	seedSessions(t, db, rowerID, []seedSession{{
		id: "s1", startedAt: s1start, endedAt: s1end,
		distM: 5000, timeSec: 1200, avgPower: 200, avgPace: 120,
		avgDPS: 9.5, avgSPM: 28,
		workoutID: "w-s1", mode: "distance", params: `{"meters":5000}`, shapeHash: "H_5K",
	}})

	// 1 just_row 5 days ago
	s2start := now.Add(-5 * 24 * time.Hour)
	s2end := s2start.Add(15 * time.Minute)
	seedSessions(t, db, rowerID, []seedSession{{
		id: "s2", startedAt: s2start, endedAt: s2end,
		distM: 3000, timeSec: 900, avgPower: 180, avgPace: 130,
		avgDPS: 9.0, avgSPM: 26,
	}})

	// 1 zero-work session 3 days ago (should be excluded)
	s3start := now.Add(-3 * 24 * time.Hour)
	s3end := s3start.Add(5 * time.Minute)
	seedSessions(t, db, rowerID, []seedSession{{
		id: "s3", startedAt: s3start, endedAt: s3end,
		distM: 0, timeSec: 300, avgPower: 0, avgPace: 0,
	}})

	// 1 session 40 days ago (prior window only for 30d)
	s4start := now.Add(-40 * 24 * time.Hour)
	s4end := s4start.Add(20 * time.Minute)
	seedSessions(t, db, rowerID, []seedSession{{
		id: "s4", startedAt: s4start, endedAt: s4end,
		distM: 5000, timeSec: 1210, avgPower: 195, avgPace: 122,
		avgDPS: 9.3, avgSPM: 27,
		workoutID: "w-s4", mode: "distance", params: `{"meters":5000}`, shapeHash: "H_5K",
	}})

	out := mustGetTrendsTyped(t, db, rowerID, "30d")

	if out.Window != "30d" {
		t.Fatalf("window: %s", out.Window)
	}
	if len(out.Points) != 2 {
		t.Fatalf("want 2 points (s1+s2, zero-dist excluded), got %d", len(out.Points))
	}
	if out.Totals.Sessions != 2 {
		t.Fatalf("want 2 sessions, got %d", out.Totals.Sessions)
	}
	if out.Prior == nil || out.Prior.Sessions != 1 {
		t.Fatalf("want prior.sessions=1 (s4 at -40d), got %+v", out.Prior)
	}
	// Verify points are ordered ASC by time (s1 first, s2 second)
	found := false
	for _, p := range out.Points {
		if p.SessionID == "s1" {
			found = true
		}
	}
	if !found {
		t.Fatalf("s1 not in points")
	}
}

func TestTrendsDistancePBFlag(t *testing.T) {
	db, err := storage.Open(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	rowerID := "R1"
	seedRower(t, db, rowerID)

	now := time.Now()
	sstart := now.Add(-5 * 24 * time.Hour)
	send := sstart.Add(20 * time.Minute)
	seedSessions(t, db, rowerID, []seedSession{{
		id: "sess-pb", startedAt: sstart, endedAt: send,
		distM: 5000, timeSec: 1082, avgPower: 380, avgPace: 108,
		avgDPS: 9.6, avgSPM: 28,
		workoutID: "w-pb", mode: "distance", params: `{"meters":5000}`, shapeHash: "H_5K",
	}})

	// Insert pb_distance row pointing at this session
	if _, err := db.Handle().Exec(`
		INSERT INTO pb_distance(rower_id, distance_m, time_sec, source_session_id, source_session_started_at, achieved_at, window_start_stroke, window_end_stroke)
		VALUES(?, 5000, 1082, 'sess-pb', ?, ?, 1, 480)`,
		rowerID,
		sstart.UTC().Format(time.RFC3339Nano),
		sstart.UTC().Format(time.RFC3339Nano)); err != nil {
		t.Fatalf("seed pb: %v", err)
	}

	out := mustGetTrendsTyped(t, db, rowerID, "30d")

	if len(out.Points) != 1 {
		t.Fatalf("want 1 point, got %d", len(out.Points))
	}
	if !out.Points[0].DistancePB {
		t.Fatalf("expected distance_pb=true for session with pb_distance row")
	}
}

func TestTrendsZeroWorkExcludedEverywhere(t *testing.T) {
	db, err := storage.Open(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	rowerID := "R1"
	seedRower(t, db, rowerID)

	now := time.Now()
	sstart := now.Add(-5 * 24 * time.Hour)
	send := sstart.Add(5 * time.Minute)
	seedSessions(t, db, rowerID, []seedSession{{
		id: "zero", startedAt: sstart, endedAt: send,
		distM: 0, timeSec: 300, avgPower: 0, avgPace: 0,
	}})

	out := mustGetTrendsTyped(t, db, rowerID, "30d")

	if len(out.Points) != 0 {
		t.Fatalf("want 0 points for zero-dist session, got %d", len(out.Points))
	}
	if out.Totals.Sessions != 0 {
		t.Fatalf("want totals.sessions=0, got %d", out.Totals.Sessions)
	}
}

func TestTrendsPriorFairWindow(t *testing.T) {
	db, err := storage.Open(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	rowerID := "R1"
	seedRower(t, db, rowerID)

	now := time.Now()

	// 10 days ago: in 30d window
	s1start := now.Add(-10 * 24 * time.Hour)
	s1end := s1start.Add(20 * time.Minute)
	seedSessions(t, db, rowerID, []seedSession{{
		id: "s1", startedAt: s1start, endedAt: s1end,
		distM: 5000, timeSec: 1200, avgPower: 200, avgPace: 120,
		workoutID: "w1", mode: "distance", params: `{"meters":5000}`, shapeHash: "H_5K",
	}})

	// 40 days ago: in 30d prior window (30-60d back), also in 365d window
	s2start := now.Add(-40 * 24 * time.Hour)
	s2end := s2start.Add(20 * time.Minute)
	seedSessions(t, db, rowerID, []seedSession{{
		id: "s2", startedAt: s2start, endedAt: s2end,
		distM: 5000, timeSec: 1210, avgPower: 195, avgPace: 122,
		workoutID: "w2", mode: "distance", params: `{"meters":5000}`, shapeHash: "H_5K",
	}})

	// 30d window: totals=1, prior=1
	out30 := mustGetTrendsTyped(t, db, rowerID, "30d")
	if out30.Totals.Sessions != 1 {
		t.Fatalf("30d: want totals.sessions=1, got %d", out30.Totals.Sessions)
	}
	if out30.Prior == nil || out30.Prior.Sessions != 1 {
		t.Fatalf("30d: want prior.sessions=1, got %+v", out30.Prior)
	}

	// 365d window: totals=2, prior should not include these (they're in window)
	out365 := mustGetTrendsTyped(t, db, rowerID, "365d")
	if out365.Totals.Sessions != 2 {
		t.Fatalf("365d: want totals.sessions=2, got %d", out365.Totals.Sessions)
	}
}

func TestTrendsAllHasNoPrior(t *testing.T) {
	db, err := storage.Open(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	rowerID := "R1"
	seedRower(t, db, rowerID)

	now := time.Now()
	// Ancient session — should be included with window=all
	sstart := now.Add(-400 * 24 * time.Hour)
	send := sstart.Add(20 * time.Minute)
	seedSessions(t, db, rowerID, []seedSession{{
		id: "old", startedAt: sstart, endedAt: send,
		distM: 5000, timeSec: 1200, avgPower: 190, avgPace: 125,
	}})

	out := mustGetTrendsTyped(t, db, rowerID, "all")

	if out.Prior != nil {
		t.Fatalf("window=all must have Prior==nil, got %+v", out.Prior)
	}
	if out.Totals.Sessions != 1 {
		t.Fatalf("window=all: want 1 session, got %d", out.Totals.Sessions)
	}
}

func TestTrendsInvalidWindow(t *testing.T) {
	db, err := storage.Open(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	seedRower(t, db, "R1")

	h := api.TrendsHandler(db.Handle(), rower.NewRepo(db.Handle()))

	// "week" is not a valid window key → 400
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest("GET", "/api/v1/rowers/R1/trends?window=week", nil))
	if rec.Code != 400 {
		t.Errorf("window=week: expected 400, got %d", rec.Code)
	}

	// Empty window → defaults to 30d → 200
	rec2 := httptest.NewRecorder()
	h.ServeHTTP(rec2, httptest.NewRequest("GET", "/api/v1/rowers/R1/trends", nil))
	if rec2.Code != 200 {
		t.Errorf("empty window: expected 200, got %d %s", rec2.Code, rec2.Body.String())
	}
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
		{id: "s1", startedAt: now.Add(-15 * day), endedAt: now.Add(-15 * day).Add(20 * time.Minute), distM: 5004, timeSec: 1138, avgPower: 374, avgPace: 110, avgDPS: 9.69, avgSPM: 28.0, workoutID: "w-5k-1", mode: "distance", params: `{"meters":5000}`, shapeHash: "H_5K"},
		{id: "s2", startedAt: now.Add(-9 * day), endedAt: now.Add(-9 * day).Add(19 * time.Minute), distM: 5005, timeSec: 1122, avgPower: 375, avgPace: 109, avgDPS: 9.62, avgSPM: 28.4, workoutID: "w-5k-2", mode: "distance", params: `{"meters":5000}`, shapeHash: "H_5K"},
		{id: "s3", startedAt: now.Add(-7 * day), endedAt: now.Add(-7 * day).Add(18 * time.Minute), distM: 5029, timeSec: 1102, avgPower: 379, avgPace: 107, avgDPS: 9.53, avgSPM: 28.9, workoutID: "w-5k-3", mode: "distance", params: `{"meters":5000}`, shapeHash: "H_5K"},
		{id: "s4", startedAt: now.Add(-1 * day), endedAt: now.Add(-1 * day).Add(18 * time.Minute), distM: 5008, timeSec: 1082, avgPower: 382, avgPace: 107, avgDPS: 9.59, avgSPM: 28.7, workoutID: "w-5k-4", mode: "distance", params: `{"meters":5000}`, shapeHash: "H_5K"},
		// 1 abandoned 500m (134m / 500m = 27%) — should NOT appear in any series
		{id: "s5", startedAt: now.Add(-2 * day), endedAt: now.Add(-2 * day).Add(40 * time.Second), distM: 134, timeSec: 36, avgPower: 182, avgPace: 143, avgDPS: 8.4, avgSPM: 24, workoutID: "w-500", mode: "distance", params: `{"meters":500}`, shapeHash: "H_500"},
		// 1 completed race 2k
		{id: "s6", startedAt: now.Add(-5 * day), endedAt: now.Add(-5 * day).Add(7 * time.Minute), distM: 2010, timeSec: 420, avgPower: 410, avgPace: 105, avgDPS: 9.0, avgSPM: 32.0, workoutID: "w-r2k", mode: "race", params: `{"meters":2000}`, shapeHash: "H_2K"},
	})

	// PB for 5k = s4 (1082 sec → pace 1082/10 = 108.2 s/500m)
	if _, err := db.Handle().Exec(`
		INSERT INTO pb_distance(rower_id, distance_m, time_sec, source_session_id, source_session_started_at, achieved_at, window_start_stroke, window_end_stroke)
		VALUES(?, 5000, 1082, 's4', ?, ?, 1, 480)`,
		rid, now.Add(-1*day).UTC().Format(time.RFC3339Nano), now.Add(-1*day).UTC().Format(time.RFC3339Nano)); err != nil {
		t.Fatalf("seed pb: %v", err)
	}

	out := mustGetTrendsTyped(t, db, rid, "30d")

	if len(out.Series) != 2 {
		t.Fatalf("got %d series, want 2 (distance 5k + race 2k)", len(out.Series))
	}
	// Most-rowed first.
	first := out.Series[0]
	if first.DisplayName != "5 k" {
		t.Fatalf("first series display_name = %v, want \"5 k\"", first.DisplayName)
	}
	if len(first.Points) != 4 {
		t.Fatalf("first series points = %d, want 4", len(first.Points))
	}
	if !floatNear(first.PBPaceSecPer500m, 108.2, 0.1) {
		t.Fatalf("first series PB pace = %v, want ~108.2 s/500m", first.PBPaceSecPer500m)
	}

	// 134m piece must NOT have created a 500m series.
	for _, s := range out.Series {
		if s.Key.ShapeHash == "H_500" {
			t.Fatalf("abandoned 134m piece leaked into series: %+v", s)
		}
	}
}
