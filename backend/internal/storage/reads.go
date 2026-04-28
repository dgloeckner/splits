package storage

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"time"

	"github.com/gloeckner-daniel/splits/internal/event"
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
	HasPB          bool                  `json:"has_pb,omitempty"`
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
	SPI            int     `json:"spi"`
}

// sessionSelectCols is the column list shared by ListSessions and
// GetSession. summary_json now carries only the samples envelope; all
// aggregate metrics live in their own typed columns.
const sessionSelectCols = `s.id, s.rower_id, s.workout_id, s.started_at, s.ended_at, s.initial_level,
		       s.total_distance_m, s.total_time_sec, s.total_strokes,
		       s.avg_power_w, s.peak_power_w, s.avg_spm, s.avg_dps, s.avg_spi,
		       s.avg_pace_sec_per_500m, s.session_calories,
		       s.summary_json,
		       (EXISTS(SELECT 1 FROM pb_distance pd
		               WHERE pd.source_session_id = s.id AND pd.invalidated_at IS NULL)
		        OR EXISTS(SELECT 1 FROM pb_window pw
		                  WHERE pw.source_session_id = s.id AND pw.invalidated_at IS NULL)
		        OR EXISTS(SELECT 1 FROM pb_workout pwo
		                  WHERE pwo.source_session_id = s.id AND pwo.invalidated_at IS NULL)) AS has_pb`

// ListSessions returns non-deleted sessions newest first. When
// rowerID is non-empty, only sessions belonging to that rower are
// returned.
func ListSessions(ctx context.Context, db *sql.DB, limit, offset int, rowerID string) ([]SessionRow, error) {
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	if offset < 0 {
		offset = 0
	}
	args := []any{}
	rowerFilter := ""
	if rowerID != "" {
		rowerFilter = " AND s.rower_id = ?"
		args = append(args, rowerID)
	}
	args = append(args, limit, offset)
	rows, err := db.QueryContext(ctx, `
		SELECT `+sessionSelectCols+`
		FROM sessions s
		WHERE s.deleted_at IS NULL
		  AND COALESCE(s.total_strokes, 0) > 0`+rowerFilter+`
		ORDER BY s.started_at DESC
		LIMIT ? OFFSET ?`, args...)
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
		SELECT `+sessionSelectCols+`
		FROM sessions s
		WHERE s.id = ? AND s.deleted_at IS NULL`, id)
	r, err := scanSession(row)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &r, nil
}

// MaxStrokeGlobalID returns the largest event id observed across
// strokes (open sessions only — closed sessions have their strokes
// compacted) and persisted sessions' last_event_id (so the counter
// survives restarts even when no strokes remain). Seeds the
// sessionizer's monotonic id counter on restart.
func MaxStrokeGlobalID(ctx context.Context, db *sql.DB) (uint64, error) {
	var strokeMax, sessionMax sql.NullInt64
	if err := db.QueryRowContext(ctx, `SELECT MAX(global_id) FROM strokes`).Scan(&strokeMax); err != nil {
		return 0, err
	}
	if err := db.QueryRowContext(ctx,
		`SELECT MAX(last_event_id) FROM sessions WHERE last_event_id IS NOT NULL`).Scan(&sessionMax); err != nil {
		return 0, err
	}
	maxOf := func(a, b sql.NullInt64) sql.NullInt64 {
		if !a.Valid {
			return b
		}
		if !b.Valid {
			return a
		}
		if b.Int64 > a.Int64 {
			return b
		}
		return a
	}
	v := maxOf(strokeMax, sessionMax)
	if !v.Valid {
		return 0, nil
	}
	return uint64(v.Int64), nil
}

func ListSamples(ctx context.Context, db *sql.DB, sessionID string) ([]SampleRow, error) {
	rows, err := db.QueryContext(ctx, `
		SELECT stroke_no, time_sec, distance_m, spm, power_w, cal_per_hr, level,
		       dps, stroke_cycle_sec, pace_sec_per_500m, energy_joules,
		       (CASE WHEN spm > 0 AND power_w >= 20 THEN power_w / spm ELSE 0 END) AS spi
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
			&s.DPS, &s.StrokeCycleSec, &s.PaceSecPer500m, &s.EnergyJoules, &s.SPI); err != nil {
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
		avgPower    sql.NullFloat64
		peakPower   sql.NullFloat64
		avgSPM      sql.NullFloat64
		avgDPS      sql.NullFloat64
		avgSPI      sql.NullFloat64
		avgPace     sql.NullFloat64
		sessionCal  sql.NullFloat64
		summaryStr  sql.NullString
	)
	if err := r.Scan(&out.ID, &out.RowerID, &workoutStr, &startedStr, &endedStr, &out.InitialLevel,
		&totalDist, &totalTime, &totalStroke,
		&avgPower, &peakPower, &avgSPM, &avgDPS, &avgSPI, &avgPace, &sessionCal,
		&summaryStr, &out.HasPB); err != nil {
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
	// Build Summary from typed columns + samples blob (if either side
	// has data). After ended_at is set, columns hold every aggregate
	// the API used to read out of summary_json.
	if out.EndedAt != nil {
		s := event.SessionSummary{
			TotalDistanceM:    intOr(totalDist),
			TotalTimeSec:      totalTime.Float64,
			TotalStrokes:      intOr(totalStroke),
			AvgPowerW:         intOrFloat(avgPower),
			PeakPowerW:        intOrFloat(peakPower),
			AvgSPM:            avgSPM.Float64,
			AvgDPS:            avgDPS.Float64,
			AvgSPI:            intOrFloat(avgSPI),
			AvgPaceSecPer500m: intOrFloat(avgPace),
			SessionCalories:   intOrFloat(sessionCal),
		}
		if summaryStr.Valid && summaryStr.String != "" {
			var env samplesEnvelope
			if err := json.Unmarshal([]byte(summaryStr.String), &env); err != nil {
				return out, err
			}
			s.Samples = env.Samples
		}
		out.Summary = &s
	}
	return out, nil
}

func intOr(n sql.NullInt64) int {
	if n.Valid {
		return int(n.Int64)
	}
	return 0
}

func intOrFloat(n sql.NullFloat64) int {
	if n.Valid {
		return int(n.Float64)
	}
	return 0
}
