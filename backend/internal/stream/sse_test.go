package stream

import (
	"bufio"
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gloeckner-daniel/home-ergo/internal/event"
	"github.com/gloeckner-daniel/home-ergo/internal/pipeline"
)

func TestSSEReplayThenLive(t *testing.T) {
	ring := pipeline.NewRing(16)
	ring.Write(event.Event{ID: 1, Kind: event.KindStroke, SessionID: "S1", Stroke: &event.StrokePayload{StrokeNo: 1, TimeSec: 0.0, DistanceM: 0, SPM: 25, PowerW: 200, CalPerHr: 1000, Level: 3}})

	bcastIn := make(chan event.Event, 4)
	b := NewBroadcaster(bcastIn)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go func() { _ = b.Run(ctx) }()

	h := NewHandler(ring, b)
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
				return b.String()
			}
			continue
		}
		b.WriteString(line)
	}
	t.Fatal("timeout reading SSE event")
	return ""
}
