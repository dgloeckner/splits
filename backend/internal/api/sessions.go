package api

import (
	"database/sql"
	"encoding/json"
	"errors"
	"context"
	"log/slog"
	"net/http"
	"strconv"
	"time"

	"github.com/gloeckner-daniel/splits/internal/event"
	"github.com/gloeckner-daniel/splits/internal/stats"
	"github.com/gloeckner-daniel/splits/internal/storage"
)

// ActiveSessionIDer reports the id of the currently broadcasting
// session, or "" when none is open. SessionsHandler uses it to reject
// DELETE of a live session — deleting rows while the sessionizer is
// still writing them races the persister and corrupts the summary.
//
// An implementer may additionally satisfy ActiveSessionClearer; when
// the DELETE handler decides to override the active-claim (because the
// row is `status='stale-open'` — the session is dead but in-memory
// state didn't notice), it will call ClearActiveSession(id) so the
// sessionizer drops its stale claim.
type ActiveSessionIDer interface {
	ActiveSessionID() string
}

// ActiveSessionClearer is the optional companion to ActiveSessionIDer.
// Implemented by the sessionizer so the DELETE handler can drop a
// stuck in-memory claim when the DB row already says the session went
// stale-open. Janitor sweeps invoke this via the same path.
type ActiveSessionClearer interface {
	ClearActiveSession(id string)
}

// ActiveSessionEnder is the optional companion to ActiveSessionIDer
// that lets the DELETE handler end a live session before deleting it.
// Without this path, "Verwerfen" on a still-running session returns
// 409 and the row leaks to history once the sessionizer's own idle
// timeout finally closes it.
type ActiveSessionEnder interface {
	EndSession()
}

// SessionsHandler returns a mux handling every session-read endpoint.
// Auth is a middleware concern — this handler assumes the request has
// been authenticated (ARCH-0001 M1 note: rower stub). active may be
// nil (tests, or a router that doesn't wire the sessionizer).
func SessionsHandler(db *sql.DB, sched *stats.RecomputeScheduler, active ActiveSessionIDer) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/v1/sessions", listSessions(db))
	mux.HandleFunc("GET /api/v1/sessions/stale-open", listStaleOpen(db))
	mux.HandleFunc("GET /api/v1/sessions/{id}", getSession(db))
	mux.HandleFunc("GET /api/v1/sessions/{id}/samples", getSamples(db))
	mux.HandleFunc("GET /api/v1/sessions/{id}/insights", getSessionInsights(db))
	mux.HandleFunc("POST /api/v1/sessions/{id}/finalize", finalizeSession(db, sched))
	mux.HandleFunc("DELETE /api/v1/sessions/{id}", deleteSession(db, sched, active))
	return mux
}

// listStaleOpen serves the resume API. FEAT-0015 Slice 3.
func listStaleOpen(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		rowerID := r.URL.Query().Get("rower_id")
		if rowerID == "" {
			http.Error(w, "rower_id required", http.StatusBadRequest)
			return
		}
		rows, err := storage.ListStaleOpenSessions(r.Context(), db, rowerID)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		if rows == nil {
			rows = []storage.StaleOpenSessionRow{}
		}
		writeJSON(w, http.StatusOK, map[string]any{"sessions": rows})
	}
}

// finalizeSession synthesises a session_end for a stale-open session
// using the most recent stroke's `at` as `ended_at`, runs the
// persister's applySessionEnd path (samples, candidates, insights),
// and triggers a recompute. Idempotent: a session that is already
// ended (or doesn't exist) returns 204 with no work done.
func finalizeSession(db *sql.DB, sched *stats.RecomputeScheduler) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		ctx := r.Context()

		var rowerID string
		var endedAt sql.NullString
		err := db.QueryRowContext(ctx,
			`SELECT rower_id, ended_at FROM sessions WHERE id = ?`, id).Scan(&rowerID, &endedAt)
		if errors.Is(err, sql.ErrNoRows) {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		if endedAt.Valid {
			// Already finalised.
			w.WriteHeader(http.StatusNoContent)
			return
		}

		if err := storage.FinalizeStaleSession(ctx, db, id); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		if sched != nil && rowerID != "" {
			stats.OnSessionChange(sched, rowerID, stats.SessionCreated)
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

func listSessions(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		rowerID := r.URL.Query().Get("rower_id")
		if rowerID == "" {
			http.Error(w, "rower_id required", http.StatusBadRequest)
			return
		}
		limit := intQuery(r, "limit", 50)
		offset := intQuery(r, "offset", 0)
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
		if errors.Is(err, sql.ErrNoRows) {
			http.NotFound(w, r)
			return
		}
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
		if errors.Is(err, sql.ErrNoRows) {
			http.NotFound(w, r)
			return
		}
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
		// already expects. The analysis window travels alongside as
		// bucket indices into that list; sessions finalised before it
		// existed omit the key.
		if row.EndedAt != nil && row.Summary != nil && row.Summary.Samples != nil {
			body := map[string]any{"samples": expandSamples(row.Summary.Samples)}
			if win := row.Summary.Samples.Window; win != nil {
				body["window"] = win
			}
			writeJSON(w, http.StatusOK, body)
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
// DPS is populated when present; older summaries written
// before this field was added will leave it at zero.
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
		out = append(out, row)
	}
	return out
}

// deleteSession hard-deletes a session: drops PB rows tied to it,
// removes the session row, and triggers a recompute (FEAT-0009 Mode
// 1). No soft-delete; confirmation lives in the UI.
func deleteSession(db *sql.DB, sched *stats.RecomputeScheduler, active ActiveSessionIDer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		var rowerID, status string
		err := db.QueryRowContext(r.Context(),
			`SELECT rower_id, COALESCE(status,'') FROM sessions WHERE id = ?`, id).Scan(&rowerID, &status)
		if err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				w.WriteHeader(http.StatusNoContent)
				return
			}
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		if active != nil {
			if cur := active.ActiveSessionID(); cur != "" && cur == id {
				switch status {
				case "stale-open":
					// Override: row is dead by definition (last stroke
					// > threshold ago). Drop the in-memory claim, then
					// proceed with the hard-delete below.
					if cl, ok := active.(ActiveSessionClearer); ok {
						cl.ClearActiveSession(id)
					}
				default:
					// Live session: end it first, wait for the persister
					// to commit ended_at, then hard-delete. Without this
					// path, the "Verwerfen" button on a still-running
					// session would 409 and the row would leak to
					// history once the sessionizer's idle guard finally
					// closed it.
					ender, ok := active.(ActiveSessionEnder)
					if !ok {
						http.Error(w, "session is currently active; end it first", http.StatusConflict)
						return
					}
					ender.EndSession()
					if err := waitForSessionEnded(r.Context(), db, id, 5*time.Second); err != nil {
						http.Error(w, "timed out waiting for session_end: "+err.Error(), http.StatusGatewayTimeout)
						return
					}
				}
			}
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
			if err := sched.Wait(r.Context(), rowerID); err != nil {
				slog.Warn("delete.recompute_wait", "rower_id", rowerID, "err", err)
			}
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

// waitForSessionEnded polls until the session row has ended_at set or
// disappears, capped by `timeout`. Used by the DELETE handler to
// synchronise with the persister after EndSession() — only then is it
// safe to hard-delete without racing the persister's apply loop.
func waitForSessionEnded(ctx context.Context, db *sql.DB, id string, timeout time.Duration) error {
	deadline := time.Now().Add(timeout)
	for {
		var ended sql.NullString
		err := db.QueryRowContext(ctx,
			`SELECT ended_at FROM sessions WHERE id = ?`, id).Scan(&ended)
		if errors.Is(err, sql.ErrNoRows) {
			return nil
		}
		if err == nil && ended.Valid && ended.String != "" {
			return nil
		}
		if time.Now().After(deadline) {
			return errors.New("session_end did not commit within timeout")
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(25 * time.Millisecond):
		}
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
