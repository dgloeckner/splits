package api

import (
	"net/http"
	"sync"
	"time"

	"golang.org/x/time/rate"
)

type RateLimitOptions struct {
	RPS   float64
	Burst int
}

type rlEntry struct {
	lim  *rate.Limiter
	seen time.Time
}

// RateLimit enforces a per-device-cookie token bucket. Defaults: 6 rps,
// burst 60. /api/v1/stream is exempt (long-lived SSE). Idle entries
// older than 10 minutes are GC'd.
func RateLimit(opts RateLimitOptions) Middleware {
	if opts.RPS == 0 {
		opts.RPS = 6
	}
	if opts.Burst == 0 {
		opts.Burst = 60
	}
	var (
		mu      sync.Mutex
		entries = map[string]*rlEntry{}
	)
	go func() {
		t := time.NewTicker(time.Minute)
		for range t.C {
			mu.Lock()
			cutoff := time.Now().Add(-10 * time.Minute)
			for k, e := range entries {
				if e.seen.Before(cutoff) {
					delete(entries, k)
				}
			}
			mu.Unlock()
		}
	}()
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.URL.Path == "/api/v1/stream" {
				next.ServeHTTP(w, r)
				return
			}
			id := DeviceIDFromContext(r.Context())
			if id == "" {
				id = r.RemoteAddr
			}
			mu.Lock()
			e, ok := entries[id]
			if !ok {
				e = &rlEntry{lim: rate.NewLimiter(rate.Limit(opts.RPS), opts.Burst)}
				entries[id] = e
			}
			e.seen = time.Now()
			mu.Unlock()
			if !e.lim.Allow() {
				http.Error(w, "rate limit exceeded", http.StatusTooManyRequests)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}
