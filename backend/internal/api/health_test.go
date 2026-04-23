package api_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"
	"time"

	"github.com/gloeckner-daniel/home-ergo/internal/api"
	"github.com/gloeckner-daniel/home-ergo/internal/event"
	"github.com/gloeckner-daniel/home-ergo/internal/pipeline"
	"github.com/gloeckner-daniel/home-ergo/internal/storage"
	"github.com/gloeckner-daniel/home-ergo/internal/stream"
	"github.com/gloeckner-daniel/home-ergo/internal/workout"
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

func TestHealth_MethodNotAllowed(t *testing.T) {
	// Go 1.22 method-specific routing: POST must not match "GET /api/health".
	req := httptest.NewRequest(http.MethodPost, "/api/health", nil)
	rec := httptest.NewRecorder()

	newTestRouter(t).ServeHTTP(rec, req)

	if rec.Code != http.StatusMethodNotAllowed {
		t.Errorf("status = %d, want 405", rec.Code)
	}
}
