package storage

import (
	"context"
	"database/sql"
	"errors"
	"log/slog"
	"time"

	"github.com/gloeckner-daniel/home-ergo/internal/event"
	"github.com/gloeckner-daniel/home-ergo/internal/stats"
)

// Persister consumes events and persists sessions and strokes to
// SQLite. Retries with exponential backoff on transient SQLite errors
// (100 ms → 5 s cap, infinite); never drops.
type Persister struct {
	DB      *sql.DB
	Retries int // exposed for /debug/ingest

	// Scheduler is the recompute dispatcher (FEAT-0010 / ADR-0008).
	// Optional: when nil, session_end commits without triggering a
	// recompute — used by tests that don't care about derived stats.
	Scheduler *stats.RecomputeScheduler
}

const (
	minBackoff = 100 * time.Millisecond
	maxBackoff = 5 * time.Second
)

func (p *Persister) Run(ctx context.Context, in <-chan event.Event) error {
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case e, ok := <-in:
			if !ok {
				return nil
			}
			p.applyWithRetry(ctx, e)
		}
	}
}

func (p *Persister) applyWithRetry(ctx context.Context, e event.Event) {
	backoff := minBackoff
	for {
		err := p.apply(ctx, e)
		if err == nil {
			return
		}
		if errors.Is(err, context.Canceled) {
			return
		}
		p.Retries++
		slog.Error("storage.persister.retry", "event_id", e.ID, "err", err, "backoff", backoff)
		select {
		case <-time.After(backoff):
		case <-ctx.Done():
			return
		}
		backoff *= 2
		if backoff > maxBackoff {
			backoff = maxBackoff
		}
	}
}

func (p *Persister) apply(ctx context.Context, e event.Event) error {
	switch e.Kind {
	case event.KindSessionStart:
		return InsertSession(ctx, p.DB, e.SessionID, e.SessionStart.RowerID, e.SessionStart.StartedAt, e.SessionStart.InitialLevel, e.SessionStart.WorkoutID)
	case event.KindStroke:
		return InsertStroke(ctx, p.DB, e.ID, e.SessionID, e.At, *e.Stroke)
	case event.KindSessionEnd:
		return p.applySessionEnd(ctx, e)
	case event.KindLevelChange:
		return nil
	case event.KindWorkoutAttached:
		return UpdateSessionWorkout(ctx, p.DB, e.SessionID, e.WorkoutAttached.WorkoutID)
	}
	return nil
}

// applySessionEnd compacts the just-ended session in a single
// transaction: read strokes, compute samples, write enriched summary,
// delete strokes. After this returns nil, the session's per-stroke
// data is permanently gone — only summary_json + totals remain
// (FEAT-0009 Mode 0).
func (p *Persister) applySessionEnd(ctx context.Context, e event.Event) error {
	tx, err := p.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()

	strokes, err := LoadSessionStrokes(ctx, tx, e.SessionID)
	if err != nil {
		return err
	}
	workStrokes := filterWorkStrokes(strokes)
	summary := e.SessionEnd.Summary
	summary.Samples = stats.ComputeSamples(workStrokes, stats.DefaultBucketStrokes)
	summary.PBCandidates = stats.ComputeCandidates(workStrokes)
	if err := UpdateSessionEndWithEventID(ctx, tx, e.SessionID, e.SessionEnd.EndedAt, summary, e.ID); err != nil {
		return err
	}
	if err := DeleteSessionStrokes(ctx, tx, e.SessionID); err != nil {
		return err
	}
	if err := tx.Commit(); err != nil {
		return err
	}
	if p.Scheduler != nil {
		var rowerID string
		if err := p.DB.QueryRowContext(ctx,
			`SELECT rower_id FROM sessions WHERE id = ?`, e.SessionID).Scan(&rowerID); err == nil && rowerID != "" {
			stats.OnSessionChange(p.Scheduler, rowerID, stats.SessionCreated)
		}
	}
	return nil
}

func filterWorkStrokes(in []event.StrokePayload) []event.StrokePayload {
	out := make([]event.StrokePayload, 0, len(in))
	for _, s := range in {
		if s.Phase == "" || s.Phase == "work" {
			out = append(out, s)
		}
	}
	return out
}
