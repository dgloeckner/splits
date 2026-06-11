package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
)

// stubFixtureControl is an in-memory FixtureResumer for tests.
type stubFixtureControl struct {
	mu      sync.Mutex
	running bool
	paused  bool
}

func (s *stubFixtureControl) Resume() (bool, string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.running {
		return false, "already_running"
	}
	s.running = true
	s.paused = false
	return true, ""
}

func (s *stubFixtureControl) Pause() (bool, string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.paused {
		return false, "already_paused"
	}
	s.paused = true
	s.running = false
	return true, ""
}

func TestFixtureResume_StartsWhenPaused(t *testing.T) {
	ctl := &stubFixtureControl{}
	mux := http.NewServeMux()
	registerFixtureRoutes(mux, true, ctl)

	req := httptest.NewRequest(http.MethodPost, "/test/fixture/resume", nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", w.Code, w.Body.String())
	}
	var got map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &got); err != nil {
		t.Fatalf("json: %v", err)
	}
	if started, _ := got["started"].(bool); !started {
		t.Errorf("started = %v, want true; body=%s", got["started"], w.Body.String())
	}
}

func TestFixtureResume_Idempotent(t *testing.T) {
	ctl := &stubFixtureControl{}
	mux := http.NewServeMux()
	registerFixtureRoutes(mux, true, ctl)

	// First call starts.
	r1 := httptest.NewRecorder()
	mux.ServeHTTP(r1, httptest.NewRequest(http.MethodPost, "/test/fixture/resume", nil))
	if r1.Code != http.StatusOK {
		t.Fatalf("first: status = %d", r1.Code)
	}

	// Second call: already_running.
	r2 := httptest.NewRecorder()
	mux.ServeHTTP(r2, httptest.NewRequest(http.MethodPost, "/test/fixture/resume", nil))
	if r2.Code != http.StatusOK {
		t.Fatalf("second: status = %d", r2.Code)
	}
	var got map[string]any
	if err := json.Unmarshal(r2.Body.Bytes(), &got); err != nil {
		t.Fatalf("json: %v", err)
	}
	if started, _ := got["started"].(bool); started {
		t.Errorf("started = true, want false")
	}
	if reason, _ := got["reason"].(string); reason != "already_running" {
		t.Errorf("reason = %q, want already_running", reason)
	}
}

func TestFixtureResume_NoFixture(t *testing.T) {
	// Dev mode but no fixture configured → handler returns no_fixture.
	mux := http.NewServeMux()
	registerFixtureRoutes(mux, true, nil)

	req := httptest.NewRequest(http.MethodPost, "/test/fixture/resume", nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", w.Code, w.Body.String())
	}
	var got map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &got); err != nil {
		t.Fatalf("json: %v", err)
	}
	if started, _ := got["started"].(bool); started {
		t.Errorf("started = true, want false")
	}
	if reason, _ := got["reason"].(string); reason != "no_fixture" {
		t.Errorf("reason = %q, want no_fixture", reason)
	}
}

func TestFixtureResume_NotInDevMode_404(t *testing.T) {
	ctl := &stubFixtureControl{}
	mux := http.NewServeMux()
	registerFixtureRoutes(mux, false, ctl)

	req := httptest.NewRequest(http.MethodPost, "/test/fixture/resume", nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404; body=%s", w.Code, w.Body.String())
	}
}

func TestFixtureResume_WrongMethod(t *testing.T) {
	ctl := &stubFixtureControl{}
	mux := http.NewServeMux()
	registerFixtureRoutes(mux, true, ctl)

	req := httptest.NewRequest(http.MethodGet, "/test/fixture/resume", nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	// http.ServeMux routes by method pattern; GET is unregistered → 405 (Go 1.22+) or just not matched.
	if w.Code != http.StatusMethodNotAllowed && w.Code != http.StatusNotFound {
		t.Errorf("status = %d, want 404/405; body=%s", w.Code, strings.TrimSpace(w.Body.String()))
	}
}
