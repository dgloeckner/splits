package api

import (
	"context"
	"database/sql"
	"encoding/json"
	"net/http"
)

// PBsHandler exposes per-rower PB tables and the lifetime-stats
// snapshot. All payloads are snapshot-rendered: no joins back to
// strokes are needed, so compacted source sessions are fine.
func PBsHandler(db *sql.DB) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/v1/rowers/{id}/pbs", listActivePBs(db))
	mux.HandleFunc("GET /api/v1/rowers/{id}/pbs/history", listPBHistory(db))
	mux.HandleFunc("GET /api/v1/rowers/{id}/lifetime", getLifetime(db))
	mux.HandleFunc("GET /api/v1/rowers/{id}/achievements", listAchievements(db))
	mux.HandleFunc("GET /api/v1/sessions/{id}/pb-banners", listPBBanners(db))
	return mux
}

type distancePBRow struct {
	DistanceM             int     `json:"distance_m"`
	TimeSec               float64 `json:"time_sec"`
	SourceSessionID       string  `json:"source_session_id"`
	SourceSessionStartedAt string `json:"source_session_started_at"`
	AchievedAt            string  `json:"achieved_at"`
	InvalidatedAt         *string `json:"invalidated_at,omitempty"`
}

type windowPBRow struct {
	Metric                string  `json:"metric"`
	WindowKind            string  `json:"window_kind"`
	WindowSize            int     `json:"window_size"`
	Value                 float64 `json:"value"`
	SourceSessionID       string  `json:"source_session_id"`
	SourceSessionStartedAt string `json:"source_session_started_at"`
	AchievedAt            string  `json:"achieved_at"`
	InvalidatedAt         *string `json:"invalidated_at,omitempty"`
}

type workoutPBRow struct {
	ShapeHash             string          `json:"shape_hash"`
	Mode                  string          `json:"mode"`
	Params                json.RawMessage `json:"params"`
	ValueKind             string          `json:"value_kind"`
	Value                 float64         `json:"value"`
	SourceSessionID       string          `json:"source_session_id"`
	SourceSessionStartedAt string         `json:"source_session_started_at"`
	AchievedAt            string          `json:"achieved_at"`
	InvalidatedAt         *string         `json:"invalidated_at,omitempty"`
}

type achievementRow struct {
	Type                  string   `json:"type"`
	Key                   string   `json:"key"`
	Value                 *float64 `json:"value,omitempty"`
	SourceSessionID       *string  `json:"source_session_id,omitempty"`
	SourceSessionStartedAt *string `json:"source_session_started_at,omitempty"`
	AchievedAt            string   `json:"achieved_at"`
	InvalidatedAt         *string  `json:"invalidated_at,omitempty"`
}

func listActivePBs(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		rid := r.PathValue("id")
		distance, err := queryDistancePBs(r.Context(), db, rid, true)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		window, err := queryWindowPBs(r.Context(), db, rid, true)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		workout, err := queryWorkoutPBs(r.Context(), db, rid, true)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"distance": distance, "window": window, "workout": workout,
		})
	}
}

func listPBHistory(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		rid := r.PathValue("id")
		distance, err := queryDistancePBs(r.Context(), db, rid, false)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		window, err := queryWindowPBs(r.Context(), db, rid, false)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		workout, err := queryWorkoutPBs(r.Context(), db, rid, false)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"distance": distance, "window": window, "workout": workout,
		})
	}
}

func getLifetime(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		rid := r.PathValue("id")
		var (
			dist, sec, strokes, sessions, version int
			computedAt                            string
		)
		err := db.QueryRowContext(r.Context(), `
			SELECT total_distance_m, total_active_sec, total_strokes,
			       total_sessions, stats_version, computed_at
			FROM rower_lifetime_stats WHERE rower_id = ?`, rid).
			Scan(&dist, &sec, &strokes, &sessions, &version, &computedAt)
		if err == sql.ErrNoRows {
			writeJSON(w, http.StatusOK, map[string]any{
				"total_distance_m": 0, "total_active_sec": 0,
				"total_strokes": 0, "total_sessions": 0, "stats_version": 0,
			})
			return
		}
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"total_distance_m": dist,
			"total_active_sec": sec,
			"total_strokes":    strokes,
			"total_sessions":   sessions,
			"stats_version":    version,
			"computed_at":      computedAt,
		})
	}
}

func listAchievements(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		rid := r.PathValue("id")
		rows, err := db.QueryContext(r.Context(), `
			SELECT achievement_type, achievement_key, value,
			       source_session_id, source_session_started_at,
			       achieved_at, invalidated_at
			FROM achievements
			WHERE rower_id = ? AND invalidated_at IS NULL
			ORDER BY achieved_at DESC`, rid)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		defer rows.Close()
		out := []achievementRow{}
		for rows.Next() {
			var a achievementRow
			var val sql.NullFloat64
			var src, srcStart, inv sql.NullString
			if err := rows.Scan(&a.Type, &a.Key, &val, &src, &srcStart, &a.AchievedAt, &inv); err != nil {
				http.Error(w, err.Error(), http.StatusInternalServerError)
				return
			}
			if val.Valid {
				v := val.Float64
				a.Value = &v
			}
			if src.Valid {
				s := src.String
				a.SourceSessionID = &s
			}
			if srcStart.Valid {
				s := srcStart.String
				a.SourceSessionStartedAt = &s
			}
			if inv.Valid {
				s := inv.String
				a.InvalidatedAt = &s
			}
			out = append(out, a)
		}
		writeJSON(w, http.StatusOK, map[string]any{"achievements": out})
	}
}

func listPBBanners(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		sid := r.PathValue("id")
		var rid string
		if err := db.QueryRowContext(r.Context(),
			`SELECT rower_id FROM sessions WHERE id = ?`, sid).Scan(&rid); err != nil {
			if err == sql.ErrNoRows {
				http.NotFound(w, r)
				return
			}
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		distance := []distancePBRow{}
		drows, err := db.QueryContext(r.Context(), `
			SELECT distance_m, time_sec, source_session_id, source_session_started_at, achieved_at
			FROM pb_distance WHERE rower_id = ? AND source_session_id = ? AND invalidated_at IS NULL`, rid, sid)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		for drows.Next() {
			var d distancePBRow
			if err := drows.Scan(&d.DistanceM, &d.TimeSec, &d.SourceSessionID, &d.SourceSessionStartedAt, &d.AchievedAt); err != nil {
				drows.Close()
				http.Error(w, err.Error(), http.StatusInternalServerError)
				return
			}
			distance = append(distance, d)
		}
		drows.Close()

		window := []windowPBRow{}
		wrows, err := db.QueryContext(r.Context(), `
			SELECT metric, window_kind, window_size, value,
			       source_session_id, source_session_started_at, achieved_at
			FROM pb_window WHERE rower_id = ? AND source_session_id = ? AND invalidated_at IS NULL`, rid, sid)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		for wrows.Next() {
			var x windowPBRow
			if err := wrows.Scan(&x.Metric, &x.WindowKind, &x.WindowSize, &x.Value,
				&x.SourceSessionID, &x.SourceSessionStartedAt, &x.AchievedAt); err != nil {
				wrows.Close()
				http.Error(w, err.Error(), http.StatusInternalServerError)
				return
			}
			window = append(window, x)
		}
		wrows.Close()

		writeJSON(w, http.StatusOK, map[string]any{
			"distance": distance, "window": window,
		})
	}
}

func queryDistancePBs(ctx context.Context, db *sql.DB, rid string, activeOnly bool) ([]distancePBRow, error) {
	cond := "AND invalidated_at IS NULL"
	if !activeOnly {
		cond = ""
	}
	rows, err := db.QueryContext(ctx, `
		SELECT distance_m, time_sec, source_session_id, source_session_started_at, achieved_at, invalidated_at
		FROM pb_distance WHERE rower_id = ? `+cond+`
		ORDER BY distance_m, achieved_at DESC`, rid)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []distancePBRow{}
	for rows.Next() {
		var d distancePBRow
		var inv sql.NullString
		if err := rows.Scan(&d.DistanceM, &d.TimeSec, &d.SourceSessionID,
			&d.SourceSessionStartedAt, &d.AchievedAt, &inv); err != nil {
			return nil, err
		}
		if inv.Valid {
			s := inv.String
			d.InvalidatedAt = &s
		}
		out = append(out, d)
	}
	return out, rows.Err()
}

func queryWindowPBs(ctx context.Context, db *sql.DB, rid string, activeOnly bool) ([]windowPBRow, error) {
	cond := "AND invalidated_at IS NULL"
	if !activeOnly {
		cond = ""
	}
	rows, err := db.QueryContext(ctx, `
		SELECT metric, window_kind, window_size, value,
		       source_session_id, source_session_started_at, achieved_at, invalidated_at
		FROM pb_window WHERE rower_id = ? `+cond+`
		ORDER BY metric, window_size, achieved_at DESC`, rid)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []windowPBRow{}
	for rows.Next() {
		var x windowPBRow
		var inv sql.NullString
		if err := rows.Scan(&x.Metric, &x.WindowKind, &x.WindowSize, &x.Value,
			&x.SourceSessionID, &x.SourceSessionStartedAt, &x.AchievedAt, &inv); err != nil {
			return nil, err
		}
		if inv.Valid {
			s := inv.String
			x.InvalidatedAt = &s
		}
		out = append(out, x)
	}
	return out, rows.Err()
}

func queryWorkoutPBs(ctx context.Context, db *sql.DB, rid string, activeOnly bool) ([]workoutPBRow, error) {
	cond := "AND invalidated_at IS NULL"
	if !activeOnly {
		cond = ""
	}
	rows, err := db.QueryContext(ctx, `
		SELECT shape_hash, mode, params_json, value_kind, value,
		       source_session_id, source_session_started_at, achieved_at, invalidated_at
		FROM pb_workout WHERE rower_id = ? `+cond+`
		ORDER BY mode, shape_hash, achieved_at DESC`, rid)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []workoutPBRow{}
	for rows.Next() {
		var x workoutPBRow
		var paramsStr string
		var inv sql.NullString
		if err := rows.Scan(&x.ShapeHash, &x.Mode, &paramsStr, &x.ValueKind, &x.Value,
			&x.SourceSessionID, &x.SourceSessionStartedAt, &x.AchievedAt, &inv); err != nil {
			return nil, err
		}
		x.Params = json.RawMessage(paramsStr)
		if inv.Valid {
			s := inv.String
			x.InvalidatedAt = &s
		}
		out = append(out, x)
	}
	return out, rows.Err()
}
