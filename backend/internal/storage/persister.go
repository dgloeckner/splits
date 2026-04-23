package storage

import (
	"context"
	"database/sql"
	"errors"
	"log/slog"
	"time"

	"github.com/gloeckner-daniel/home-ergo/internal/event"
)

// Persister consumes events and persists sessions and strokes to
// SQLite. Retries with exponential backoff on transient SQLite errors
// (100 ms → 5 s cap, infinite); never drops.
type Persister struct {
	DB      *sql.DB
	Retries int // exposed for /debug/ingest
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
		return UpdateSessionEnd(ctx, p.DB, e.SessionID, e.SessionEnd.EndedAt, e.SessionEnd.Summary)
	case event.KindLevelChange:
		return nil
	}
	return nil
}
