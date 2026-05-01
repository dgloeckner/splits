package api

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestCORSGuard(t *testing.T) {
	t.Parallel()
	mw := CORSGuard("splits.example.de")
	h := mw(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	cases := []struct {
		name   string
		origin string
		want   int
	}{
		{"same origin matches", "https://splits.example.de", http.StatusOK},
		{"same origin with port path", "https://splits.example.de/foo", http.StatusOK},
		{"http variant matches host", "http://splits.example.de", http.StatusOK},
		{"foreign origin rejected", "https://attacker.example.com", http.StatusForbidden},
		{"no origin header passes", "", http.StatusOK},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, "/x", nil)
			if tc.origin != "" {
				req.Header.Set("Origin", tc.origin)
			}
			rec := httptest.NewRecorder()
			h.ServeHTTP(rec, req)
			if rec.Code != tc.want {
				t.Fatalf("want %d, got %d", tc.want, rec.Code)
			}
		})
	}
}

func TestCORSGuard_Disabled(t *testing.T) {
	t.Parallel()
	mw := CORSGuard("")
	h := mw(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	req := httptest.NewRequest(http.MethodGet, "/x", nil)
	req.Header.Set("Origin", "https://attacker.example.com")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("guard should be disabled, got %d", rec.Code)
	}
}
