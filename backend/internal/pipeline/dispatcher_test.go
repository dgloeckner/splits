package pipeline

import (
	"context"
	"testing"
	"time"

	"github.com/gloeckner-daniel/home-ergo/internal/event"
)

func TestDispatcherFansOut(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	in := make(chan event.Event, 4)
	persist := make(chan event.Event, 4)
	broadcast := make(chan event.Event, 4)
	ring := NewRing(8)
	d := &Dispatcher{Ring: ring, Persist: persist, Broadcast: broadcast}

	done := make(chan error, 1)
	go func() { done <- d.Run(ctx, in) }()

	in <- event.Event{ID: 1}
	in <- event.Event{ID: 2}
	close(in)

	select {
	case err := <-done:
		if err != nil {
			t.Fatalf("run: %v", err)
		}
	case <-time.After(time.Second):
		t.Fatal("dispatcher did not return")
	}

	if n := len(persist); n != 2 {
		t.Errorf("persist received %d, want 2", n)
	}
	if n := len(broadcast); n != 2 {
		t.Errorf("broadcast received %d, want 2", n)
	}
	if _, newest, size := ring.Stats(); newest != 2 || size != 2 {
		t.Errorf("ring stats wrong: newest=%d size=%d", newest, size)
	}
}
