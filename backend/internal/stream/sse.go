package stream

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"time"

	"github.com/gloeckner-daniel/splits/internal/event"
	"github.com/gloeckner-daniel/splits/internal/ipm"
	"github.com/gloeckner-daniel/splits/internal/pipeline"
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
// been authenticated. monitor may be nil — the handler falls back to
// emitting no `device` events in that case.
func NewHandler(ring *pipeline.Ring, b *Broadcaster, snap Snapshotter, monitor *ipm.DeviceMonitor) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		flusher, ok := w.(http.Flusher)
		if !ok {
			http.Error(w, "streaming unsupported", http.StatusInternalServerError)
			return
		}

		w.Header().Set("Content-Type", "text/event-stream; charset=utf-8")
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("Connection", "keep-alive")
		// Hint reverse proxies (Caddy, nginx, Vite dev) not to buffer
		// this stream — without it headers can sit in the proxy
		// until the first body write, and the browser's EventSource
		// `onopen` (which is what flips the UI indicator to green)
		// doesn't fire until headers arrive. With no events queued
		// that delay is ~20 s (next ping tick). Cf. Vite issue
		// #11434.
		w.Header().Set("X-Accel-Buffering", "no")
		w.WriteHeader(http.StatusOK)
		// Emit an SSE comment + flush so the client transitions to
		// `open` immediately. Comments are ignored by the
		// EventSource parser; they exist exactly for this kind of
		// keep-alive / header-flush trick.
		_, _ = fmt.Fprint(w, ": ready\n\n")
		flusher.Flush()

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

		// Subscribe BEFORE replaying the ring so that any event whose
		// fanout lands in the replay window is buffered on ch rather than
		// silently lost. The live-loop below deduplicates via the
		// `e.ID <= afterID` guard.
		ch := b.Subscribe()

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

		ticker := time.NewTicker(20 * time.Second)
		defer ticker.Stop()

		// Initial device-state push + change subscription. Sending the
		// current state on connect lets the client render the banner
		// immediately without a separate /api/v1/device fetch.
		var deviceCh <-chan ipm.DeviceState
		var deviceCleanup func()
		if monitor != nil {
			if err := writeDeviceSSE(w, flusher, monitor.State()); err != nil {
				return
			}
			deviceCh, deviceCleanup = monitor.Subscribe()
			defer deviceCleanup()
		}

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
			case ds, ok := <-deviceCh:
				if !ok {
					deviceCh = nil
					continue
				}
				if err := writeDeviceSSE(w, flusher, ds); err != nil {
					return
				}
			case <-ticker.C:
				if _, err := fmt.Fprintf(w, "event: ping\ndata: {}\n\n"); err != nil {
					return
				}
				flusher.Flush()
			}
		}
	})
}

func writeDeviceSSE(w http.ResponseWriter, f http.Flusher, ds ipm.DeviceState) error {
	data, err := json.Marshal(ds)
	if err != nil {
		return err
	}
	if _, err := fmt.Fprintf(w, "event: device\ndata: %s\n\n", data); err != nil {
		return err
	}
	f.Flush()
	return nil
}

func parseAfterID(r *http.Request) uint64 {
	// Last-Event-ID is set by the browser's EventSource on reconnects and
	// always reflects the last event the client actually received, making
	// it more authoritative than ?since= which is a static URL parameter
	// baked in at page load. Check the header first.
	if s := r.Header.Get("Last-Event-ID"); s != "" {
		if v, err := strconv.ParseUint(s, 10, 64); err == nil {
			return v
		}
	}
	if s := r.URL.Query().Get("since"); s != "" {
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
