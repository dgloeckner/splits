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

func UpdateSessionEnd(ctx context.Context, db *sql.DB, id string, endedAt time.Time, s event.SessionSummary) error {
	blob, err := json.Marshal(s)
	if err != nil {
		return err
	}
	_, err = db.ExecContext(ctx,
		`UPDATE sessions SET ended_at=?, total_distance_m=?, total_time_sec=?, total_strokes=?, summary_json=? WHERE id=?`,
		endedAt.UTC().Format(time.RFC3339Nano), s.TotalDistanceM, s.TotalTimeSec, s.TotalStrokes, string(blob), id)
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
