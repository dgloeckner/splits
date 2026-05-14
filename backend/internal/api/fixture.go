package api

import (
	"encoding/json"
	"net/http"
)

// FixtureResumer is the minimal surface the HTTP layer needs from the
// fixture replayer to flip it from paused to running. The concrete
// implementation lives in internal/ipm. Decoupling via this interface
// keeps the api package free of an ipm dependency for resume control.
type FixtureResumer interface {
	// Resume releases the paused producer. Returns (true, "") when the
	// call actually transitioned paused→running, or (false, reason)
	// when no transition occurred (reason="already_running" etc.).
	Resume() (started bool, reason string)
}

// registerFixtureRoutes mounts dev-only test affordances on mux. The
// endpoint is registered only when devMode is true; in production
// builds the route table omits it entirely so chi/mux returns 404 by
// default. ctl may be nil in dev mode when no fixture is configured —
// the handler then reports "no_fixture" so e2e helpers can distinguish
// "wrong endpoint" (404) from "endpoint present but inert" (200).
func registerFixtureRoutes(mux *http.ServeMux, devMode bool, ctl FixtureResumer) {
	if !devMode {
		return
	}
	mux.HandleFunc("POST /test/fixture/resume", fixtureResumeHandler(ctl))
}

func fixtureResumeHandler(ctl FixtureResumer) http.HandlerFunc {
	return func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if ctl == nil {
			writeFixtureJSON(w, map[string]any{"started": false, "reason": "no_fixture"})
			return
		}
		started, reason := ctl.Resume()
		body := map[string]any{"started": started}
		if !started && reason != "" {
			body["reason"] = reason
		}
		writeFixtureJSON(w, body)
	}
}

func writeFixtureJSON(w http.ResponseWriter, v any) {
	_ = json.NewEncoder(w).Encode(v)
}
