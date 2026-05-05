package api

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gloeckner-daniel/splits/internal/rower"
	"github.com/gloeckner-daniel/splits/internal/storage"
)

func newAuthTestRouter(t *testing.T) (http.Handler, *rower.DeviceLink) {
	t.Helper()
	db, err := storage.Open(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	repo := rower.NewRepo(db.Handle())
	holder := rower.NewHolder()
	link := rower.NewDeviceLink(db.Handle())

	r := NewRouter(Inputs{
		DB:          db.Handle(),
		RowerRepo:   repo,
		RowerHolder: holder,
		DeviceLink:  link,
	})
	return r, link
}

func TestRequireRower_BypassRoutes(t *testing.T) {
	h, _ := newAuthTestRouter(t)
	cases := []struct {
		method, path string
		wantStatus   int // ≠401 — these are bypass routes
	}{
		{"GET", "/api/health", 200},
		{"GET", "/api/v1/active-rower", 404}, // no rower yet, returns 404 not 401
	}
	for _, c := range cases {
		req := httptest.NewRequest(c.method, c.path, nil)
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		if rec.Code == 401 {
			t.Errorf("%s %s should bypass auth, got 401", c.method, c.path)
		}
		if rec.Code != c.wantStatus {
			t.Errorf("%s %s: status=%d, want %d", c.method, c.path, rec.Code, c.wantStatus)
		}
	}
}

func TestRequireRower_GatedRoutesReject(t *testing.T) {
	h, _ := newAuthTestRouter(t)
	gated := []struct{ method, path string }{
		{"GET", "/api/v1/sessions"},
		{"GET", "/api/v1/sessions/abc"},
		{"GET", "/api/v1/sessions/abc/insights"},
		{"GET", "/api/v1/sessions/abc/samples"},
		{"DELETE", "/api/v1/sessions/abc"},
		{"GET", "/api/v1/rowers/abc/pbs"},
		{"GET", "/api/v1/rowers/abc/trends"},
		{"GET", "/api/v1/rowers/abc/lifetime"},
		{"GET", "/api/v1/rowers/abc/achievements"},
		{"GET", "/api/v1/sessions/abc/pb-banners"},
		{"PUT", "/api/v1/active-rower"},
		{"POST", "/api/v1/workouts"},
		{"POST", "/api/v1/favorites"},
		{"GET", "/api/v1/favorites"},
		{"GET", "/api/v1/stream"},
		{"GET", "/debug/ingest"},
		{"PATCH", "/api/v1/rowers/abc"},
	}
	for _, c := range gated {
		req := httptest.NewRequest(c.method, c.path, nil)
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		if rec.Code != 401 {
			t.Errorf("%s %s: status=%d, want 401", c.method, c.path, rec.Code)
		}
	}
}

func TestRequireRower_BootstrapAllowsFirstRower(t *testing.T) {
	h, link := newAuthTestRouter(t)

	// Empty DB → POST /rowers without prior pairing succeeds.
	req := httptest.NewRequest("POST", "/api/v1/rowers",
		strings.NewReader(`{"name":"First","color":"#ff6b6b"}`))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusCreated {
		t.Fatalf("bootstrap POST /rowers: status=%d body=%s", rec.Code, rec.Body.String())
	}

	// The auto-pair side-effect should make this device's cookie
	// usable for gated routes.
	cookie := rec.Header().Get("Set-Cookie")
	if !strings.Contains(cookie, "device_id=") {
		t.Fatalf("expected device_id cookie, got %q", cookie)
	}
	// Extract device_id value to check pairing exists.
	devID := strings.TrimPrefix(strings.SplitN(cookie, ";", 2)[0], "device_id=")
	paired, err := link.HasAnyPairing(req.Context(), devID)
	if err != nil || !paired {
		t.Fatalf("auto-pair failed: paired=%v err=%v", paired, err)
	}
}

func TestRequireRower_PostRowersBlockedAfterBootstrap(t *testing.T) {
	h, _ := newAuthTestRouter(t)

	// First POST: bootstrap, succeeds.
	req := httptest.NewRequest("POST", "/api/v1/rowers",
		strings.NewReader(`{"name":"First","color":"#ff6b6b"}`))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusCreated {
		t.Fatalf("first POST status=%d", rec.Code)
	}

	// Second POST from a *different* device (no shared cookie):
	// DB now has rower(s), device unpaired → 401.
	req2 := httptest.NewRequest("POST", "/api/v1/rowers",
		strings.NewReader(`{"name":"Intruder","color":"#ff6b6b"}`))
	req2.Header.Set("Content-Type", "application/json")
	rec2 := httptest.NewRecorder()
	h.ServeHTTP(rec2, req2)
	if rec2.Code != http.StatusUnauthorized {
		t.Fatalf("post-bootstrap POST from unpaired device: status=%d body=%s",
			rec2.Code, rec2.Body.String())
	}
}

func TestRequireRower_GetRowersHidesListFromUnpaired(t *testing.T) {
	h, _ := newAuthTestRouter(t)

	// Bootstrap a rower (paired device A).
	req := httptest.NewRequest("POST", "/api/v1/rowers",
		strings.NewReader(`{"name":"Hidden","color":"#ff6b6b"}`))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusCreated {
		t.Fatalf("bootstrap: %d", rec.Code)
	}

	// Device B (no cookie) hits GET /rowers — should see empty list.
	req2 := httptest.NewRequest("GET", "/api/v1/rowers", nil)
	rec2 := httptest.NewRecorder()
	h.ServeHTTP(rec2, req2)
	if rec2.Code != 200 {
		t.Fatalf("status: %d", rec2.Code)
	}
	if !strings.Contains(rec2.Body.String(), `"rowers":[]`) {
		t.Errorf("expected empty rowers list for unpaired device, got: %s", rec2.Body.String())
	}

	// Device A (with cookie) sees the rower.
	devCookie := strings.SplitN(rec.Header().Get("Set-Cookie"), ";", 2)[0]
	req3 := httptest.NewRequest("GET", "/api/v1/rowers", nil)
	req3.Header.Set("Cookie", devCookie)
	rec3 := httptest.NewRecorder()
	h.ServeHTTP(rec3, req3)
	if !strings.Contains(rec3.Body.String(), `"name":"Hidden"`) {
		t.Errorf("paired device should see rower, got: %s", rec3.Body.String())
	}
}

func TestRequireRower_PairedDevicePassesGate(t *testing.T) {
	h, _ := newAuthTestRouter(t)

	// Bootstrap a rower; the response sets the device cookie.
	req := httptest.NewRequest("POST", "/api/v1/rowers",
		strings.NewReader(`{"name":"Paired","color":"#ff6b6b"}`))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	cookie := rec.Header().Get("Set-Cookie")
	devCookie := strings.SplitN(cookie, ";", 2)[0]

	// Use the same cookie on a gated route — should pass auth and
	// succeed at the handler (404 if no such session, but not 401).
	req2 := httptest.NewRequest("GET", "/api/v1/sessions/missing", nil)
	req2.Header.Set("Cookie", devCookie)
	rec2 := httptest.NewRecorder()
	h.ServeHTTP(rec2, req2)
	if rec2.Code == http.StatusUnauthorized {
		t.Fatalf("paired device blocked: status=%d body=%s", rec2.Code, rec2.Body.String())
	}
}
