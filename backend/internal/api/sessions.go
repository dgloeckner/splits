package api

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"strconv"
	"time"

	"github.com/gloeckner-daniel/home-ergo/internal/storage"
)

// SessionsHandler returns a mux handling every session-read endpoint.
// Auth is a middleware concern — this handler assumes the request has
// been authenticated (ARCH-0001 M1 note: rower stub).
func SessionsHandler(db *sql.DB) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/v1/sessions", listSessions(db))
	mux.HandleFunc("GET /api/v1/sessions/{id}", getSession(db))
	mux.HandleFunc("GET /api/v1/sessions/{id}/samples", getSamples(db))
	mux.HandleFunc("DELETE /api/v1/sessions/{id}", deleteSession(db))
	return mux
}

func listSessions(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		limit := intQuery(r, "limit", 50)
		offset := intQuery(r, "offset", 0)
		rows, err := storage.ListSessions(r.Context(), db, limit, offset)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		if rows == nil {
			rows = []storage.SessionRow{}
		}
		writeJSON(w, http.StatusOK, map[string]any{"sessions": rows})
	}
}

func getSession(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		row, err := storage.GetSession(r.Context(), db, id)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		if row == nil {
			http.NotFound(w, r)
			return
		}
		writeJSON(w, http.StatusOK, row)
	}
}

func getSamples(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		row, err := storage.GetSession(r.Context(), db, id)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		if row == nil {
			http.NotFound(w, r)
			return
		}
		samples, err := storage.ListSamples(r.Context(), db, id)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		if samples == nil {
			samples = []storage.SampleRow{}
		}
		writeJSON(w, http.StatusOK, map[string]any{"samples": samples})
	}
}

func deleteSession(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		if err := storage.SoftDeleteSession(r.Context(), db, id, time.Now().UTC()); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

func intQuery(r *http.Request, key string, def int) int {
	if s := r.URL.Query().Get(key); s != "" {
		if v, err := strconv.Atoi(s); err == nil {
			return v
		}
	}
	return def
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}
