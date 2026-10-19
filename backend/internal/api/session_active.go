package api

import (
	"encoding/json"
	"net/http"

	"github.com/gloeckner-daniel/splits/internal/event"
)

// SessionActiveProvider is satisfied by the sessionizer. Returns the
// currently open session_start event (with id) and the highest event
// id observed for it, or nil if no session is open.
type SessionActiveProvider interface {
	Snapshot() []event.Event
}

// SessionActiveHandler exposes the currently-open session for the
// Live page to re-attach after a tab close, reload, or device
// switch (FEAT-0009 acceptance "live re-access"). 204 when no
// session is open.
func SessionActiveHandler(p SessionActiveProvider) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		snap := p.Snapshot()
		sessionStart := openSessionStart(snap)
		var lastEventID uint64
		for i := range snap {
			if snap[i].ID > lastEventID {
				lastEventID = snap[i].ID
			}
		}
		if sessionStart == nil {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"session_id":    sessionStart.SessionID,
			"started_at":    sessionStart.SessionStart.StartedAt,
			"rower_id":      sessionStart.SessionStart.RowerID,
			"rower_name":    sessionStart.SessionStart.RowerName,
			"workout_id":    sessionStart.SessionStart.WorkoutID,
			"last_event_id": lastEventID,
		})
	})
}
