package storage

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/gloeckner-daniel/splits/internal/event"
	"github.com/gloeckner-daniel/splits/internal/stats"
)

func TestBackfillAnalysisWindow(t *testing.T) {
	db := testDB(t)
	ctx := context.Background()
	h := db.Handle()
	if _, err := h.Exec(`
		INSERT INTO workout(id, mode, params_json, shape_hash, warmup_sec, cooldown_sec, created_at)
		VALUES('WDIST', 'distance', '{"meters":200}', 'HASH200', 0, 0, '2026-01-01T00:00:00Z')`); err != nil {
		t.Fatalf("seed workout: %v", err)
	}
	started := time.Date(2026, 1, 1, 10, 0, 0, 0, time.UTC)
	if err := InsertSession(ctx, h, "old", "r1", started, 3, "WDIST"); err != nil {
		t.Fatalf("InsertSession: %v", err)
	}
	var strokes []event.StrokePayload
	for i := 1; i <= 28; i++ {
		p := event.StrokePayload{
			StrokeNo: i, TimeSec: float64(i) * 2.0, DistanceM: i * 8,
			SPM: 24, PowerW: 200, PaceSecPer500m: 130, DPS: 8, Phase: "work",
		}
		strokes = append(strokes, p)
		if err := InsertStroke(ctx, h, uint64(i+100), "old", started, p); err != nil {
			t.Fatalf("InsertStroke %d: %v", i, err)
		}
	}
	samples := stats.ComputeSamples(strokes, 5)
	summary, _ := json.Marshal(event.SessionSummary{Samples: samples})
	if _, err := h.Exec(`UPDATE sessions SET ended_at = ?, summary_json = ? WHERE id = 'old'`,
		started.Add(time.Minute).Format(time.RFC3339Nano), string(summary)); err != nil {
		t.Fatalf("seed summary: %v", err)
	}

	ok, err := BackfillAnalysisWindow(ctx, h, "old", samples)
	if err != nil || !ok {
		t.Fatalf("BackfillAnalysisWindow = %v, %v", ok, err)
	}
	want := event.SamplesWindow{From: 1, To: 5}
	if *samples.Window != want {
		t.Fatalf("window = %+v, want %+v", *samples.Window, want)
	}
	if err := PersistSamplesWindow(ctx, h, "old", samples.Window); err != nil {
		t.Fatalf("PersistSamplesWindow: %v", err)
	}
	row, err := GetSession(ctx, h, "old")
	if err != nil {
		t.Fatalf("GetSession: %v", err)
	}
	if row.Summary.Samples.Window == nil || *row.Summary.Samples.Window != want {
		t.Errorf("persisted window = %+v, want %+v", row.Summary.Samples.Window, want)
	}
	if len(row.Summary.Samples.Split) != len(samples.Split) {
		t.Errorf("persisting the window changed the series")
	}

	// A window already present is left alone.
	if ok, _ := BackfillAnalysisWindow(ctx, h, "old", samples); ok {
		t.Error("recomputed a window the samples already carry")
	}
	// Bucketing that no longer matches the stored series gets no window.
	stale := stats.ComputeSamples(strokes[:20], 5)
	if ok, _ := BackfillAnalysisWindow(ctx, h, "old", stale); ok || stale.Window != nil {
		t.Error("windowed samples whose buckets don't match the strokes")
	}
	// No stroke rows (compacted): no window.
	if ok, _ := BackfillAnalysisWindow(ctx, h, "missing", stats.ComputeSamples(strokes, 5)); ok {
		t.Error("windowed a session without stroke rows")
	}
}
