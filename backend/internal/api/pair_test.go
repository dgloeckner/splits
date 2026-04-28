package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gloeckner-daniel/splits/internal/rower"
	"github.com/gloeckner-daniel/splits/internal/storage"
)

// pairTestEnv wires the minimum router surface needed to exercise the
// mint endpoint: rower repo, device-link, pairing store. Mirrors the
// pattern in newRowerTestServer but adds the POST .../pairing-tokens
// route.
type pairTestEnv struct {
	Handler http.Handler
	Repo    *rower.Repo
	Link    *rower.DeviceLink
}

func newPairTestEnv(t *testing.T, publicURL string) *pairTestEnv {
	t.Helper()
	db, err := storage.Open(":memory:")
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })
	repo := rower.NewRepo(db.Handle())
	link := rower.NewDeviceLink(db.Handle())
	store := rower.NewPairingStore(db.Handle())
	mux := http.NewServeMux()
	mux.Handle("POST /api/v1/rowers/{id}/pairing-tokens",
		MintTokenHandler(repo, link, store, publicURL))
	h := Chain(mux, DeviceCookie(DeviceCookieOptions{}))
	return &pairTestEnv{Handler: h, Repo: repo, Link: link}
}

func TestMintPairingToken_Returns200WithURLAndQR(t *testing.T) {
	t.Parallel()
	env := newPairTestEnv(t, "https://example.com")
	r, err := env.Repo.Create(t.Context(), rower.CreateInput{Name: "Alice", Color: "#ff6b6b"})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if err := env.Link.Pair(t.Context(), "dev1", r.ID); err != nil {
		t.Fatalf("pair: %v", err)
	}

	req := httptest.NewRequest(http.MethodPost,
		"/api/v1/rowers/"+r.ID+"/pairing-tokens", nil)
	req.AddCookie(&http.Cookie{Name: "device_id", Value: "dev1"})
	rec := httptest.NewRecorder()
	env.Handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d (body=%q)", rec.Code, rec.Body.String())
	}
	var body struct {
		Token     string `json:"token"`
		URL       string `json:"url"`
		QRSVG     string `json:"qr_svg"`
		ExpiresAt string `json:"expires_at"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
		t.Fatal(err)
	}
	if len(body.Token) < 40 {
		t.Fatalf("token too short: %q", body.Token)
	}
	if !strings.Contains(body.URL, "/pair#t="+body.Token) {
		t.Fatalf("url missing token fragment: %q", body.URL)
	}
	if !strings.HasPrefix(body.URL, "https://example.com") {
		t.Fatalf("url should use configured PublicURL: %q", body.URL)
	}
	if !strings.Contains(body.QRSVG, "<svg") {
		t.Fatalf("qr_svg not svg: %q", body.QRSVG)
	}
	if body.ExpiresAt == "" {
		t.Fatalf("expires_at empty")
	}
}

func TestMintPairingToken_RejectsUnpairedDevice(t *testing.T) {
	t.Parallel()
	env := newPairTestEnv(t, "https://example.com")
	r, err := env.Repo.Create(t.Context(), rower.CreateInput{Name: "Alice", Color: "#ff6b6b"})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	// dev2 is NOT paired (only the implicit creator pairing exists, and
	// repo.Create at the repo layer doesn't pair anything — that's the
	// rowers handler's job).
	req := httptest.NewRequest(http.MethodPost,
		"/api/v1/rowers/"+r.ID+"/pairing-tokens", nil)
	req.AddCookie(&http.Cookie{Name: "device_id", Value: "dev2"})
	rec := httptest.NewRecorder()
	env.Handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("want 403, got %d", rec.Code)
	}
}

func TestMintPairingToken_RejectsUnknownRower(t *testing.T) {
	t.Parallel()
	env := newPairTestEnv(t, "https://example.com")
	req := httptest.NewRequest(http.MethodPost,
		"/api/v1/rowers/missing/pairing-tokens", nil)
	req.AddCookie(&http.Cookie{Name: "device_id", Value: "dev1"})
	rec := httptest.NewRecorder()
	env.Handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("want 404, got %d", rec.Code)
	}
}

func TestMintPairingToken_FallsBackToRequestHost(t *testing.T) {
	t.Parallel()
	env := newPairTestEnv(t, "") // empty PublicURL → derive from Host
	r, err := env.Repo.Create(t.Context(), rower.CreateInput{Name: "Alice", Color: "#ff6b6b"})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if err := env.Link.Pair(t.Context(), "dev1", r.ID); err != nil {
		t.Fatalf("pair: %v", err)
	}
	req := httptest.NewRequest(http.MethodPost,
		"/api/v1/rowers/"+r.ID+"/pairing-tokens", nil)
	req.Host = "splits.local"
	req.AddCookie(&http.Cookie{Name: "device_id", Value: "dev1"})
	rec := httptest.NewRecorder()
	env.Handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d (body=%q)", rec.Code, rec.Body.String())
	}
	var body struct {
		URL string `json:"url"`
	}
	_ = json.NewDecoder(rec.Body).Decode(&body)
	if !strings.HasPrefix(body.URL, "https://splits.local/pair#t=") {
		t.Fatalf("url should derive from Host: %q", body.URL)
	}
}
