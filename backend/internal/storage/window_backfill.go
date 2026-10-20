package storage

import (
	"context"
	"database/sql"
	"encoding/json"

	"github.com/gloeckner-daniel/splits/internal/event"
	"github.com/gloeckner-daniel/splits/internal/stats"
)

// BackfillAnalysisWindow computes the analysis window (FEAT-0011
// §Analysefenster) for a session finalised before finalise stored one,
// from its stroke rows and workout, and sets it on samples. It returns
// false, leaving samples untouched, when samples already carry a window,
// the stroke rows are gone, or the work strokes no longer bucket into
// the stored series (the window would point at the wrong buckets).
// Nothing is written; PersistSamplesWindow stores the result.
func BackfillAnalysisWindow(ctx context.Context, db *sql.DB, sessionID string, samples *event.SessionSamples) (bool, error) {
	if samples == nil || samples.Window != nil || samples.BucketStrokes <= 0 {
		return false, nil
	}
	strokes, err := LoadSessionStrokes(ctx, db, sessionID)
	if err != nil || len(strokes) == 0 {
		return false, err
	}
	var mode, params string
	if err := db.QueryRowContext(ctx, `
		SELECT COALESCE(w.mode, ''), COALESCE(w.params_json, '')
		FROM sessions s
		LEFT JOIN workout w ON w.id = s.workout_id
		WHERE s.id = ?`, sessionID).Scan(&mode, &params); err != nil {
		return false, err
	}
	work := FilterWorkStrokes(strokes)
	bs := samples.BucketStrokes
	if (len(work)+bs-1)/bs != len(samples.Split) {
		return false, nil
	}
	w := stats.ComputeAnalysisWindow(work, bs, workoutGoal(mode, params, strokes))
	if w == nil {
		return false, nil
	}
	samples.Window = w
	return true, nil
}

// PersistSamplesWindow writes w into the session's
// summary_json.samples.window.
func PersistSamplesWindow(ctx context.Context, db *sql.DB, sessionID string, w *event.SamplesWindow) error {
	raw, err := json.Marshal(w)
	if err != nil {
		return err
	}
	_, err = db.ExecContext(ctx, `
		UPDATE sessions SET summary_json = json_set(summary_json, '$.samples.window', json(?))
		WHERE id = ? AND json_type(summary_json, '$.samples') = 'object'`, string(raw), sessionID)
	return err
}
