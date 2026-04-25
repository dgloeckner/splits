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
	pending map[string]bool // rower_id → has-pending-job
	running map[string]bool
}

func NewRecomputeScheduler(db *sql.DB) *RecomputeScheduler {
	return &RecomputeScheduler{db: db, pending: map[string]bool{}, running: map[string]bool{}}
}

// Trigger asks for a recompute of `rowerID`. Returns immediately. If
// a recompute is already running for that rower, the next one is
// queued (idempotent — duplicate trigger calls collapse).
func (s *RecomputeScheduler) Trigger(rowerID string) {
	if rowerID == "" {
		return
	}
	s.mu.Lock()
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
			s.mu.Unlock()
			return
		}
		delete(s.pending, rowerID)
		s.mu.Unlock()
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
	case SessionCreated, SessionHardDeleted, SessionCompacted:
		s.Trigger(rowerID)
	}
}
