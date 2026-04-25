package storage

import (
	"context"
	"database/sql"
	"encoding/json"
	"time"

	"github.com/gloeckner-daniel/home-ergo/internal/event"
)

func InsertSession(ctx context.Context, db *sql.DB, id, rowerID string, startedAt time.Time, initialLevel int, workoutID string) error {
	var wid any
	if workoutID != "" {
		wid = workoutID
	}
	_, err := db.ExecContext(ctx,
		`INSERT INTO sessions(id, rower_id, started_at, initial_level, workout_id) VALUES(?, ?, ?, ?, ?)`,
		id, rowerID, startedAt.UTC().Format(time.RFC3339Nano), initialLevel, wid)
	return err
}

func UpdateSessionWorkout(ctx context.Context, db *sql.DB, id, workoutID string) error {
	var wid any
	if workoutID != "" {
		wid = workoutID
	}
	_, err := db.ExecContext(ctx,
		`UPDATE sessions SET workout_id=? WHERE id=?`, wid, id)
	return err
}

// dbExec is the minimal subset of *sql.DB / *sql.Tx that the write
// helpers need. Lets callers run inside a transaction.
type dbExec interface {
	ExecContext(ctx context.Context, query string, args ...any) (sql.Result, error)
	QueryContext(ctx context.Context, query string, args ...any) (*sql.Rows, error)
}

func UpdateSessionEnd(ctx context.Context, db dbExec, id string, endedAt time.Time, s event.SessionSummary) error {
	blob, err := json.Marshal(s)
	if err != nil {
		return err
	}
	_, err = db.ExecContext(ctx,
		`UPDATE sessions SET ended_at=?, total_distance_m=?, total_time_sec=?, total_strokes=?, summary_json=? WHERE id=?`,
		endedAt.UTC().Format(time.RFC3339Nano), s.TotalDistanceM, s.TotalTimeSec, s.TotalStrokes, string(blob), id)
	return err
}

// LoadSessionStrokes returns every stroke for a session, ordered by
// stroke_no. Used by the persister at session_end to compute samples
// (and PB candidates, FEAT-0010) before the strokes are deleted.
func LoadSessionStrokes(ctx context.Context, db dbExec, sessionID string) ([]event.StrokePayload, error) {
	rows, err := db.QueryContext(ctx, `
		SELECT stroke_no, time_sec, distance_m, spm, power_w, cal_per_hr, level,
		       dps, stroke_cycle_sec, pace_sec_per_500m, energy_joules
		FROM strokes WHERE session_id = ? ORDER BY stroke_no`, sessionID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []event.StrokePayload
	for rows.Next() {
		var p event.StrokePayload
		if err := rows.Scan(&p.StrokeNo, &p.TimeSec, &p.DistanceM, &p.SPM, &p.PowerW,
			&p.CalPerHr, &p.Level, &p.DPS, &p.StrokeCycleSec, &p.PaceSecPer500m,
			&p.EnergyJoules); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

// DeleteSessionStrokes removes every strokes row for a session.
// Called from the persister immediately after session_end summary has
// been written (FEAT-0009 Mode 0).
func DeleteSessionStrokes(ctx context.Context, db dbExec, sessionID string) error {
	_, err := db.ExecContext(ctx, `DELETE FROM strokes WHERE session_id = ?`, sessionID)
	return err
}

func InsertStroke(ctx context.Context, db *sql.DB, globalID uint64, sessionID string, at time.Time, p event.StrokePayload) error {
	_, err := db.ExecContext(ctx,
		`INSERT INTO strokes(
			global_id, session_id, stroke_no, time_sec, distance_m, spm, power_w, cal_per_hr, level,
			dps, stroke_cycle_sec, pace_sec_per_500m, energy_joules, at
		) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		globalID, sessionID, p.StrokeNo, p.TimeSec, p.DistanceM, p.SPM, p.PowerW, p.CalPerHr, p.Level,
		p.DPS, p.StrokeCycleSec, p.PaceSecPer500m, p.EnergyJoules,
		at.UTC().Format(time.RFC3339Nano))
	return err
}
