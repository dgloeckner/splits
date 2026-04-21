// Package pipeline wires stages between the sessionizer and the leaf
// consumers (persister, broadcaster). See
// specs/arch/0001-backend-pipeline.md.
package pipeline

import (
	"sync"

	"github.com/gloeckner-daniel/home-ergo/internal/event"
)

// Ring is a bounded replay buffer of events. Writes never block; when
// the buffer is full the oldest entry is dropped. Readers call Since
// to obtain a snapshot of events newer than a given id.
type Ring struct {
	mu  sync.RWMutex
	buf []event.Event
	cap int
}

func NewRing(capacity int) *Ring {
	if capacity < 1 {
		capacity = 1
	}
	return &Ring{buf: make([]event.Event, 0, capacity), cap: capacity}
}

func (r *Ring) Write(e event.Event) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if len(r.buf) == r.cap {
		copy(r.buf, r.buf[1:])
		r.buf = r.buf[:len(r.buf)-1]
	}
	r.buf = append(r.buf, e)
}

// Since returns a copy of all buffered events with ID > afterID.
func (r *Ring) Since(afterID uint64) []event.Event {
	r.mu.RLock()
	defer r.mu.RUnlock()
	var out []event.Event
	for _, e := range r.buf {
		if e.ID > afterID {
			out = append(out, e)
		}
	}
	return out
}

// Stats returns (oldestID, newestID, size) for /debug/ingest.
// Returns zero values on an empty buffer.
func (r *Ring) Stats() (uint64, uint64, int) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	if len(r.buf) == 0 {
		return 0, 0, 0
	}
	return r.buf[0].ID, r.buf[len(r.buf)-1].ID, len(r.buf)
}
