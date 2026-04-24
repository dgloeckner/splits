package api

import "net/http"

// SessionEndHandler triggers an immediate close of the currently open
// session via the sessionizer. Idempotent — calling with no open
// session returns 204 anyway.
func SessionEndHandler(att SessionAttacher) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		att.EndSession()
		w.WriteHeader(http.StatusNoContent)
	})
}
