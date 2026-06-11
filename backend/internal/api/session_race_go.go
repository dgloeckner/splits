package api

import "net/http"

// RaceGoHandler signals the GO! moment of a race so the sessionizer
// re-latches work anchors, excluding pre-GO strokes from totals, the
// persisted race result, and PB candidates (§Falschstart). Idempotent
// and fire-and-forget — always returns 204.
func RaceGoHandler(s interface{ RaceGo() }) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		s.RaceGo()
		w.WriteHeader(http.StatusNoContent)
	}
}
