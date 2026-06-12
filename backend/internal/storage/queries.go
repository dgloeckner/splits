package storage

import (
	"context"
	"database/sql"
	"encoding/json"
	"time"

	"github.com/gloeckner-daniel/splits/internal/event"
	"github.com/gloeckner-daniel/splits/internal/stats"
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
	QueryRowContext(ctx context.Context, query string, args ...any) *sql.Row
}

// samplesEnvelope is the post-refactor shape of summary_json: only the
// downsampled per-bucket timeseries used by session-detail charts.
type samplesEnvelope struct {
	Samples *event.SessionSamples `json:"samples,omitempty"`
}

func UpdateSessionEnd(ctx context.Context, db dbExec, id string, endedAt time.Time, s event.SessionSummary) error {
	return UpdateSessionEndWithEventID(ctx, db, id, endedAt, s, 0)
}

func UpdateSessionEndWithEventID(ctx context.Context, db dbExec, id string, endedAt time.Time, s event.SessionSummary, lastEventID uint64) error {
	var summaryStr sql.NullString
	if s.Samples != nil {
		blob, err := json.Marshal(samplesEnvelope{Samples: s.Samples})
		if err != nil {
			return err
		}
		summaryStr = sql.NullString{String: string(blob), Valid: true}
	}
	if _, err := db.ExecContext(ctx, `
		UPDATE sessions SET
			ended_at = ?,
			total_distance_m = ?, total_time_sec = ?, total_strokes = ?,
			avg_power_w = ?, peak_power_w = ?,
			avg_spm = ?, avg_dps = ?, avg_spi = ?,
			avg_pace_sec_per_500m = ?, session_calories = ?,
			summary_json = ?, last_event_id = ?
		WHERE id = ?`,
		endedAt.UTC().Format(time.RFC3339Nano),
		s.TotalDistanceM, s.TotalTimeSec, s.TotalStrokes,
		float64(s.AvgPowerW), float64(s.PeakPowerW),
		s.AvgSPM, s.AvgDPS, float64(s.AvgSPI),
		float64(s.AvgPaceSecPer500m), float64(s.SessionCalories),
		summaryStr, lastEventID, id,
	); err != nil {
		return err
	}

	// Replace any existing candidate rows for this session (idempotent
	// for re-finalises like the boot janitor).
	if err := DeleteSessionCandidates(ctx, db, id); err != nil {
		return err
	}
	cands, _ := s.PBCandidates.(*stats.PBCandidates)
	if cands == nil {
		return nil
	}

	var rowerID, startedAt string
	if err := db.QueryRowContext(ctx,
		`SELECT rower_id, started_at FROM sessions WHERE id = ?`, id,
	).Scan(&rowerID, &startedAt); err != nil {
		return err
	}

	for _, c := range cands.Distance {
		if _, err := db.ExecContext(ctx, `
			INSERT INTO session_pb_distance_candidates(
				session_id, rower_id, started_at, distance_m, time_sec,
				window_start_stroke, window_end_stroke)
			VALUES(?, ?, ?, ?, ?, ?, ?)`,
			id, rowerID, startedAt, c.DistanceM, c.TimeSec,
			c.WindowStartStroke, c.WindowEndStroke,
		); err != nil {
			return err
		}
	}
	for _, c := range cands.Window {
		if _, err := db.ExecContext(ctx, `
			INSERT INTO session_pb_window_candidates(
				session_id, rower_id, started_at, metric, window_kind,
				window_size, value)
			VALUES(?, ?, ?, ?, ?, ?, ?)`,
			id, rowerID, startedAt, c.Metric, c.Kind, c.Size, c.Value,
		); err != nil {
			return err
		}
	}
	if w := cands.Workout; w != nil {
		if _, err := db.ExecContext(ctx, `
			INSERT INTO session_pb_workout_candidate(
				session_id, rower_id, started_at, shape_hash, mode,
				value_kind, value)
			VALUES(?, ?, ?, ?, ?, ?, ?)`,
			id, rowerID, startedAt, w.ShapeHash, w.Mode, w.ValueKind, w.Value,
		); err != nil {
			return err
		}
	}
	return nil
}

// DeleteSessionCandidates removes every per-session candidate row. Used
// by the persister (idempotent re-finalise) and by soft-delete: derived
// rows don't survive the parent's soft-deleted state, so recompute
// queries can scope by rower without joining sessions.
func DeleteSessionCandidates(ctx context.Context, db dbExec, sessionID string) error {
	for _, q := range []string{
		`DELETE FROM session_pb_distance_candidates WHERE session_id = ?`,
		`DELETE FROM session_pb_window_candidates   WHERE session_id = ?`,
		`DELETE FROM session_pb_workout_candidate   WHERE session_id = ?`,
		`DELETE FROM session_consistency            WHERE session_id = ?`,
	} {
		if _, err := db.ExecContext(ctx, q, sessionID); err != nil {
			return err
		}
	}
	return nil
}

// LoadSessionStrokes returns every stroke for a session, ordered by
// stroke_no. Used by the persister at session_end to compute samples
// (and PB candidates, FEAT-0010) before the strokes are deleted.
func LoadSessionStrokes(ctx context.Context, db dbExec, sessionID string) ([]event.StrokePayload, error) {
	rows, err := db.QueryContext(ctx, `
		SELECT stroke_no, time_sec, distance_m, spm, power_w, cal_per_hr, level,
		       dps, stroke_cycle_sec, pace_sec_per_500m, energy_joules, phase
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
			&p.EnergyJoules, &p.Phase); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

func InsertStroke(ctx context.Context, db *sql.DB, globalID uint64, sessionID string, at time.Time, p event.StrokePayload) error {
	phase := p.Phase
	if phase == "" {
		phase = "work"
	}
	_, err := db.ExecContext(ctx,
		`INSERT INTO strokes(
			global_id, session_id, stroke_no, time_sec, distance_m, spm, power_w, cal_per_hr, level,
			dps, stroke_cycle_sec, pace_sec_per_500m, energy_joules, at, phase
		) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		globalID, sessionID, p.StrokeNo, p.TimeSec, p.DistanceM, p.SPM, p.PowerW, p.CalPerHr, p.Level,
		p.DPS, p.StrokeCycleSec, p.PaceSecPer500m, p.EnergyJoules,
		at.UTC().Format(time.RFC3339Nano), phase)
	return err
}

// StrokeRow bundles the parameters needed to insert one stroke row.
type StrokeRow struct {
	GlobalID  uint64
	SessionID string
	At        time.Time
	Payload   event.StrokePayload
}

// InsertStrokesBatch inserts multiple strokes in a single transaction.
// Used by the persister's batch flusher to amortize fsync cost on
// resource-constrained hosts (Pi Zero / SD card).
func InsertStrokesBatch(ctx context.Context, db *sql.DB, rows []StrokeRow) error {
	if len(rows) == 0 {
		return nil
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	stmt, err := tx.PrepareContext(ctx,
		`INSERT INTO strokes(
			global_id, session_id, stroke_no, time_sec, distance_m, spm, power_w, cal_per_hr, level,
			dps, stroke_cycle_sec, pace_sec_per_500m, energy_joules, at, phase
		) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
	if err != nil {
		return err
	}
	defer stmt.Close()
	for _, r := range rows {
		phase := r.Payload.Phase
		if phase == "" {
			phase = "work"
		}
		if _, err := stmt.ExecContext(ctx,
			r.GlobalID, r.SessionID, r.Payload.StrokeNo, r.Payload.TimeSec, r.Payload.DistanceM,
			r.Payload.SPM, r.Payload.PowerW, r.Payload.CalPerHr, r.Payload.Level,
			r.Payload.DPS, r.Payload.StrokeCycleSec, r.Payload.PaceSecPer500m, r.Payload.EnergyJoules,
			r.At.UTC().Format(time.RFC3339Nano), phase); err != nil {
			return err
		}
	}
	return tx.Commit()
}

// DeleteEmptySession removes a session row that finalised with no
// strokes and no real totals — a phantom from a POST /session/start
// that never received a frame. Runs in its own transaction. FK
// enforcement (DSN _pragma=foreign_keys(on)) guarantees no orphan
// strokes can survive; for a truly empty session there are none.
func DeleteEmptySession(ctx context.Context, db *sql.DB, id string) error {
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	if _, err := tx.ExecContext(ctx, `DELETE FROM sessions WHERE id = ?`, id); err != nil {
		return err
	}
	return tx.Commit()
}
