// Package pipeline wires stages between the sessionizer and the leaf
// consumers (persister, broadcaster). See
// specs/arch/0001-backend-pipeline.md.
package pipeline

import (
	"sync"

	"github.com/gloeckner-daniel/splits/internal/event"
)

// Ring is a bounded replay buffer of events. Writes never block; when
// the buffer is full the oldest entry is dropped. Readers call Since
// to obtain a snapshot of events newer than a given id.
//
// Implemented as a circular buffer (head pointer + size) so writes are
// O(1) at capacity. The earlier shift-on-overflow implementation was
// O(n) per write at cap=10000, which on ARM6 single-core caused a
// visible CPU spike during snapshot replays.
type Ring struct {
	mu   sync.RWMutex
	buf  []event.Event
	cap  int
	head int // next write index; (head - size + cap) % cap is oldest
	size int
}

func NewRing(capacity int) *Ring {
	if capacity < 1 {
		capacity = 1
	}
	return &Ring{buf: make([]event.Event, capacity), cap: capacity}
}

func (r *Ring) Write(e event.Event) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.buf[r.head] = e
	r.head = (r.head + 1) % r.cap
	if r.size < r.cap {
		r.size++
	}
}

// Since returns a copy of all buffered events with ID > afterID.
func (r *Ring) Since(afterID uint64) []event.Event {
	r.mu.RLock()
	defer r.mu.RUnlock()
	var out []event.Event
	start := (r.head - r.size + r.cap) % r.cap
	for i := 0; i < r.size; i++ {
		idx := (start + i) % r.cap
		if r.buf[idx].ID > afterID {
			out = append(out, r.buf[idx])
		}
	}
	return out
}

// Stats returns (oldestID, newestID, size) for /debug/ingest.
// Returns zero values on an empty buffer.
func (r *Ring) Stats() (uint64, uint64, int) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	if r.size == 0 {
		return 0, 0, 0
	}
	oldest := (r.head - r.size + r.cap) % r.cap
	newest := (r.head - 1 + r.cap) % r.cap
	return r.buf[oldest].ID, r.buf[newest].ID, r.size
}
