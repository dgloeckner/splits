package api

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestRateLimit_BlocksOverBurst(t *testing.T) {
	t.Parallel()
	rl := RateLimit(RateLimitOptions{RPS: 1, Burst: 5})
	h := rl(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	hits, throttled := 0, 0
	for i := 0; i < 50; i++ {
		req := httptest.NewRequest(http.MethodGet, "/x", nil)
		req = req.WithContext(context.WithValue(req.Context(), deviceIDKey, "dev1"))
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		switch rec.Code {
		case http.StatusOK:
			hits++
		case http.StatusTooManyRequests:
			throttled++
		}
	}
	if hits == 0 {
		t.Fatal("expected some hits")
	}
	if throttled == 0 {
		t.Fatal("expected throttling once burst exhausted")
	}
}

func TestRateLimit_StreamEndpointBypass(t *testing.T) {
	t.Parallel()
	rl := RateLimit(RateLimitOptions{RPS: 1, Burst: 1})
	h := rl(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	for i := 0; i < 10; i++ {
		req := httptest.NewRequest(http.MethodGet, "/api/v1/stream", nil)
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("stream req %d got %d", i, rec.Code)
		}
	}
}
