package stats

import (
	"math"
	"testing"

	"github.com/gloeckner-daniel/splits/internal/event"
)

// Strokes at constant 10 m / 2 s rate (5 m/s ⇒ 1:40 split). The exact
// 500 m point falls between strokes 50 (500 m, 100 s) and 51 (510 m,
// 102 s). Old next-stroke-overshoot algorithm scored 102 s; the new
// interpolation must hit 100.0 s.
func TestDistanceCandidatesInterpolatesExactBoundary(t *testing.T) {
	strokes := make([]event.StrokePayload, 0, 60)
	for n := 1; n <= 60; n++ {
		strokes = append(strokes, event.StrokePayload{
			StrokeNo:  n,
			TimeSec:   float64(n) * 2.0,
			DistanceM: n * 10,
		})
	}
	got := distanceCandidates(strokes, []int{500})
	if len(got) != 1 {
		t.Fatalf("expected 1 candidate, got %d", len(got))
	}
	if math.Abs(got[0].TimeSec-100.0) > 1e-6 {
		t.Fatalf("expected exact 100.0s for 500m, got %v", got[0].TimeSec)
	}
}

// Off-grid distance: 17 m strokes (won't align with 500 m).
// Expected exact time = 500 / (17/2) = 58.823529 s (5/3 s per metre? no:
// 17 m every 2 s ⇒ 8.5 m/s ⇒ 500 m in 58.8235… s).
func TestDistanceCandidatesInterpolatesOffGrid(t *testing.T) {
	strokes := make([]event.StrokePayload, 0, 60)
	for n := 1; n <= 60; n++ {
		strokes = append(strokes, event.StrokePayload{
			StrokeNo:  n,
			TimeSec:   float64(n) * 2.0,
			DistanceM: n * 17,
		})
	}
	got := distanceCandidates(strokes, []int{500})
	if len(got) != 1 {
		t.Fatalf("expected 1 candidate, got %d", len(got))
	}
	want := 500.0 * 2.0 / 17.0
	if math.Abs(got[0].TimeSec-want) > 1e-6 {
		t.Fatalf("expected %v, got %v", want, got[0].TimeSec)
	}
}
