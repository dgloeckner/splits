package stream

import (
	"fmt"
	"net/http"
	"strconv"
	"time"

	"github.com/gloeckner-daniel/home-ergo/internal/event"
	"github.com/gloeckner-daniel/home-ergo/internal/pipeline"
)

// Snapshotter returns a set of synthetic events describing the
// current open session state. Used to bring reconnecting clients up
// to date when their cursor is already past those events in the ring.
type Snapshotter interface {
	Snapshot() []event.Event
}

// maxEventIDer lets the SSE handler ask the sessionizer for the
// highest event id it has emitted, so a stale Last-Event-ID from a
// previous backend run can't silently filter out all new events.
type maxEventIDer interface {
	MaxEventID() uint64
}

// NewHandler returns the /api/v1/stream handler. Auth is the caller's
// responsibility (middleware); this handler assumes the request has
// been authenticated.
func NewHandler(ring *pipeline.Ring, b *Broadcaster, snap Snapshotter) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		flusher, ok := w.(http.Flusher)
		if !ok {
			http.Error(w, "streaming unsupported", http.StatusInternalServerError)
			return
		}

		w.Header().Set("Content-Type", "text/event-stream; charset=utf-8")
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("Connection", "keep-alive")
		w.WriteHeader(http.StatusOK)

		afterID := parseAfterID(r)
		// Guard against stale Last-Event-ID from a previous backend
		// run: if the cursor is past anything the sessionizer could
		// have emitted, reset to 0 so new events aren't silently
		// filtered out.
		if maxer, ok := snap.(maxEventIDer); ok {
			if cur := maxer.MaxEventID(); afterID > cur {
				afterID = 0
			}
		}

		// If the client's cursor is past the current session's open
		// events (ring won't replay them), emit the snapshot first so
		// the client can rebuild basic session state.
		sentSnapshot := map[uint64]bool{}
		if snap != nil {
			for _, e := range snap.Snapshot() {
				if e.ID <= afterID {
					if err := writeSSE(w, flusher, e); err != nil {
						return
					}
					sentSnapshot[e.ID] = true
				}
			}
		}

		for _, e := range ring.Since(afterID) {
			if sentSnapshot[e.ID] {
				continue
			}
			if err := writeSSE(w, flusher, e); err != nil {
				return
			}
			if e.ID > afterID {
				afterID = e.ID
			}
		}

		ch := b.Subscribe(afterID)
		ticker := time.NewTicker(20 * time.Second)
		defer ticker.Stop()

		for {
			select {
			case <-r.Context().Done():
				return
			case e, ok := <-ch:
				if !ok {
					return
				}
				if e.ID <= afterID {
					continue
				}
				if err := writeSSE(w, flusher, e); err != nil {
					return
				}
				afterID = e.ID
			case <-ticker.C:
				if _, err := fmt.Fprintf(w, "event: ping\ndata: {}\n\n"); err != nil {
					return
				}
				flusher.Flush()
			}
		}
	})
}

func parseAfterID(r *http.Request) uint64 {
	if s := r.URL.Query().Get("since"); s != "" {
		if v, err := strconv.ParseUint(s, 10, 64); err == nil {
			return v
		}
	}
	if s := r.Header.Get("Last-Event-ID"); s != "" {
		if v, err := strconv.ParseUint(s, 10, 64); err == nil {
			return v
		}
	}
	return 0
}

func writeSSE(w http.ResponseWriter, f http.Flusher, e event.Event) error {
	name := event.EventName(e.Kind)
	if name == "" {
		return nil
	}
	data, err := event.Marshal(e)
	if err != nil {
		return err
	}
	if _, err := fmt.Fprintf(w, "event: %s\nid: %d\ndata: %s\n\n", name, e.ID, data); err != nil {
		return err
	}
	f.Flush()
	return nil
}
