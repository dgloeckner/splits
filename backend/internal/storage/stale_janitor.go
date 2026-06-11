package storage

import (
	"context"
	"database/sql"
	"log/slog"
	"time"

	"github.com/gloeckner-daniel/splits/internal/event"
)

// StaleOpenThreshold is the idle window after which an open session
// (ended_at IS NULL) is flagged `status='stale-open'`. ADR-0010 / FEAT-0015
// Slice 3.
const StaleOpenThreshold = 5 * time.Minute

// StaleJanitorTick is the sweep cadence run by StartStaleJanitor.
const StaleJanitorTick = 1 * time.Minute

// SessionLiveness reports how the DB regards a session id; it is the
// transport-friendly mirror of session.SessionStatus, kept in this
// package to avoid importing `session` from `storage` (which would
// invert the dependency direction).
type SessionLiveness int

const (
	LivenessUnknown SessionLiveness = iota
	LivenessLive
	LivenessStaleOpen
	LivenessEnded
	LivenessMissing
)

// CheckSessionLiveness inspects the sessions row for `id` and returns
// the appropriate verdict. DB errors collapse to LivenessUnknown so
// the caller can fall back to its in-memory cache rather than
// destroying it on a transient SQLite hiccup.
func CheckSessionLiveness(ctx context.Context, db *sql.DB, id string) SessionLiveness {
	var endedAt sql.NullString
	var status string
	err := db.QueryRowContext(ctx,
		`SELECT ended_at, COALESCE(status,'open') FROM sessions WHERE id = ?`, id).
		Scan(&endedAt, &status)
	if err == sql.ErrNoRows {
		return LivenessMissing
	}
	if err != nil {
		return LivenessUnknown
	}
	if endedAt.Valid && endedAt.String != "" {
		return LivenessEnded
	}
	if status == "stale-open" {
		return LivenessStaleOpen
	}
	return LivenessLive
}

// StaleSessionClearer is invoked by SweepStaleOpen for each session id
// it flips to status='stale-open'. The sessionizer wires this so its
// in-memory `currentSessionStart` is dropped at the same moment the
// row becomes stale — without it, the live snapshot keeps reporting a
// dead session and the DELETE handler returns 409 for "Verwerfen".
type StaleSessionClearer interface {
	ClearActiveSession(id string)
}

// SweepStaleOpen marks sessions whose ended_at is NULL and whose most
// recent stroke is older than `threshold` as `status='stale-open'`.
// Sessions with no strokes at all are not flagged — there is nothing
// to finalise from. Returns the number of rows updated. Idempotent:
// already-stale-open rows are no-ops.
func SweepStaleOpen(ctx context.Context, db *sql.DB, threshold time.Duration) (int, error) {
	return SweepStaleOpenWithClear(ctx, db, threshold, nil)
}

// SweepStaleOpenWithClear is SweepStaleOpen + post-flip notification.
// For every row flipped, `clearer.ClearActiveSession(id)` is invoked.
// Clearer is allowed to be nil (boot janitor in tests that don't run
// a sessionizer).
func SweepStaleOpenWithClear(ctx context.Context, db *sql.DB, threshold time.Duration, clearer StaleSessionClearer) (int, error) {
	cutoff := time.Now().UTC().Add(-threshold).Format(time.RFC3339Nano)
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return 0, err
	}
	defer func() { _ = tx.Rollback() }()

	// Collect ids first so we can both update them and notify the
	// clearer; SQLite's RETURNING would be cleaner but isn't used
	// elsewhere in this codebase yet.
	rows, err := tx.QueryContext(ctx, `
		SELECT s.id FROM sessions s
		JOIN strokes st ON st.session_id = s.id
		WHERE s.ended_at IS NULL
		  AND s.status != 'stale-open'
		GROUP BY s.id
		HAVING MAX(st.at) < ?`, cutoff)
	if err != nil {
		return 0, err
	}
	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return 0, err
		}
		ids = append(ids, id)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return 0, err
	}
	for _, id := range ids {
		if _, err := tx.ExecContext(ctx,
			`UPDATE sessions SET status = 'stale-open' WHERE id = ?`, id); err != nil {
			return 0, err
		}
	}
	if err := tx.Commit(); err != nil {
		return 0, err
	}
	if clearer != nil {
		for _, id := range ids {
			clearer.ClearActiveSession(id)
		}
	}
	return len(ids), nil
}

// StaleOpenSessionRow is the read-side shape for the resume API.
// LastStrokeAt is the MAX(strokes.at) seen at query time; the rest is
// pulled directly from the sessions row.
type StaleOpenSessionRow struct {
	ID             string    `json:"id"`
	StartedAt      time.Time `json:"started_at"`
	LastStrokeAt   time.Time `json:"last_stroke_at"`
	TotalDistanceM int       `json:"total_distance_m"`
	WorkoutID      string    `json:"workout_id,omitempty"`
	// Mode is the attached workout's mode (e.g. "race", "distance",
	// "just_row") or "" when no workout is attached. The recovery card
	// branches on this to hide "rejoin live" for race rows per
	// ADR-0012 (race-mode non-resumable).
	Mode string `json:"mode,omitempty"`
}

// ListStaleOpenSessions returns every `status='stale-open'` session for
// a rower, newest first. Server-computed total_distance_m comes from
// the last stroke (strokes are cumulative).
func ListStaleOpenSessions(ctx context.Context, db *sql.DB, rowerID string) ([]StaleOpenSessionRow, error) {
	rows, err := db.QueryContext(ctx, `
		SELECT s.id, s.started_at, COALESCE(s.workout_id, ''),
		       MAX(st.at) AS last_stroke_at,
		       COALESCE((SELECT distance_m FROM strokes
		                 WHERE session_id = s.id
		                 ORDER BY stroke_no DESC LIMIT 1), 0) AS last_distance_m,
		       COALESCE(w.mode, '') AS mode
		FROM sessions s
		JOIN strokes st ON st.session_id = s.id
		LEFT JOIN workout w ON w.id = s.workout_id
		WHERE s.status = 'stale-open'
		  AND s.ended_at IS NULL
		  AND s.rower_id = ?
		GROUP BY s.id
		ORDER BY s.started_at DESC`, rowerID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []StaleOpenSessionRow
	for rows.Next() {
		var (
			r            StaleOpenSessionRow
			startedStr   string
			lastStrokeStr string
		)
		if err := rows.Scan(&r.ID, &startedStr, &r.WorkoutID, &lastStrokeStr, &r.TotalDistanceM, &r.Mode); err != nil {
			return nil, err
		}
		t, err := time.Parse(time.RFC3339Nano, startedStr)
		if err != nil {
			return nil, err
		}
		r.StartedAt = t
		ls, err := time.Parse(time.RFC3339Nano, lastStrokeStr)
		if err != nil {
			return nil, err
		}
		r.LastStrokeAt = ls
		out = append(out, r)
	}
	return out, rows.Err()
}

// FinalizeStaleSession closes a `status='stale-open'` (or open) session
// via FinaliseSession (FinaliseStale reason). Uses the most recent
// stroke's wall-clock timestamp as ended_at. Idempotent: the
// WHERE ended_at IS NULL guard in FinaliseSession prevents double-writes.
// Returns ErrZeroStrokes if the session has no strokes (callers should
// return 204).
func FinalizeStaleSession(ctx context.Context, db *sql.DB, sessionID string) error {
	// Recover the last stroke's wall-clock `at` as ended_at.
	var lastAtStr string
	if err := db.QueryRowContext(ctx,
		`SELECT MAX(at) FROM strokes WHERE session_id = ?`, sessionID).Scan(&lastAtStr); err != nil {
		return err
	}
	endedAt := time.Now().UTC()
	if lastAtStr != "" {
		if t, perr := time.Parse(time.RFC3339Nano, lastAtStr); perr == nil {
			endedAt = t
		}
	}

	_, err := FinaliseSession(ctx, db, sessionID, endedAt, event.SessionSummary{}, nil, 0, FinaliseStale, nil)
	return err
}

// StartStaleJanitor launches a 1-minute sweep goroutine that runs
// until ctx is cancelled. Errors are logged, never returned: the
// janitor must not crash the process for a transient SQLite hiccup.
// `clearer` may be nil (e.g. headless tooling); production wires it
// to the live sessionizer so flipped sessions are also evicted from
// memory. `threshold` is the idle window after which an open session
// is flagged stale-open; it should be ≥ the sessionizer's ResumeWindow
// so that merely-paused sessions are never marked stale prematurely.
func StartStaleJanitor(ctx context.Context, db *sql.DB, clearer StaleSessionClearer, threshold time.Duration) {
	go func() {
		t := time.NewTicker(StaleJanitorTick)
		defer t.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-t.C:
				if _, err := SweepStaleOpenWithClear(ctx, db, threshold, clearer); err != nil {
					slog.Error("stale_janitor.sweep", "err", err)
				}
				// B6: self-heal rower stats every tick. If the async
				// per-session recompute failed or was interrupted by
				// shutdown, the next sweep catches it and the user
				// never stays on stale PB / lifetime numbers for
				// longer than one tick.
				if err := RecomputeStaleRowerStats(ctx, db); err != nil {
					slog.Error("stale_janitor.recompute_stale", "err", err)
				}
			}
		}
	}()
}
