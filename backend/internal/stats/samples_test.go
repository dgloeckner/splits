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

func mkStrokeFull(no int, t float64, pace, watt, spm int, dps float64) event.StrokePayload {
	return event.StrokePayload{
		StrokeNo:       no,
		TimeSec:        t,
		PaceSecPer500m: pace,
		PowerW:         watt,
		SPM:            spm,
		DPS:            dps,
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

func TestComputeSamplesDPSandSPI(t *testing.T) {
	// Two strokes in one bucket: dps=8 and dps=10; watt=200,spm=25 for both.
	// Expected DPS mean = 9.0, SPI mean = 200/25 = 8.
	strokes := []event.StrokePayload{
		mkStrokeFull(1, 2, 120, 200, 25, 8.0),
		mkStrokeFull(2, 4, 124, 200, 25, 10.0),
	}
	s := ComputeSamples(strokes, 5)
	if len(s.DPS) != 1 {
		t.Fatalf("expected 1 DPS bucket, got %d", len(s.DPS))
	}
	if len(s.SPI) != 1 {
		t.Fatalf("expected 1 SPI bucket, got %d", len(s.SPI))
	}
	wantDPS := (8.0 + 10.0) / 2.0
	if s.DPS[0] != wantDPS {
		t.Errorf("DPS[0] = %v, want %v", s.DPS[0], wantDPS)
	}
	wantSPI := 200 / 25 // per-stroke SPI, both equal so mean is same
	if s.SPI[0] != wantSPI {
		t.Errorf("SPI[0] = %d, want %d", s.SPI[0], wantSPI)
	}
}

func TestComputeSamplesSPIZeroWhenNoValidStrokes(t *testing.T) {
	// spm=0 strokes should produce SPI bucket of 0.
	strokes := []event.StrokePayload{
		mkStrokeFull(1, 2, 120, 0, 0, 5.0),
	}
	s := ComputeSamples(strokes, 5)
	if s.SPI[0] != 0 {
		t.Errorf("SPI[0] = %d, want 0 when spm=0", s.SPI[0])
	}
}
