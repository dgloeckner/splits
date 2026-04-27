package api

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"strconv"

	"github.com/gloeckner-daniel/home-ergo/internal/event"
	"github.com/gloeckner-daniel/home-ergo/internal/stats"
	"github.com/gloeckner-daniel/home-ergo/internal/storage"
)

// SessionsHandler returns a mux handling every session-read endpoint.
// Auth is a middleware concern — this handler assumes the request has
// been authenticated (ARCH-0001 M1 note: rower stub).
func SessionsHandler(db *sql.DB, sched *stats.RecomputeScheduler) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/v1/sessions", listSessions(db))
	mux.HandleFunc("GET /api/v1/sessions/{id}", getSession(db))
	mux.HandleFunc("GET /api/v1/sessions/{id}/samples", getSamples(db))
	mux.HandleFunc("DELETE /api/v1/sessions/{id}", deleteSession(db, sched))
	return mux
}

func listSessions(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		limit := intQuery(r, "limit", 50)
		offset := intQuery(r, "offset", 0)
		rowerID := r.URL.Query().Get("rower_id")
		rows, err := storage.ListSessions(r.Context(), db, limit, offset, rowerID)
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
		// FEAT-0009 Mode 0: ended sessions have no per-stroke rows;
		// the downsampled series lives in summary_json.samples and is
		// expanded back into the per-sample wire shape the frontend
		// already expects.
		if row.EndedAt != nil && row.Summary != nil && row.Summary.Samples != nil {
			writeJSON(w, http.StatusOK, map[string]any{"samples": expandSamples(row.Summary.Samples)})
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

// expandSamples zips summary_json.samples into per-bucket SampleRows
// using the same field names the live samples endpoint already
// returns. stroke_no is the bucket index; fields not stored in the
// downsampled series (distance_m, level, …) are zeroed.
// DPS and SPI are populated when present; older summaries written
// before these fields were added will leave them at zero.
func expandSamples(s *event.SessionSamples) []storage.SampleRow {
	if s == nil {
		return nil
	}
	n := len(s.T)
	out := make([]storage.SampleRow, 0, n)
	for i := 0; i < n; i++ {
		row := storage.SampleRow{
			StrokeNo:       i + 1,
			TimeSec:        s.T[i],
			PaceSecPer500m: s.Split[i],
			PowerW:         s.Watt[i],
			SPM:            s.SPM[i],
		}
		if i < len(s.DPS) {
			row.DPS = s.DPS[i]
		}
		if i < len(s.SPI) {
			row.SPI = s.SPI[i]
		}
		out = append(out, row)
	}
	return out
}

// deleteSession hard-deletes a session: drops PB rows tied to it,
// removes the session row, and triggers a recompute (FEAT-0009 Mode
// 1). No soft-delete; confirmation lives in the UI.
func deleteSession(db *sql.DB, sched *stats.RecomputeScheduler) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		var rowerID string
		if err := db.QueryRowContext(r.Context(),
			`SELECT rower_id FROM sessions WHERE id = ?`, id).Scan(&rowerID); err != nil {
			if err == sql.ErrNoRows {
				w.WriteHeader(http.StatusNoContent)
				return
			}
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		tx, err := db.BeginTx(r.Context(), nil)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		defer func() { _ = tx.Rollback() }()
		for _, q := range []string{
			`DELETE FROM pb_distance WHERE source_session_id = ?`,
			`DELETE FROM pb_window WHERE source_session_id = ?`,
			`DELETE FROM pb_workout WHERE source_session_id = ?`,
			`DELETE FROM achievements WHERE source_session_id = ?`,
			`DELETE FROM strokes WHERE session_id = ?`,
			`DELETE FROM sessions WHERE id = ?`,
		} {
			if _, err := tx.ExecContext(r.Context(), q, id); err != nil {
				http.Error(w, err.Error(), http.StatusInternalServerError)
				return
			}
		}
		if err := tx.Commit(); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		if sched != nil {
			stats.OnSessionChange(sched, rowerID, stats.SessionHardDeleted)
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
