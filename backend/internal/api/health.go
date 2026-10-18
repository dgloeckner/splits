package api

import (
	"encoding/json"
	"net/http"

	"github.com/gloeckner-daniel/splits/internal/event"
)

// HealthInfo is what GET /api/health reports besides "ok". Version and
// Commit are the build stamp (-ldflags -X, see deploy/build.sh); the
// unattended updater accepts a new release only once this endpoint
// reports its tag (ADR-0023 §3). Sessions, when set, answers
// session_open — the updater refuses to touch a Pi somebody is rowing on.
type HealthInfo struct {
	Version  string
	Commit   string
	Sessions SessionActiveProvider
}

// HealthHandler serves GET /api/health. Ungated and NetworkOnly in the
// service worker: it is also the PWA's reachability probe (ADR-0020).
func HealthHandler(info HealthInfo) http.Handler {
	version, commit := info.Version, info.Commit
	if version == "" {
		version = "dev"
	}
	if commit == "" {
		commit = "unknown"
	}
	return http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		open := false
		if info.Sessions != nil {
			open = openSessionStart(info.Sessions.Snapshot()) != nil
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"status":       "ok",
			"version":      version,
			"commit":       commit,
			"session_open": open,
		})
	})
}

// openSessionStart returns the session_start event of the currently
// open session in a sessionizer snapshot, or nil when none is open.
func openSessionStart(snap []event.Event) *event.Event {
	var start *event.Event
	for i := range snap {
		if snap[i].Kind == event.KindSessionStart {
			start = &snap[i]
		}
	}
	return start
}
