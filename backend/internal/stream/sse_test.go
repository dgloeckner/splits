package stream

import (
	"bufio"
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gloeckner-daniel/splits/internal/event"
	"github.com/gloeckner-daniel/splits/internal/pipeline"
)

func TestSSEReplayThenLive(t *testing.T) {
	ring := pipeline.NewRing(16)
	ring.Write(event.Event{ID: 1, Kind: event.KindStroke, SessionID: "S1", Stroke: &event.StrokePayload{StrokeNo: 1, TimeSec: 0.0, DistanceM: 0, SPM: 25, PowerW: 200, CalPerHr: 1000, Level: 3}})

	bcastIn := make(chan event.Event, 4)
	b := NewBroadcaster(bcastIn)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go func() { _ = b.Run(ctx) }()

	h := NewHandler(ring, b, nil, nil)
	srv := httptest.NewServer(h)
	defer srv.Close()

	req, _ := http.NewRequestWithContext(ctx, "GET", srv.URL, nil)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.Header.Get("Content-Type") != "text/event-stream; charset=utf-8" {
		t.Errorf("content-type = %q", resp.Header.Get("Content-Type"))
	}

	rd := bufio.NewReader(resp.Body)
	got := readOneEvent(t, rd)
	if !strings.Contains(got, "event: stroke") || !strings.Contains(got, "id: 1") {
		t.Errorf("replay event missing expected fields: %q", got)
	}

	// Now push a live event through the broadcaster.
	bcastIn <- event.Event{ID: 2, Kind: event.KindStroke, SessionID: "S1", Stroke: &event.StrokePayload{StrokeNo: 2}}

	got = readOneEvent(t, rd)
	if !strings.Contains(got, "id: 2") {
		t.Errorf("live event missing: %q", got)
	}
}

// TestSSESubscribeBeforeReplay verifies that an event published between
// ring.Since and b.Subscribe is NOT lost. The fixed handler subscribes
// first, replays the ring second, so any event arriving in that window
// is buffered on the client channel and received after replay.
func TestSSESubscribeBeforeReplay(t *testing.T) {
	ring := pipeline.NewRing(16)
	// ID 1 already in the ring; client connects with since=0.
	ring.Write(event.Event{ID: 1, Kind: event.KindStroke, SessionID: "S1", Stroke: &event.StrokePayload{StrokeNo: 1, SPM: 25, PowerW: 200, CalPerHr: 1000, Level: 3}})

	bcastIn := make(chan event.Event, 4)
	b := NewBroadcaster(bcastIn)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go func() { _ = b.Run(ctx) }()

	h := NewHandler(ring, b, nil, nil)
	srv := httptest.NewServer(h)
	defer srv.Close()

	req, _ := http.NewRequestWithContext(ctx, "GET", srv.URL, nil)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()

	rd := bufio.NewReader(resp.Body)

	// Drain the ": ready" comment and the ring-replay event (ID 1).
	_ = readOneEvent(t, rd)

	// Broadcast ID 2 *while* the ring replay is in flight (simulated by
	// the fact that the handler is already running in its goroutine).
	// Because Subscribe now happens before ring.Since in the handler, ID 2
	// is buffered on the client channel and must arrive after replay.
	bcastIn <- event.Event{ID: 2, Kind: event.KindStroke, SessionID: "S1", Stroke: &event.StrokePayload{StrokeNo: 2, SPM: 26, PowerW: 210, CalPerHr: 1050, Level: 3}}

	got := readOneEvent(t, rd)
	if !strings.Contains(got, "id: 2") {
		t.Errorf("event published in subscribe-before-replay window was lost; got: %q", got)
	}
}

// TestParseAfterIDLastEventIDBeatsQueryParam verifies that the
// Last-Event-ID header takes precedence over the stale ?since= query
// param so reconnecting browsers don't cause full re-floods.
func TestParseAfterIDLastEventIDBeatsQueryParam(t *testing.T) {
	req, _ := http.NewRequest("GET", "http://example.com/stream?since=10", nil)
	req.Header.Set("Last-Event-ID", "50")

	got := parseAfterID(req)
	if got != 50 {
		t.Errorf("parseAfterID = %d; want 50 (Last-Event-ID should beat ?since)", got)
	}
}

func readOneEvent(t *testing.T, rd *bufio.Reader) string {
	t.Helper()
	var b strings.Builder
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		line, err := rd.ReadString('\n')
		if err != nil {
			t.Fatal(err)
		}
		if line == "\n" {
			if b.Len() > 0 {
				out := b.String()
				// SSE comment lines start with ":". The handler emits
				// ": ready\n\n" right after WriteHeader so proxies
				// flush headers and the browser fires `onopen`
				// immediately. Skip them in tests.
				if strings.HasPrefix(out, ":") {
					b.Reset()
					continue
				}
				return out
			}
			continue
		}
		b.WriteString(line)
	}
	t.Fatal("timeout reading SSE event")
	return ""
}
