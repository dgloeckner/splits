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

		pb, err := loadPB(r.Context(), db, rowerID, workoutID)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		resp.PB = pb

		// De-dupe: if the ghost (most-recent matching session) is the same
		// session that backs the PB lane, suppress the ghost. The PB lane
		// stays and is rendered with PB styling on the client.
		if resp.Ghost != nil && resp.PB != nil &&
			resp.Ghost.SourceSessionID == resp.PB.SourceSessionID {
			resp.Ghost = nil
		}

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
	return opponentFromSummary(sessionID, "ghost", summary)
}

// opponentFromSummary builds an opponent from a sessions.summary_json
// payload, returning nil when summary is missing/empty or contains no
// samples. Shared by ghost + PB loaders.
func opponentFromSummary(sourceID, label string, summary sql.NullString) (*RaceOpponent, error) {
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
		SourceSessionID: sourceID,
		Label:           label,
		TSec:            payload.Samples.TSec,
		Split:           payload.Samples.Split,
	}, nil
}

// loadPB resolves the PB-leader opponent. It compares the active
// pb_workout row for the current workout's shape_hash (only when its
// value_kind = 'time_sec', i.e. distance-mode) against the active
// pb_distance row for the current workout's standard distance, and
// picks whichever has the shorter time. When the chosen PB's source
// session is soft-deleted (or otherwise gone), no PB is returned.
func loadPB(ctx context.Context, db *sql.DB, rowerID, workoutID string) (*RaceOpponent, error) {
	mode, paramsJSON, shapeHash, err := workoutShapeForRace(ctx, db, workoutID)
	if err != nil {
		return nil, err
	}
	if shapeHash == "" {
		return nil, nil
	}

	wpbSession, wpbTime, wpbOK, err := queryPBWorkout(ctx, db, rowerID, shapeHash)
	if err != nil {
		return nil, err
	}

	var (
		dpbSession string
		dpbTime    float64
		dpbOK      bool
	)
	if dist, ok := standardDistanceForWorkout(mode, paramsJSON); ok {
		dpbSession, dpbTime, dpbOK, err = queryPBDistance(ctx, db, rowerID, dist)
		if err != nil {
			return nil, err
		}
	}

	var sourceID string
	switch {
	case wpbOK && dpbOK:
		// Tie-break: workout-PB wins on equal times because it's a more specific shape match.
		if wpbTime <= dpbTime {
			sourceID = wpbSession
		} else {
			sourceID = dpbSession
		}
	case wpbOK:
		sourceID = wpbSession
	case dpbOK:
		sourceID = dpbSession
	default:
		return nil, nil
	}

	return loadOpponentSession(ctx, db, sourceID, "pb")
}

// workoutShapeForRace fetches the workout's mode, params_json and
// shape_hash. Returns ("","","",nil) when the workout doesn't exist.
func workoutShapeForRace(ctx context.Context, db *sql.DB, workoutID string) (mode, paramsJSON, shapeHash string, err error) {
	var hash sql.NullString
	err = db.QueryRowContext(ctx,
		`SELECT mode, params_json, shape_hash FROM workout WHERE id = ?`, workoutID).
		Scan(&mode, &paramsJSON, &hash)
	if errors.Is(err, sql.ErrNoRows) {
		return "", "", "", nil
	}
	if err != nil {
		return "", "", "", err
	}
	if hash.Valid {
		shapeHash = hash.String
	}
	return mode, paramsJSON, shapeHash, nil
}

// queryPBWorkout returns the active pb_workout row for the given
// shape, but only when it is comparable as time (value_kind =
// 'time_sec'). Other value_kinds (e.g. 'distance_m' for time-mode
// workouts) are not directly comparable to pb_distance and are skipped
// in T3 — callers fall through to pb_distance or no PB.
func queryPBWorkout(ctx context.Context, db *sql.DB, rowerID, shapeHash string) (sourceSessionID string, timeSec float64, ok bool, err error) {
	const q = `
		SELECT source_session_id, value
		FROM pb_workout
		WHERE rower_id = ? AND shape_hash = ?
		  AND value_kind = 'time_sec'
		  AND invalidated_at IS NULL
		LIMIT 1`
	err = db.QueryRowContext(ctx, q, rowerID, shapeHash).Scan(&sourceSessionID, &timeSec)
	if errors.Is(err, sql.ErrNoRows) {
		return "", 0, false, nil
	}
	if err != nil {
		return "", 0, false, err
	}
	return sourceSessionID, timeSec, true, nil
}

// queryPBDistance returns the active pb_distance row for (rower_id,
// distance_m). Caller is responsible for gating on standard distance.
func queryPBDistance(ctx context.Context, db *sql.DB, rowerID string, distanceM int) (sourceSessionID string, timeSec float64, ok bool, err error) {
	const q = `
		SELECT source_session_id, time_sec
		FROM pb_distance
		WHERE rower_id = ? AND distance_m = ?
		  AND invalidated_at IS NULL
		LIMIT 1`
	err = db.QueryRowContext(ctx, q, rowerID, distanceM).Scan(&sourceSessionID, &timeSec)
	if errors.Is(err, sql.ErrNoRows) {
		return "", 0, false, nil
	}
	if err != nil {
		return "", 0, false, err
	}
	return sourceSessionID, timeSec, true, nil
}

// standardPBDistances are the distances for which `pb_distance` is
// considered the canonical PB and is therefore eligible to outrank
// `pb_workout` for distance-mode races. Off-list distances must use
// `pb_workout` only.
var standardPBDistances = map[int]struct{}{
	500: {}, 1000: {}, 2000: {}, 5000: {},
	6000: {}, 10000: {}, 21097: {}, 42195: {},
}

// standardDistanceForWorkout returns the workout's distance if and
// only if the workout is distance-mode and the `meters` param is one
// of the standard PB distances.
func standardDistanceForWorkout(mode, paramsJSON string) (int, bool) {
	if mode != "distance" {
		return 0, false
	}
	var p struct {
		Meters int `json:"meters"`
	}
	if err := json.Unmarshal([]byte(paramsJSON), &p); err != nil {
		return 0, false
	}
	if _, ok := standardPBDistances[p.Meters]; !ok {
		return 0, false
	}
	return p.Meters, true
}

// loadOpponentSession reads a source session's summary_json and
// returns an opponent, but only when the session is still live
// (deleted_at IS NULL). Missing or deleted sessions yield (nil, nil).
func loadOpponentSession(ctx context.Context, db *sql.DB, sessionID, label string) (*RaceOpponent, error) {
	var summary sql.NullString
	err := db.QueryRowContext(ctx,
		`SELECT summary_json FROM sessions WHERE id = ? AND deleted_at IS NULL`, sessionID).
		Scan(&summary)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return opponentFromSummary(sessionID, label, summary)
}
