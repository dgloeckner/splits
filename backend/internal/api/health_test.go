package api_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"
	"time"

	"github.com/gloeckner-daniel/splits/internal/api"
	"github.com/gloeckner-daniel/splits/internal/event"
	"github.com/gloeckner-daniel/splits/internal/pipeline"
	"github.com/gloeckner-daniel/splits/internal/storage"
	"github.com/gloeckner-daniel/splits/internal/stream"
	"github.com/gloeckner-daniel/splits/internal/workout"
)

func newTestRouter(t *testing.T) http.Handler {
	t.Helper()
	ch := make(chan event.Event)
	close(ch)
	db, err := storage.Open(filepath.Join(t.TempDir(), "t.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	return api.NewRouter(api.Inputs{
		Ring:        pipeline.NewRing(4),
		Broadcaster: stream.NewBroadcaster(ch),
		DB:          db.Handle(),
		WorkoutRepo: workout.NewRepo(db.Handle()),
		StartedAt:   time.Now(),
	})
}

func TestHealth_OK(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/api/health", nil)
	rec := httptest.NewRecorder()

	newTestRouter(t).ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	if ct := rec.Header().Get("Content-Type"); ct != "application/json" {
		t.Errorf("Content-Type = %q, want application/json", ct)
	}

	var body struct {
		Status string `json:"status"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode body: %v", err)
	}
	if body.Status != "ok" {
		t.Errorf("status field = %q, want %q", body.Status, "ok")
	}
}

// fakeSessions is a SessionActiveProvider returning a fixed snapshot.
type fakeSessions []event.Event

func (f fakeSessions) Snapshot() []event.Event { return f }

func decodeHealth(t *testing.T, h http.Handler) map[string]any {
	t.Helper()
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/health", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode body: %v", err)
	}
	return body
}

// ADR-0023 §1: the updater accepts a release only once /api/health
// reports its tag, so the stamp must reach the wire unchanged.
func TestHealth_ReportsBuildStamp(t *testing.T) {
	body := decodeHealth(t, api.HealthHandler(api.HealthInfo{Version: "v0.4.1", Commit: "abc1234"}))
	if body["version"] != "v0.4.1" || body["commit"] != "abc1234" {
		t.Errorf("version/commit = %v/%v, want v0.4.1/abc1234", body["version"], body["commit"])
	}
	if body["session_open"] != false {
		t.Errorf("session_open = %v, want false without a sessionizer", body["session_open"])
	}
}

func TestHealth_UnstampedBuildReportsDev(t *testing.T) {
	body := decodeHealth(t, newTestRouter(t))
	if body["version"] != "dev" || body["commit"] != "unknown" {
		t.Errorf("version/commit = %v/%v, want dev/unknown", body["version"], body["commit"])
	}
}

func TestHealth_SessionOpen(t *testing.T) {
	open := fakeSessions{
		{ID: 7, Kind: event.KindSessionStart, SessionID: "s1", SessionStart: &event.SessionStartPayload{}},
		{ID: 8, Kind: event.KindStroke, SessionID: "s1"},
	}
	if got := decodeHealth(t, api.HealthHandler(api.HealthInfo{Sessions: open}))["session_open"]; got != true {
		t.Errorf("session_open = %v with an open session, want true", got)
	}
	if got := decodeHealth(t, api.HealthHandler(api.HealthInfo{Sessions: fakeSessions{}}))["session_open"]; got != false {
		t.Errorf("session_open = %v with no session, want false", got)
	}
}

func TestHealth_MethodNotAllowed(t *testing.T) {
	// Go 1.22 method-specific routing: POST must not match "GET /api/health".
	req := httptest.NewRequest(http.MethodPost, "/api/health", nil)
	rec := httptest.NewRecorder()

	newTestRouter(t).ServeHTTP(rec, req)

	if rec.Code != http.StatusMethodNotAllowed {
		t.Errorf("status = %d, want 405", rec.Code)
	}
}
