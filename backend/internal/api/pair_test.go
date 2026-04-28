package api

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gloeckner-daniel/splits/internal/rower"
	"github.com/gloeckner-daniel/splits/internal/storage"
)

// pairTestEnv wires the minimum router surface needed to exercise the
// mint and exchange endpoints: rower repo, device-link, pairing store.
type pairTestEnv struct {
	Handler http.Handler
	Repo    *rower.Repo
	Link    *rower.DeviceLink
	Holder  *rower.Holder
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
	holder := &rower.Holder{}
	mux := http.NewServeMux()
	mux.Handle("POST /api/v1/rowers/{id}/pairing-tokens",
		MintTokenHandler(repo, link, store, publicURL))
	mux.Handle("POST /api/v1/pair",
		PairExchangeHandler(repo, holder, link, store))
	h := Chain(mux, DeviceCookie(DeviceCookieOptions{}))
	return &pairTestEnv{Handler: h, Repo: repo, Link: link, Holder: holder}
}

// CreateRower inserts a rower via the repo and returns it.
func (e *pairTestEnv) CreateRower(t *testing.T, name string) *rower.Rower {
	t.Helper()
	r, err := e.Repo.Create(t.Context(), rower.CreateInput{Name: name, Color: "#ff6b6b"})
	if err != nil {
		t.Fatalf("create rower: %v", err)
	}
	return r
}

// PairDevice pairs a device with a rower via the link.
func (e *pairTestEnv) PairDevice(t *testing.T, deviceID, rowerID string) {
	t.Helper()
	if err := e.Link.Pair(t.Context(), deviceID, rowerID); err != nil {
		t.Fatalf("pair device: %v", err)
	}
}

// MintToken hits the mint endpoint with the given device cookie and
// returns the plaintext token.
func (e *pairTestEnv) MintToken(t *testing.T, deviceID, rowerID string) string {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost,
		"/api/v1/rowers/"+rowerID+"/pairing-tokens", nil)
	req.AddCookie(&http.Cookie{Name: "device_id", Value: deviceID})
	rec := httptest.NewRecorder()
	e.Handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("mint: want 200, got %d (body=%q)", rec.Code, rec.Body.String())
	}
	var body struct {
		Token string `json:"token"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
		t.Fatalf("decode mint body: %v", err)
	}
	return body.Token
}

// IsPaired returns whether (deviceID, rowerID) is in device_rowers.
func (e *pairTestEnv) IsPaired(t *testing.T, deviceID, rowerID string) bool {
	t.Helper()
	ok, err := e.Link.IsPaired(t.Context(), deviceID, rowerID)
	if err != nil {
		t.Fatalf("IsPaired: %v", err)
	}
	return ok
}

// GetActiveRower returns the active rower id for a device, or "".
func (e *pairTestEnv) GetActiveRower(t *testing.T, deviceID string) string {
	t.Helper()
	r, err := e.Repo.GetActiveForDevice(t.Context(), deviceID)
	if err != nil {
		t.Fatalf("GetActiveForDevice: %v", err)
	}
	if r == nil {
		return ""
	}
	return r.ID
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

func TestPairExchange_Success(t *testing.T) {
	t.Parallel()
	srv := newPairTestEnv(t, "https://example.com")
	alice := srv.CreateRower(t, "Alice")
	srv.PairDevice(t, "dev1", alice.ID)

	plain := srv.MintToken(t, "dev1", alice.ID)

	body := []byte(`{"token":"` + plain + `"}`)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/pair", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.AddCookie(&http.Cookie{Name: "device_id", Value: "dev2"})
	rec := httptest.NewRecorder()
	srv.Handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d (body=%q)", rec.Code, rec.Body.String())
	}
	if !srv.IsPaired(t, "dev2", alice.ID) {
		t.Fatal("dev2 should be paired with Alice after exchange")
	}
	if got := srv.GetActiveRower(t, "dev2"); got != alice.ID {
		t.Fatalf("active rower for dev2 = %q, want %q", got, alice.ID)
	}

	// Re-use must fail.
	rec2 := httptest.NewRecorder()
	srv.Handler.ServeHTTP(rec2, httptest.NewRequest(http.MethodPost, "/api/v1/pair", bytes.NewReader(body)))
	if rec2.Code != http.StatusGone {
		t.Fatalf("re-use: want 410, got %d (body=%q)", rec2.Code, rec2.Body.String())
	}
}

func TestPairExchange_UnknownToken_Returns410(t *testing.T) {
	t.Parallel()
	srv := newPairTestEnv(t, "https://example.com")
	body := []byte(`{"token":"never-existed"}`)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/pair", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	srv.Handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusGone {
		t.Fatalf("want 410, got %d", rec.Code)
	}
}

func TestPairExchange_MalformedBody_Returns400(t *testing.T) {
	t.Parallel()
	srv := newPairTestEnv(t, "https://example.com")
	req := httptest.NewRequest(http.MethodPost, "/api/v1/pair",
		bytes.NewReader([]byte("{not json}")))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	srv.Handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("want 400, got %d", rec.Code)
	}
}
