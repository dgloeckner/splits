package stats

import (
	"context"
	"database/sql"
	"log/slog"
	"sync"
)

// RecomputeScheduler dispatches background recomputes per rower.
// Multiple changes for the same rower coalesce — only the latest job
// runs. Used by on_session_change to avoid blocking HTTP handlers
// (FEAT-0010 post-session-end UX).
type RecomputeScheduler struct {
	db *sql.DB

	mu      sync.Mutex
	pending map[string]bool          // rower_id → has-pending-job
	running map[string]bool          // rower_id → currently processing
	idle    map[string]chan struct{} // rower_id → channel closed when no work in flight
}

func NewRecomputeScheduler(db *sql.DB) *RecomputeScheduler {
	return &RecomputeScheduler{
		db:      db,
		pending: map[string]bool{},
		running: map[string]bool{},
		idle:    map[string]chan struct{}{},
	}
}

// Trigger asks for a recompute of `rowerID`. Returns immediately. If
// a recompute is already running for that rower, the next one is
// queued (idempotent — duplicate trigger calls collapse).
func (s *RecomputeScheduler) Trigger(rowerID string) {
	if rowerID == "" {
		return
	}
	s.mu.Lock()
	// Mark this rower as not-idle so any new Wait observes the in-flight job.
	if _, ok := s.idle[rowerID]; !ok {
		s.idle[rowerID] = make(chan struct{})
	}
	if s.running[rowerID] {
		s.pending[rowerID] = true
		s.mu.Unlock()
		return
	}
	s.running[rowerID] = true
	s.mu.Unlock()
	go s.run(rowerID)
}

func (s *RecomputeScheduler) run(rowerID string) {
	for {
		ctx := context.Background()
		if err := Recompute(ctx, s.db, rowerID); err != nil {
			slog.Error("stats.recompute", "rower_id", rowerID, "err", err)
		}
		s.mu.Lock()
		if !s.pending[rowerID] {
			s.running[rowerID] = false
			// Signal idle: close + remove the channel so future Triggers create a fresh one.
			if ch, ok := s.idle[rowerID]; ok {
				close(ch)
				delete(s.idle, rowerID)
			}
			s.mu.Unlock()
			return
		}
		delete(s.pending, rowerID)
		s.mu.Unlock()
	}
}

// Wait blocks until there is no in-flight or queued recompute for
// rowerID, or the context is done. Returns nil if the recompute drained
// (or was already idle); returns ctx.Err() if the context expired first.
//
// Callers (e.g. DELETE /sessions/{id}) use this to ensure subsequent
// reads observe the post-recompute state.
func (s *RecomputeScheduler) Wait(ctx context.Context, rowerID string) error {
	if rowerID == "" {
		return nil
	}
	s.mu.Lock()
	ch, ok := s.idle[rowerID]
	s.mu.Unlock()
	if !ok {
		return nil
	}
	select {
	case <-ch:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

// OnSessionChange is the single entry-point for session-lifecycle
// events. It is called inside the same request that mutated the
// session (creation = persister at session_end; hard delete = DELETE
// handler). Recompute itself runs asynchronously per
// RecomputeScheduler.
//
// The function is intentionally minimal — it just dispatches. The
// real work happens in Recompute.
func OnSessionChange(s *RecomputeScheduler, rowerID string, change SessionChange) {
	switch change {
	case SessionCreated, SessionHardDeleted:
		s.Trigger(rowerID)
	}
}
