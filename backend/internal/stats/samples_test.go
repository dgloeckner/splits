package stats

import (
	"testing"

	"github.com/gloeckner-daniel/splits/internal/event"
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
	if want := 27.2; s.SPM[0] != want { // (24+26+28+28+30)/5
		t.Errorf("spm = %v, want %v", s.SPM[0], want)
	}
}

// TestComputeSamplesSPMDecimal: the SPM bucket mean keeps one decimal
// instead of truncating, so the SPM chart follows the real rating.
func TestComputeSamplesSPMDecimal(t *testing.T) {
	cases := []struct {
		spms []int
		want float64
	}{
		{[]int{28, 28, 29, 29, 29}, 28.6},
		{[]int{27, 27, 27, 27, 28}, 27.2},
		{[]int{30, 30, 30, 30, 30}, 30},
		{[]int{25, 26, 26}, 25.7}, // partial bucket: 77/3 = 25.67
	}
	for _, tc := range cases {
		strokes := make([]event.StrokePayload, len(tc.spms))
		for i, spm := range tc.spms {
			strokes[i] = mkStroke(i+1, float64(i+1)*2, 110, 300, spm)
		}
		if got := ComputeSamples(strokes, 5).SPM[0]; got != tc.want {
			t.Errorf("spm %v → %v, want %v", tc.spms, got, tc.want)
		}
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

func TestComputeSamplesDPS(t *testing.T) {
	// Two strokes in one bucket: dps=8 and dps=10; watt=200,spm=25 for both.
	// Expected DPS mean = 9.0.
	strokes := []event.StrokePayload{
		mkStrokeFull(1, 2, 120, 200, 25, 8.0),
		mkStrokeFull(2, 4, 124, 200, 25, 10.0),
	}
	s := ComputeSamples(strokes, 5)
	if len(s.DPS) != 1 {
		t.Fatalf("expected 1 DPS bucket, got %d", len(s.DPS))
	}
	wantDPS := (8.0 + 10.0) / 2.0
	if s.DPS[0] != wantDPS {
		t.Errorf("DPS[0] = %v, want %v", s.DPS[0], wantDPS)
	}
}

func TestBucketStrokesForShortSession(t *testing.T) {
	// ≤ 360 * DefaultBucketStrokes strokes → DefaultBucketStrokes.
	if got := BucketStrokesFor(0); got != DefaultBucketStrokes {
		t.Errorf("zero: got %d", got)
	}
	if got := BucketStrokesFor(100); got != DefaultBucketStrokes {
		t.Errorf("100 strokes: got %d, want %d", got, DefaultBucketStrokes)
	}
	if got := BucketStrokesFor(MaxSampleBuckets * DefaultBucketStrokes); got != DefaultBucketStrokes {
		t.Errorf("at threshold: got %d, want %d", got, DefaultBucketStrokes)
	}
}

func TestBucketStrokesForLongSession(t *testing.T) {
	// > 360 * default → bucket grows; series length stays ≤ 360.
	n := MaxSampleBuckets*DefaultBucketStrokes + 1
	bucket := BucketStrokesFor(n)
	if bucket <= DefaultBucketStrokes {
		t.Fatalf("bucket = %d, want > %d", bucket, DefaultBucketStrokes)
	}
	series := (n + bucket - 1) / bucket
	if series > MaxSampleBuckets {
		t.Errorf("series length %d exceeds cap %d", series, MaxSampleBuckets)
	}

	// 30-min session at 24 spm → ~720 strokes → bucket = 5 (still under cap).
	if got := BucketStrokesFor(720); got != DefaultBucketStrokes {
		t.Errorf("30-min row: got %d, want default", got)
	}

	// 4-hour ultra at 22 spm → ~5280 strokes → series ≤ 360.
	bucket = BucketStrokesFor(5280)
	if (5280+bucket-1)/bucket > MaxSampleBuckets {
		t.Errorf("4h ultra: series exceeds cap")
	}
}
