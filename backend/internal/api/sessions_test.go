package api

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/gloeckner-daniel/home-ergo/internal/event"
	"github.com/gloeckner-daniel/home-ergo/internal/storage"
)

func seedDB(t *testing.T) *storage.DB {
	t.Helper()
	db, err := storage.Open(filepath.Join(t.TempDir(), "t.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })

	ctx := context.Background()
	started := time.Date(2026, 4, 21, 10, 0, 0, 0, time.UTC)
	if err := storage.InsertSession(ctx, db.Handle(), "S1", "R1", started, 3, ""); err != nil {
		t.Fatal(err)
	}
	for i := 1; i <= 3; i++ {
		p := event.StrokePayload{StrokeNo: i, TimeSec: float64(i), DistanceM: i * 4,
			SPM: 25, PowerW: 200, CalPerHr: 1000, Level: 3,
			DPS: 4, StrokeCycleSec: 1, PaceSecPer500m: 125, EnergyJoules: 200}
		if err := storage.InsertStroke(ctx, db.Handle(), uint64(i), "S1", started, p); err != nil {
			t.Fatal(err)
		}
	}
	if err := storage.UpdateSessionEnd(ctx, db.Handle(), "S1",
		started.Add(time.Minute),
		event.SessionSummary{TotalDistanceM: 12, TotalTimeSec: 3, TotalStrokes: 3,
			AvgPaceSecPer500m: 125}); err != nil {
		t.Fatal(err)
	}
	return db
}

func doReq(t *testing.T, mux http.Handler, method, target string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(method, target, nil)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	return rec
}

func TestGetSessionsList(t *testing.T) {
	db := seedDB(t)
	h := SessionsHandler(db.Handle(), nil, nil)

	rec := doReq(t, h, "GET", "/api/v1/sessions?rower_id=R1")
	if rec.Code != 200 {
		t.Fatalf("status = %d, body=%s", rec.Code, rec.Body.String())
	}
	var body struct {
		Sessions []map[string]any `json:"sessions"`
	}
	_ = json.NewDecoder(rec.Body).Decode(&body)
	if len(body.Sessions) != 1 {
		t.Errorf("got %d sessions", len(body.Sessions))
	}
	if body.Sessions[0]["id"] != "S1" {
		t.Errorf("id = %v", body.Sessions[0]["id"])
	}
}

func TestListSessions_MissingRowerID_Returns400(t *testing.T) {
	t.Parallel()
	db := seedDB(t)
	h := SessionsHandler(db.Handle(), nil, nil)

	rec := doReq(t, h, "GET", "/api/v1/sessions?limit=10")
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("want 400, got %d", rec.Code)
	}
}

func TestGetSessionByID(t *testing.T) {
	db := seedDB(t)
	h := SessionsHandler(db.Handle(), nil, nil)

	rec := doReq(t, h, "GET", "/api/v1/sessions/S1")
	if rec.Code != 200 {
		t.Fatalf("status = %d", rec.Code)
	}
	body, _ := io.ReadAll(rec.Body)
	if !strings.Contains(string(body), `"id":"S1"`) {
		t.Errorf("body missing id: %s", body)
	}
}

func TestGetSessionByIDNotFound(t *testing.T) {
	db := seedDB(t)
	h := SessionsHandler(db.Handle(), nil, nil)

	rec := doReq(t, h, "GET", "/api/v1/sessions/nope")
	if rec.Code != 404 {
		t.Errorf("status = %d, want 404", rec.Code)
	}
}

func TestGetSessionSamplesNotFound(t *testing.T) {
	db := seedDB(t)
	h := SessionsHandler(db.Handle(), nil, nil)

	rec := doReq(t, h, "GET", "/api/v1/sessions/nope/samples")
	if rec.Code != http.StatusNotFound {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusNotFound)
	}
}

func TestGetSessionSamples(t *testing.T) {
	db := seedDB(t)
	h := SessionsHandler(db.Handle(), nil, nil)

	rec := doReq(t, h, "GET", "/api/v1/sessions/S1/samples")
	if rec.Code != 200 {
		t.Fatalf("status = %d", rec.Code)
	}
	var body struct {
		Samples []map[string]any `json:"samples"`
	}
	_ = json.NewDecoder(rec.Body).Decode(&body)
	if len(body.Samples) != 3 {
		t.Errorf("got %d samples", len(body.Samples))
	}
}

func TestGetSessionSamplesFromSummary(t *testing.T) {
	// Simulate a compacted session: strokes deleted, summary has Samples with DPS+SPI.
	db, err := storage.Open(filepath.Join(t.TempDir(), "t.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	ctx := context.Background()
	started := time.Date(2026, 4, 21, 10, 0, 0, 0, time.UTC)
	if err := storage.InsertSession(ctx, db.Handle(), "S2", "R1", started, 3, ""); err != nil {
		t.Fatal(err)
	}
	// Compacted session: store summary_json with Samples, no stroke rows.
	summary := event.SessionSummary{
		TotalDistanceM:    100,
		TotalTimeSec:      60,
		TotalStrokes:      10,
		AvgPaceSecPer500m: 125,
		AvgSPI:            8,
		Samples: &event.SessionSamples{
			BucketStrokes: 5,
			T:             []float64{10.0, 20.0},
			Split:         []int{125, 130},
			Watt:          []int{200, 210},
			SPM:           []int{25, 26},
			DPS:           []float64{8.5, 9.0},
			SPI:           []int{8, 8},
		},
	}
	if err := storage.UpdateSessionEnd(ctx, db.Handle(), "S2", started.Add(time.Minute), summary); err != nil {
		t.Fatal(err)
	}

	h := SessionsHandler(db.Handle(), nil, nil)
	rec := doReq(t, h, "GET", "/api/v1/sessions/S2/samples")
	if rec.Code != 200 {
		t.Fatalf("status = %d, body=%s", rec.Code, rec.Body.String())
	}
	var body struct {
		Samples []map[string]any `json:"samples"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
		t.Fatal(err)
	}
	if len(body.Samples) != 2 {
		t.Fatalf("got %d samples, want 2", len(body.Samples))
	}
	// DPS and SPI should be non-zero.
	dps0, _ := body.Samples[0]["dps"].(float64)
	if dps0 == 0 {
		t.Errorf("samples[0].dps = 0, want non-zero (from summary)")
	}
	spi0, _ := body.Samples[0]["spi"].(float64)
	if spi0 == 0 {
		t.Errorf("samples[0].spi = 0, want non-zero (from summary)")
	}
}

type fakeActive struct{ id string }

func (f fakeActive) ActiveSessionID() string { return f.id }

func TestDeleteSession_ActiveSession_Returns409(t *testing.T) {
	t.Parallel()
	db := seedDB(t)
	h := SessionsHandler(db.Handle(), nil, fakeActive{id: "S1"})

	rec := doReq(t, h, "DELETE", "/api/v1/sessions/S1")
	if rec.Code != http.StatusConflict {
		t.Fatalf("status = %d, want 409 (body=%s)", rec.Code, rec.Body.String())
	}

	// Sanity: the session row should still exist.
	rec = doReq(t, h, "GET", "/api/v1/sessions/S1")
	if rec.Code != http.StatusOK {
		t.Errorf("after rejected DELETE, GET status = %d, want 200", rec.Code)
	}
}

func TestDeleteSessionSoftDeletes(t *testing.T) {
	db := seedDB(t)
	h := SessionsHandler(db.Handle(), nil, nil)

	rec := doReq(t, h, "DELETE", "/api/v1/sessions/S1")
	if rec.Code != 204 {
		t.Errorf("status = %d, want 204", rec.Code)
	}

	rec = doReq(t, h, "GET", "/api/v1/sessions/S1")
	if rec.Code != 404 {
		t.Errorf("after delete, GET status = %d, want 404", rec.Code)
	}

	rec = doReq(t, h, "GET", "/api/v1/sessions?rower_id=R1")
	var body struct {
		Sessions []map[string]any `json:"sessions"`
	}
	_ = json.NewDecoder(rec.Body).Decode(&body)
	if len(body.Sessions) != 0 {
		t.Errorf("soft-deleted session still in list")
	}
}
