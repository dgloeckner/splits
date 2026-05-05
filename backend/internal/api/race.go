package api

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
)

type RaceOpponent struct {
	SourceSessionID string    `json:"source_session_id"`
	Label           string    `json:"label"`
	TSec            []float64 `json:"t_sec"`
	Split           []float64 `json:"split"`
}

type RaceOpponentsResponse struct {
	Ghost *RaceOpponent `json:"ghost"`
	PB    *RaceOpponent `json:"pb"`
}

// samplesPayload mirrors the relevant slice of summary_json: we only
// need the samples block to reconstruct a ghost replay.
type samplesPayload struct {
	Samples struct {
		TSec  []float64 `json:"t_sec"`
		Split []float64 `json:"split"`
	} `json:"samples"`
}

func RaceOpponentsHandler(db *sql.DB) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		workoutID := r.URL.Query().Get("workout_id")
		rowerID := r.URL.Query().Get("rower_id")
		if workoutID == "" || rowerID == "" {
			http.Error(w, "workout_id and rower_id are required", http.StatusBadRequest)
			return
		}

		var resp RaceOpponentsResponse
		ghost, err := loadGhost(r.Context(), db, rowerID, workoutID)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		resp.Ghost = ghost
		// PB resolution arrives in Task 3.

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(resp)
	})
}

// loadGhost returns the most recent completed, non-deleted session by
// the same rower whose workout shares shape_hash with workoutID. It
// returns nil (no error) when no such session exists or its samples
// block is empty.
func loadGhost(ctx context.Context, db *sql.DB, rowerID, workoutID string) (*RaceOpponent, error) {
	const q = `
		SELECT s.id, s.summary_json
		FROM sessions s
		JOIN workout w ON w.id = s.workout_id
		WHERE s.rower_id = ?
		  AND s.ended_at IS NOT NULL
		  AND s.deleted_at IS NULL
		  AND w.shape_hash = (SELECT shape_hash FROM workout WHERE id = ?)
		ORDER BY s.started_at DESC
		LIMIT 1`
	var (
		sessionID string
		summary   sql.NullString
	)
	if err := db.QueryRowContext(ctx, q, rowerID, workoutID).Scan(&sessionID, &summary); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	if !summary.Valid || summary.String == "" {
		return nil, nil
	}
	var payload samplesPayload
	if err := json.Unmarshal([]byte(summary.String), &payload); err != nil {
		return nil, err
	}
	if len(payload.Samples.TSec) == 0 {
		return nil, nil
	}
	return &RaceOpponent{
		SourceSessionID: sessionID,
		Label:           "ghost",
		TSec:            payload.Samples.TSec,
		Split:           payload.Samples.Split,
	}, nil
}
