package pipeline

import (
	"testing"

	"github.com/gloeckner-daniel/home-ergo/internal/event"
)

func TestRingWriteAndSince(t *testing.T) {
	r := NewRing(4)
	for i := uint64(1); i <= 3; i++ {
		r.Write(event.Event{ID: i})
	}
	got := r.Since(0)
	if len(got) != 3 || got[0].ID != 1 || got[2].ID != 3 {
		t.Fatalf("got %#v", got)
	}
	if got := r.Since(2); len(got) != 1 || got[0].ID != 3 {
		t.Fatalf("got %#v", got)
	}
	if got := r.Since(10); len(got) != 0 {
		t.Fatalf("expected empty, got %#v", got)
	}
}

func TestRingDropsOldest(t *testing.T) {
	r := NewRing(2)
	r.Write(event.Event{ID: 1})
	r.Write(event.Event{ID: 2})
	r.Write(event.Event{ID: 3})
	got := r.Since(0)
	if len(got) != 2 || got[0].ID != 2 || got[1].ID != 3 {
		t.Fatalf("got %#v", got)
	}
}

func TestRingStats(t *testing.T) {
	r := NewRing(10)
	r.Write(event.Event{ID: 5})
	r.Write(event.Event{ID: 6})
	oldest, newest, size := r.Stats()
	if oldest != 5 || newest != 6 || size != 2 {
		t.Fatalf("stats: %d %d %d", oldest, newest, size)
	}
}
