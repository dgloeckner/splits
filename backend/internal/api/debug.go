package api

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/gloeckner-daniel/home-ergo/internal/pipeline"
	"github.com/gloeckner-daniel/home-ergo/internal/stream"
)

type DebugIngestInputs struct {
	Ring        *pipeline.Ring
	Broadcaster *stream.Broadcaster
	StartedAt   time.Time
	Now         func() time.Time
}

func DebugIngestHandler(in DebugIngestInputs) http.Handler {
	if in.Now == nil {
		in.Now = time.Now
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		oldest, newest, size := in.Ring.Stats()
		body := map[string]any{
			"uptime_sec": int(in.Now().Sub(in.StartedAt).Seconds()),
			"ring": map[string]any{
				"size":      size,
				"oldest_id": oldest,
				"newest_id": newest,
			},
			"broadcaster": map[string]any{
				"clients":         in.Broadcaster.ClientCount(),
				"clients_dropped": in.Broadcaster.DroppedClients(),
			},
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(body)
	})
}
