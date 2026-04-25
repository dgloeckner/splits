package api

import (
	"encoding/json"
	"net/http"
)

// SessionStartHandler opens a new session via the sessionizer with an
// optional workout id. Idempotent: returns 200 either way (no-op when
// a session is already open).
//
// Strokes arriving before this endpoint is called are silently dropped
// at the sessionizer (FEAT-0009 / new-workout flow). The user must
// explicitly start a workout — telemetry alone never opens a session.
func SessionStartHandler(att SessionAttacher) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			WorkoutID string `json:"workout_id"`
		}
		// Body is optional; ignore decoding errors so callers can
		// POST without a body for the "just row" case.
		_ = json.NewDecoder(r.Body).Decode(&body)
		att.StartSession(body.WorkoutID)
		w.WriteHeader(http.StatusOK)
	})
}
