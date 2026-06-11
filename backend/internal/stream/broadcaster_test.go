package stream

import (
	"context"
	"testing"
	"time"

	"github.com/gloeckner-daniel/splits/internal/event"
)

func TestBroadcasterFanOutToClients(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	in := make(chan event.Event, 8)
	b := NewBroadcaster(in)
	go func() { _ = b.Run(ctx) }()

	a := b.Subscribe()
	c := b.Subscribe()

	in <- event.Event{ID: 1, Kind: event.KindStroke, SessionID: "S1", Stroke: &event.StrokePayload{}}

	select {
	case e := <-a:
		if e.ID != 1 {
			t.Errorf("client a got id=%d", e.ID)
		}
	case <-time.After(time.Second):
		t.Fatal("client a timeout")
	}
	select {
	case e := <-c:
		if e.ID != 1 {
			t.Errorf("client c got id=%d", e.ID)
		}
	case <-time.After(time.Second):
		t.Fatal("client c timeout")
	}
}

func TestBroadcasterDropsSlowClient(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	in := make(chan event.Event, 128)
	b := NewBroadcaster(in)
	go func() { _ = b.Run(ctx) }()

	_ = b.Subscribe() // slow — never read

	for i := 1; i <= BroadcasterPerClientBuffer+2; i++ {
		in <- event.Event{ID: uint64(i)}
	}
	time.Sleep(100 * time.Millisecond)

	if got := b.DroppedClients(); got != 1 {
		t.Errorf("dropped clients = %d, want 1", got)
	}
}
