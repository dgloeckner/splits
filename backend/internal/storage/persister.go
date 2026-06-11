package storage

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"github.com/gloeckner-daniel/splits/internal/event"
	"github.com/gloeckner-daniel/splits/internal/stats"
)

// Persister consumes events and persists sessions and strokes to
// SQLite. Retries with exponential backoff on transient SQLite errors
// (100 ms → 5 s cap, infinite); never drops.
//
// Strokes are batched: appended to a buffer and flushed when the
// buffer reaches BatchSize OR BatchInterval elapses OR a non-stroke
// event arrives that depends on prior strokes being durable
// (session_end reads strokes back). Live SSE broadcast happens in
// parallel via the dispatcher, so batching here only delays SQLite
// writes — never live updates.
type Persister struct {
	DB           *sql.DB
	Retries      int // exposed for /debug/ingest
	MaxRetries   int // 0 = use defaultMaxRetries
	DeadLettered int // count of events dropped after exhausting retries

	// BatchSize and BatchInterval gate stroke-INSERT batching. Zero
	// means "use defaults".
	BatchSize     int
	BatchInterval time.Duration

	// Scheduler is the recompute dispatcher (FEAT-0010 / ADR-0008).
	// Optional: when nil, session_end commits without triggering a
	// recompute — used by tests that don't care about derived stats.
	Scheduler *stats.RecomputeScheduler

	// Out is the channel on which the persister publishes
	// post-persist events (currently only session_finalized after a
	// session_end txn commits). It is the same channel the sessionizer
	// writes into, so dispatcher fan-out (ring + broadcast + persist)
	// handles it for free. Optional: when nil, the persister silently
	// skips the secondary emission. See PRD-0017 / 0017-03.
	Out chan<- event.Event

	// Stamp populates an event's monotonic ID + At fields. Provided by
	// the sessionizer so its and the persister's emissions share the
	// same id allocator. Required when Out is non-nil; otherwise the
	// ring would receive an unstamped event with id 0 and SSE clients
	// could not advance Last-Event-ID past it.
	Stamp func(*event.Event)
}

const (
	minBackoff           = 100 * time.Millisecond
	maxBackoff           = 5 * time.Second
	defaultMaxRetries    = 60
	defaultBatchSize     = 8
	defaultBatchInterval = 250 * time.Millisecond
)

func (p *Persister) Run(ctx context.Context, in <-chan event.Event) error {
	batchSize := p.BatchSize
	if batchSize <= 0 {
		batchSize = defaultBatchSize
	}
	batchInterval := p.BatchInterval
	if batchInterval <= 0 {
		batchInterval = defaultBatchInterval
	}

	pending := make([]StrokeRow, 0, batchSize)
	ticker := time.NewTicker(batchInterval)
	defer ticker.Stop()

	flush := func() {
		if len(pending) == 0 {
			return
		}
		p.flushStrokesWithRetry(ctx, pending)
		pending = pending[:0]
	}

	for {
		select {
		case <-ctx.Done():
			flush()
			return ctx.Err()
		case <-ticker.C:
			flush()
		case e, ok := <-in:
			if !ok {
				flush()
				return nil
			}
			if e.Kind == event.KindStroke && e.Stroke != nil {
				pending = append(pending, StrokeRow{
					GlobalID:  e.ID,
					SessionID: e.SessionID,
					At:        e.At,
					Payload:   *e.Stroke,
				})
				if len(pending) >= batchSize {
					flush()
				}
				continue
			}
			// Non-stroke event: flush stroke buffer first to preserve
			// ordering (session_end reads strokes from DB).
			flush()
			p.applyWithRetry(ctx, e)
		}
	}
}

func (p *Persister) flushStrokesWithRetry(ctx context.Context, rows []StrokeRow) {
	maxRetries := p.MaxRetries
	if maxRetries <= 0 {
		maxRetries = defaultMaxRetries
	}
	// Copy because caller reuses the underlying slice.
	batch := make([]StrokeRow, len(rows))
	copy(batch, rows)
	backoff := minBackoff
	attempts := 0
	for {
		err := InsertStrokesBatch(ctx, p.DB, batch)
		if err == nil {
			return
		}
		if errors.Is(err, context.Canceled) {
			return
		}
		attempts++
		if attempts >= maxRetries {
			slog.Error("storage.persister.dead_letter_batch",
				"first_event_id", batch[0].GlobalID,
				"count", len(batch),
				"retries", attempts,
				"err", err,
			)
			p.DeadLettered += len(batch)
			return
		}
		p.Retries++
		slog.Error("storage.persister.retry_batch", "count", len(batch), "err", err, "backoff", backoff)
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

func (p *Persister) applyWithRetry(ctx context.Context, e event.Event) {
	maxRetries := p.MaxRetries
	if maxRetries <= 0 {
		maxRetries = defaultMaxRetries
	}
	backoff := minBackoff
	attempts := 0
	for {
		err := p.apply(ctx, e)
		if err == nil {
			return
		}
		if errors.Is(err, context.Canceled) {
			return
		}
		attempts++
		if attempts >= maxRetries {
			sessionID := e.SessionID
			slog.Error("storage.persister.dead_letter",
				"event_id", e.ID,
				"kind", e.Kind,
				"session_id", sessionID,
				"retries", attempts,
				"err", err,
			)
			p.DeadLettered++
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
		// Should be batched by Run; kept for legacy callers / tests.
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

// applySessionEnd writes the enriched session summary at session_end via
// FinaliseSession. Per FEAT-0015 Slice 4 / ADR-0011 the strokes are
// retained (canonical replay input); only FEAT-0009 hard-delete removes
// them.
func (p *Persister) applySessionEnd(ctx context.Context, e event.Event) error {
	if e.SessionEnd == nil {
		return fmt.Errorf("applySessionEnd: event %d has nil SessionEnd", e.ID)
	}
	// §Falschstart: re-tag pre-GO strokes as warmup so every downstream
	// consumer sees only post-GO strokes as work-phase. Must run before
	// strokes are loaded so the in-DB phase tags are correct.
	if e.SessionEnd.Summary.RaceGoStrokeNo > 1 {
		if _, err := p.DB.ExecContext(ctx,
			`UPDATE strokes SET phase = 'warmup' WHERE session_id = ? AND stroke_no < ?`,
			e.SessionID, e.SessionEnd.Summary.RaceGoStrokeNo); err != nil {
			return err
		}
	}

	// Empty-session prune: a session_end with no persisted strokes AND an
	// empty authoritative summary is a phantom (a POST /session/start that
	// never received a frame). Delete the row rather than persist a
	// zero-totals ghost that pollutes Verlauf, the trends totals, and the
	// Rekorde grid. A zero-stroke end with a non-empty summary (strokes
	// broadcast but not yet persisted) is still finalised — the sessionizer
	// summary is authoritative (see finalise.go:87-89).
	strokes, err := LoadSessionStrokes(ctx, p.DB, e.SessionID)
	if err != nil {
		return err
	}
	if len(strokes) == 0 && e.SessionEnd.Summary.TotalStrokes == 0 {
		if err := DeleteEmptySession(ctx, p.DB, e.SessionID); err != nil {
			return err
		}
		slog.Info("storage.persister.prune_empty_session", "session_id", e.SessionID)
		return nil
	}

	summary, err := FinaliseSession(ctx, p.DB, e.SessionID, e.SessionEnd.EndedAt,
		e.SessionEnd.Summary, strokes, e.ID, FinaliseEnded, p.Scheduler)
	if err != nil {
		return err
	}
	p.emitSessionFinalized(ctx, e.SessionID, summary)
	return nil
}

// emitSessionFinalized publishes the enriched summary on Out so SSE
// clients can replace their latched session_end summary with the
// post-persist version (Race result etc. populated). No-op when the
// hook surface isn't wired (tests).
func (p *Persister) emitSessionFinalized(ctx context.Context, sessionID string, summary event.SessionSummary) {
	if p.Out == nil || p.Stamp == nil {
		return
	}
	// During shutdown the sessionizer closes Out before the persister
	// drains its last events. The durable summary in SQLite is the
	// source of truth for any client that reconnects; a send-on-closed
	// panic here would mask a successful commit, so we recover and
	// log.
	defer func() {
		if r := recover(); r != nil {
			slog.Error("storage.persister.session_finalized_drop_on_closed_out",
				"session_id", sessionID, "panic", r)
		}
	}()
	if ctx.Err() != nil {
		return
	}
	fin := event.Event{
		Kind:      event.KindSessionFinalized,
		SessionID: sessionID,
		SessionFinalized: &event.SessionFinalizedPayload{
			Summary: summary,
		},
	}
	p.Stamp(&fin)
	select {
	case p.Out <- fin:
	case <-ctx.Done():
	}
}


