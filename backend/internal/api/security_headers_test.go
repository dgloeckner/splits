package api

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestSecurityHeaders(t *testing.T) {
	t.Parallel()
	mw := SecurityHeaders()
	h := mw(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(200) }))
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/x", nil))
	cases := []struct{ k, v string }{
		{"X-Content-Type-Options", "nosniff"},
		{"X-Frame-Options", "DENY"},
		{"Referrer-Policy", "no-referrer"},
		{"Strict-Transport-Security", "max-age=31536000"},
		{"Content-Security-Policy", "default-src 'self'"},
	}
	for _, c := range cases {
		if got := rec.Header().Get(c.k); !strings.Contains(got, c.v) {
			t.Errorf("%s: want contains %q, got %q", c.k, c.v, got)
		}
	}
}
