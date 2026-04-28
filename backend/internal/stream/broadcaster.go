// Package stream owns the SSE fan-out layer: broadcaster + the HTTP
// handler at /api/v1/stream. See specs/arch/0001-backend-pipeline.md.
package stream

import (
	"context"
	"sync"

	"github.com/gloeckner-daniel/splits/internal/event"
)

// BroadcasterPerClientBuffer is the per-client outbound channel size.
// Exposed for tests.
const BroadcasterPerClientBuffer = 64

// Broadcaster fans events out to every subscribed client. A client
// whose receive buffer fills is dropped (its channel is closed); the
// HTTP handler detects the closure and ends the request so the
// browser's EventSource reconnects.
type Broadcaster struct {
	in      <-chan event.Event
	mu      sync.Mutex
	clients map[int]chan event.Event
	nextID  int
	dropped int
}

func NewBroadcaster(in <-chan event.Event) *Broadcaster {
	return &Broadcaster{in: in, clients: map[int]chan event.Event{}}
}

// Subscribe returns a channel of events. The afterID parameter is
// currently unused; replay is handled at the HTTP level in sse.go by
// querying the ring first. Kept for future broadcaster-internal
// ordering guarantees.
func (b *Broadcaster) Subscribe(_ uint64) <-chan event.Event {
	ch := make(chan event.Event, BroadcasterPerClientBuffer)
	b.mu.Lock()
	b.nextID++
	b.clients[b.nextID] = ch
	b.mu.Unlock()
	return ch
}

func (b *Broadcaster) DroppedClients() int {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.dropped
}

func (b *Broadcaster) ClientCount() int {
	b.mu.Lock()
	defer b.mu.Unlock()
	return len(b.clients)
}

// Run consumes in and pushes every event to every live subscriber
// non-blockingly; slow subscribers are dropped.
func (b *Broadcaster) Run(ctx context.Context) error {
	for {
		select {
		case <-ctx.Done():
			b.closeAll()
			return ctx.Err()
		case e, ok := <-b.in:
			if !ok {
				b.closeAll()
				return nil
			}
			b.fanout(e)
		}
	}
}

func (b *Broadcaster) fanout(e event.Event) {
	b.mu.Lock()
	defer b.mu.Unlock()
	for id, ch := range b.clients {
		select {
		case ch <- e:
		default:
			close(ch)
			delete(b.clients, id)
			b.dropped++
		}
	}
}

func (b *Broadcaster) closeAll() {
	b.mu.Lock()
	defer b.mu.Unlock()
	for id, ch := range b.clients {
		close(ch)
		delete(b.clients, id)
	}
}

// CloseAllClients is the exported shutdown hook. Closing every
// subscriber channel unblocks the SSE handlers parked on `<-ch`,
// which lets http.Server.Shutdown complete without waiting for the
// 30 s deadline.
func (b *Broadcaster) CloseAllClients() {
	b.closeAll()
}
