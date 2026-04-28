package api

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gloeckner-daniel/home-ergo/internal/rower"
	"github.com/gloeckner-daniel/home-ergo/internal/storage"
)

func newRowerTestServer(t *testing.T) (http.Handler, *rower.Repo, *rower.Holder) {
	t.Helper()
	db, err := storage.Open(":memory:")
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })
	repo := rower.NewRepo(db.Handle())
	holder := rower.NewHolder()
	link := rower.NewDeviceLink(db.Handle())
	mux := http.NewServeMux()
	h := RowersHandler(repo, link)
	mux.Handle("GET /api/v1/rowers", h)
	mux.Handle("POST /api/v1/rowers", h)
	mux.Handle("PATCH /api/v1/rowers/{id}", h)
	a := ActiveRowerHandler(repo, holder, link)
	mux.Handle("GET /api/v1/active-rower", a)
	mux.Handle("PUT /api/v1/active-rower", a)
	return Chain(mux, DeviceCookie()), repo, holder
}

func TestRowers_CreateListPatch(t *testing.T) {
	h, _, _ := newRowerTestServer(t)

	// create
	body := `{"name":"Alice","weight_kg":70,"height_cm":172,"color":"#ff6b6b"}`
	req := httptest.NewRequest("POST", "/api/v1/rowers", bytes.NewBufferString(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusCreated {
		t.Fatalf("create status: %d body=%s", rec.Code, rec.Body.String())
	}
	var created struct {
		ID string `json:"id"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &created)
	if created.ID == "" {
		t.Fatalf("no id returned")
	}

	// list
	req2 := httptest.NewRequest("GET", "/api/v1/rowers", nil)
	rec2 := httptest.NewRecorder()
	h.ServeHTTP(rec2, req2)
	if rec2.Code != 200 {
		t.Fatalf("list status: %d", rec2.Code)
	}
	var list struct {
		Rowers []map[string]any `json:"rowers"`
	}
	_ = json.Unmarshal(rec2.Body.Bytes(), &list)
	if len(list.Rowers) != 1 {
		t.Fatalf("expected 1, got %d", len(list.Rowers))
	}

	// patch
	req3 := httptest.NewRequest("PATCH", "/api/v1/rowers/"+created.ID, bytes.NewBufferString(`{"name":"Alicia"}`))
	req3.Header.Set("Content-Type", "application/json")
	rec3 := httptest.NewRecorder()
	h.ServeHTTP(rec3, req3)
	if rec3.Code != 200 {
		t.Fatalf("patch status: %d body=%s", rec3.Code, rec3.Body.String())
	}
	var patched map[string]any
	_ = json.Unmarshal(rec3.Body.Bytes(), &patched)
	if patched["name"] != "Alicia" {
		t.Fatalf("patched name: %+v", patched)
	}
}

func TestActiveRower_PUT_RejectsUnpairedRower(t *testing.T) {
	h, repo, _ := newRowerTestServer(t)

	// Create a rower directly via the repo so no device is auto-paired.
	r, err := repo.Create(t.Context(), rower.CreateInput{Name: "Solo", Color: "#ff6b6b"})
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	body := `{"rower_id":"` + r.ID + `"}`
	req := httptest.NewRequest("PUT", "/api/v1/active-rower", bytes.NewBufferString(body))
	req.Header.Set("Content-Type", "application/json")
	// fresh device cookie, never paired with r
	req.AddCookie(&http.Cookie{Name: "device_id", Value: "device-without-pairing"})
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusForbidden {
		t.Fatalf("want 403, got %d body=%s", rec.Code, rec.Body.String())
	}
}

func TestRowers_CreateRejectsEmptyName(t *testing.T) {
	h, _, _ := newRowerTestServer(t)
	req := httptest.NewRequest("POST", "/api/v1/rowers", bytes.NewBufferString(`{"name":""}`))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("want 400, got %d", rec.Code)
	}
}
