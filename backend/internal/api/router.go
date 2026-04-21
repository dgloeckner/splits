package api

import (
	"net/http"
	"time"

	"github.com/gloeckner-daniel/home-ergo/internal/pipeline"
	"github.com/gloeckner-daniel/home-ergo/internal/stream"
)

// Inputs aggregates the stateful dependencies the router needs from
// main.
type Inputs struct {
	Ring        *pipeline.Ring
	Broadcaster *stream.Broadcaster
	StartedAt   time.Time
}

// NewRouter builds the HTTP handler.
func NewRouter(in Inputs) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/health", healthHandler)
	mux.Handle("GET /api/v1/stream", stream.NewHandler(in.Ring, in.Broadcaster))
	mux.Handle("GET /debug/ingest", DebugIngestHandler(DebugIngestInputs{
		Ring:        in.Ring,
		Broadcaster: in.Broadcaster,
		StartedAt:   in.StartedAt,
	}))
	return Chain(mux, Recover(), Logging())
}
