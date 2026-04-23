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
	h := SessionsHandler(db.Handle())

	rec := doReq(t, h, "GET", "/api/v1/sessions")
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

func TestGetSessionByID(t *testing.T) {
	db := seedDB(t)
	h := SessionsHandler(db.Handle())

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
	h := SessionsHandler(db.Handle())

	rec := doReq(t, h, "GET", "/api/v1/sessions/nope")
	if rec.Code != 404 {
		t.Errorf("status = %d, want 404", rec.Code)
	}
}

func TestGetSessionSamples(t *testing.T) {
	db := seedDB(t)
	h := SessionsHandler(db.Handle())

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

func TestDeleteSessionSoftDeletes(t *testing.T) {
	db := seedDB(t)
	h := SessionsHandler(db.Handle())

	rec := doReq(t, h, "DELETE", "/api/v1/sessions/S1")
	if rec.Code != 204 {
		t.Errorf("status = %d, want 204", rec.Code)
	}

	rec = doReq(t, h, "GET", "/api/v1/sessions/S1")
	if rec.Code != 404 {
		t.Errorf("after delete, GET status = %d, want 404", rec.Code)
	}

	rec = doReq(t, h, "GET", "/api/v1/sessions")
	var body struct {
		Sessions []map[string]any `json:"sessions"`
	}
	_ = json.NewDecoder(rec.Body).Decode(&body)
	if len(body.Sessions) != 0 {
		t.Errorf("soft-deleted session still in list")
	}
}
