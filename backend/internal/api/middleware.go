// Package api wires the HTTP surface. See specs/arch/0001-backend-pipeline.md.
package api

import (
	"log/slog"
	"net/http"
	"runtime/debug"
	"time"
)

// Middleware is the standard "wrap a handler" function shape.
type Middleware func(http.Handler) http.Handler

// Chain composes middlewares left-to-right: Chain(h, a, b) wraps as a(b(h)).
func Chain(h http.Handler, mws ...Middleware) http.Handler {
	for i := len(mws) - 1; i >= 0; i-- {
		h = mws[i](h)
	}
	return h
}

// Recover turns a handler panic into a 500 and a structured log entry.
func Recover() Middleware {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			defer func() {
				if rec := recover(); rec != nil {
					slog.Error("http.panic",
						"err", rec,
						"path", r.URL.Path,
						"stack", string(debug.Stack()),
					)
					http.Error(w, "internal server error", http.StatusInternalServerError)
				}
			}()
			next.ServeHTTP(w, r)
		})
	}
}

const defaultBodyLimit int64 = 256 * 1024 // 256 KiB

// BodyLimit caps request bodies at maxBytes (defaults to 256 KiB
// when maxBytes <= 0). When the limit is exceeded, MaxBytesReader
// writes a 413 to the response and the underlying Read returns an
// error to the handler.
func BodyLimit(maxBytes int64) Middleware {
	if maxBytes <= 0 {
		maxBytes = defaultBodyLimit
	}
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.Body != nil {
				r.Body = http.MaxBytesReader(w, r.Body, maxBytes)
			}
			next.ServeHTTP(w, r)
		})
	}
}

// Logging records one structured log line per completed request.
func Logging() Middleware {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			start := time.Now()
			lrw := &loggingResponseWriter{ResponseWriter: w, status: http.StatusOK}
			next.ServeHTTP(lrw, r)
			slog.Info("http.request",
				"method", r.Method,
				"path", r.URL.Path,
				"status", lrw.status,
				"duration_ms", time.Since(start).Milliseconds(),
			)
		})
	}
}

type loggingResponseWriter struct {
	http.ResponseWriter
	status int
}

func (w *loggingResponseWriter) WriteHeader(code int) {
	w.status = code
	w.ResponseWriter.WriteHeader(code)
}

// Flush forwards to the underlying ResponseWriter when it implements
// http.Flusher. SSE (M2) needs Flush on every event to push bytes to
// the client immediately; without this, the wrapped writer hides the
// Flusher interface from the handler.
func (w *loggingResponseWriter) Flush() {
	if f, ok := w.ResponseWriter.(http.Flusher); ok {
		f.Flush()
	}
}
