package pipeline

import (
	"context"
	"log/slog"
	"sync"

	"github.com/gloeckner-daniel/splits/internal/event"
)

// Dispatcher fans events out to the ring buffer, the persister
// channel, and the broadcaster channel. Per ARCH-0001 the ring write
// is synchronous-before-fanout so reconnecting clients never see a
// gap between the newest replayable id and the next live id.
type Dispatcher struct {
	Ring      *Ring
	Persist   chan<- event.Event
	Broadcast chan<- event.Event
}

// Run consumes events until in is closed or ctx is done. Closes the
// downstream channels on return so persister and broadcaster can
// drain and exit.
func (d *Dispatcher) Run(ctx context.Context, in <-chan event.Event) error {
	defer close(d.Persist)
	defer close(d.Broadcast)

	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case e, ok := <-in:
			if !ok {
				return nil
			}
			d.Ring.Write(e)
			var wg sync.WaitGroup
			wg.Add(2)
			go func() { defer wg.Done(); d.sendOrBlock(ctx, d.Persist, e, "persister") }()
			go func() { defer wg.Done(); d.sendOrBlock(ctx, d.Broadcast, e, "broadcaster") }()
			wg.Wait()
		}
	}
}

func (d *Dispatcher) sendOrBlock(ctx context.Context, ch chan<- event.Event, e event.Event, target string) {
	select {
	case ch <- e:
	default:
		slog.Error("pipeline.dispatcher.would_block", "target", target, "event_id", e.ID)
		select {
		case ch <- e:
		case <-ctx.Done():
		}
	}
}
