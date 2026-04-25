package storage

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"time"

	"github.com/gloeckner-daniel/home-ergo/internal/event"
)

// SessionRow is the read-side shape of a persisted session. Kept flat
// so the JSON handler can marshal it directly and the frontend can
// render list + detail from the same type.
type SessionRow struct {
	ID             string                `json:"id"`
	RowerID        string                `json:"rower_id"`
	WorkoutID      *string               `json:"workout_id,omitempty"`
	StartedAt      time.Time             `json:"started_at"`
	EndedAt        *time.Time            `json:"ended_at,omitempty"`
	InitialLevel   int                   `json:"initial_level"`
	TotalDistanceM *int                  `json:"total_distance_m,omitempty"`
	TotalTimeSec   *float64              `json:"total_time_sec,omitempty"`
	TotalStrokes   *int                  `json:"total_strokes,omitempty"`
	Summary        *event.SessionSummary `json:"summary,omitempty"`
}

// SampleRow mirrors one strokes table row. StrokeNo is 1-based.
type SampleRow struct {
	StrokeNo       int     `json:"stroke_no"`
	TimeSec        float64 `json:"time_sec"`
	DistanceM      int     `json:"distance_m"`
	SPM            int     `json:"spm"`
	PowerW         int     `json:"power_w"`
	CalPerHr       int     `json:"cal_per_hr"`
	Level          int     `json:"level"`
	DPS            float64 `json:"dps"`
	StrokeCycleSec float64 `json:"stroke_cycle_sec"`
	PaceSecPer500m int     `json:"pace_sec_per_500m"`
	EnergyJoules   int     `json:"energy_joules"`
}

// ListSessions returns non-deleted sessions newest first.
func ListSessions(ctx context.Context, db *sql.DB, limit, offset int) ([]SessionRow, error) {
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	if offset < 0 {
		offset = 0
	}
	rows, err := db.QueryContext(ctx, `
		SELECT id, rower_id, workout_id, started_at, ended_at, initial_level,
		       total_distance_m, total_time_sec, total_strokes, summary_json
		FROM sessions
		WHERE deleted_at IS NULL
		  AND COALESCE(total_strokes, 0) > 0
		ORDER BY started_at DESC
		LIMIT ? OFFSET ?`, limit, offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []SessionRow
	for rows.Next() {
		r, err := scanSession(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// GetSession returns the session with the given id, or (nil, nil) if
// not found or soft-deleted.
func GetSession(ctx context.Context, db *sql.DB, id string) (*SessionRow, error) {
	row := db.QueryRowContext(ctx, `
		SELECT id, rower_id, workout_id, started_at, ended_at, initial_level,
		       total_distance_m, total_time_sec, total_strokes, summary_json
		FROM sessions
		WHERE id = ? AND deleted_at IS NULL`, id)
	r, err := scanSession(row)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &r, nil
}

// MaxStrokeGlobalID returns the largest global_id ever persisted, or
// 0 if the strokes table is empty. Seeds the sessionizer's monotonic
// id counter on restart so new events can't collide with existing
// rows on strokes.global_id.
func MaxStrokeGlobalID(ctx context.Context, db *sql.DB) (uint64, error) {
	var v sql.NullInt64
	if err := db.QueryRowContext(ctx, `SELECT MAX(global_id) FROM strokes`).Scan(&v); err != nil {
		return 0, err
	}
	if !v.Valid {
		return 0, nil
	}
	return uint64(v.Int64), nil
}

func ListSamples(ctx context.Context, db *sql.DB, sessionID string) ([]SampleRow, error) {
	rows, err := db.QueryContext(ctx, `
		SELECT stroke_no, time_sec, distance_m, spm, power_w, cal_per_hr, level,
		       dps, stroke_cycle_sec, pace_sec_per_500m, energy_joules
		FROM strokes
		WHERE session_id = ?
		ORDER BY stroke_no ASC`, sessionID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []SampleRow
	for rows.Next() {
		var s SampleRow
		if err := rows.Scan(&s.StrokeNo, &s.TimeSec, &s.DistanceM, &s.SPM, &s.PowerW, &s.CalPerHr, &s.Level,
			&s.DPS, &s.StrokeCycleSec, &s.PaceSecPer500m, &s.EnergyJoules); err != nil {
			return nil, err
		}
		out = append(out, s)
	}
	return out, rows.Err()
}

// rowScanner lets scanSession take either *sql.Row or *sql.Rows.
type rowScanner interface {
	Scan(dest ...any) error
}

func scanSession(r rowScanner) (SessionRow, error) {
	var (
		out         SessionRow
		workoutStr  sql.NullString
		startedStr  string
		endedStr    sql.NullString
		totalDist   sql.NullInt64
		totalTime   sql.NullFloat64
		totalStroke sql.NullInt64
		summaryStr  sql.NullString
	)
	if err := r.Scan(&out.ID, &out.RowerID, &workoutStr, &startedStr, &endedStr, &out.InitialLevel,
		&totalDist, &totalTime, &totalStroke, &summaryStr); err != nil {
		return out, err
	}
	if workoutStr.Valid && workoutStr.String != "" {
		v := workoutStr.String
		out.WorkoutID = &v
	}
	t, err := time.Parse(time.RFC3339Nano, startedStr)
	if err != nil {
		return out, err
	}
	out.StartedAt = t
	if endedStr.Valid {
		t, err := time.Parse(time.RFC3339Nano, endedStr.String)
		if err != nil {
			return out, err
		}
		out.EndedAt = &t
	}
	if totalDist.Valid {
		v := int(totalDist.Int64)
		out.TotalDistanceM = &v
	}
	if totalTime.Valid {
		v := totalTime.Float64
		out.TotalTimeSec = &v
	}
	if totalStroke.Valid {
		v := int(totalStroke.Int64)
		out.TotalStrokes = &v
	}
	if summaryStr.Valid && summaryStr.String != "" {
		var s event.SessionSummary
		if err := json.Unmarshal([]byte(summaryStr.String), &s); err != nil {
			return out, err
		}
		out.Summary = &s
	}
	return out, nil
}
