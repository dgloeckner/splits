package api

import (
	"encoding/json"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gloeckner-daniel/splits/internal/event"
	"github.com/gloeckner-daniel/splits/internal/pipeline"
	"github.com/gloeckner-daniel/splits/internal/stream"
)

func TestDebugIngestShape(t *testing.T) {
	ring := pipeline.NewRing(16)
	ring.Write(event.Event{ID: 1})

	b := stream.NewBroadcaster(make(chan event.Event))

	start := time.Unix(1000, 0)
	h := DebugIngestHandler(DebugIngestInputs{
		Ring:        ring,
		Broadcaster: b,
		StartedAt:   start,
		Now:         func() time.Time { return start.Add(10 * time.Second) },
	})

	req := httptest.NewRequest("GET", "/debug/ingest", nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if rec.Code != 200 {
		t.Fatalf("status = %d", rec.Code)
	}
	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body["uptime_sec"] != float64(10) {
		t.Errorf("uptime_sec = %v", body["uptime_sec"])
	}
	if body["ring"] == nil {
		t.Error("ring missing")
	}
	if body["broadcaster"] == nil {
		t.Error("broadcaster missing")
	}
}
