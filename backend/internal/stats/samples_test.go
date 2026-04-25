package stats

import (
	"testing"

	"github.com/gloeckner-daniel/home-ergo/internal/event"
)

func mkStroke(no int, t float64, pace, watt, spm int) event.StrokePayload {
	return event.StrokePayload{
		StrokeNo:       no,
		TimeSec:        t,
		PaceSecPer500m: pace,
		PowerW:         watt,
		SPM:            spm,
	}
}

func TestComputeSamplesEmpty(t *testing.T) {
	s := ComputeSamples(nil, 5)
	if s == nil || len(s.T) != 0 || s.BucketStrokes != 5 {
		t.Fatalf("expected empty samples with bucket=5, got %+v", s)
	}
}

func TestComputeSamplesExactBucket(t *testing.T) {
	strokes := []event.StrokePayload{
		mkStroke(1, 2, 120, 200, 24),
		mkStroke(2, 4, 124, 210, 26),
		mkStroke(3, 6, 128, 220, 28),
		mkStroke(4, 8, 130, 230, 28),
		mkStroke(5, 10, 134, 240, 30),
	}
	s := ComputeSamples(strokes, 5)
	if len(s.T) != 1 {
		t.Fatalf("expected 1 bucket, got %d", len(s.T))
	}
	if s.T[0] != 10 {
		t.Errorf("bucket time = %v, want 10", s.T[0])
	}
	wantPace := (120 + 124 + 128 + 130 + 134) / 5
	if s.Split[0] != wantPace {
		t.Errorf("split = %d, want %d", s.Split[0], wantPace)
	}
	wantWatt := (200 + 210 + 220 + 230 + 240) / 5
	if s.Watt[0] != wantWatt {
		t.Errorf("watt = %d, want %d", s.Watt[0], wantWatt)
	}
	wantSPM := (24 + 26 + 28 + 28 + 30) / 5
	if s.SPM[0] != wantSPM {
		t.Errorf("spm = %d, want %d", s.SPM[0], wantSPM)
	}
}

func TestComputeSamplesPartialTrailingBucket(t *testing.T) {
	strokes := []event.StrokePayload{
		mkStroke(1, 2, 120, 200, 24),
		mkStroke(2, 4, 120, 200, 24),
		mkStroke(3, 6, 120, 200, 24),
		mkStroke(4, 8, 120, 200, 24),
		mkStroke(5, 10, 120, 200, 24),
		mkStroke(6, 12, 130, 240, 30),
		mkStroke(7, 14, 130, 240, 30),
	}
	s := ComputeSamples(strokes, 5)
	if len(s.T) != 2 {
		t.Fatalf("expected 2 buckets (5+2), got %d", len(s.T))
	}
	if s.T[1] != 14 {
		t.Errorf("trailing bucket time = %v, want 14", s.T[1])
	}
	if s.Watt[1] != 240 {
		t.Errorf("trailing watt = %d, want 240", s.Watt[1])
	}
}

func TestComputeSamplesDefaultBucket(t *testing.T) {
	strokes := []event.StrokePayload{mkStroke(1, 2, 100, 100, 20)}
	s := ComputeSamples(strokes, 0)
	if s.BucketStrokes != DefaultBucketStrokes {
		t.Errorf("bucket = %d, want default %d", s.BucketStrokes, DefaultBucketStrokes)
	}
	if len(s.T) != 1 {
		t.Errorf("expected 1 bucket from 1 stroke, got %d", len(s.T))
	}
}
