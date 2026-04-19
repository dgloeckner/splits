package api

import "net/http"

// NewRouter builds the HTTP handler for the backend. In M1 it serves
// only /api/health; M2 will add /api/v1/stream and /debug/ingest.
func NewRouter() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/health", healthHandler)
	return Chain(mux, Recover(), Logging())
}
