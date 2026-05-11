package session

import (
	"math"
	"testing"

	"github.com/gloeckner-daniel/splits/internal/event"
)

// pickPaceStroke is the synthetic stroke for fixture construction.
func ps(strokeNo int, timeSec float64, distanceM int) event.StrokePayload {
	return event.StrokePayload{StrokeNo: strokeNo, TimeSec: timeSec, DistanceM: distanceM}
}

// TestLivePaceEmptyBuffer: empty buffer returns (0, KindEmpty).
func TestLivePaceEmptyBuffer(t *testing.T) {
	v, k := LivePace(nil, 5.0, 10.0)
	if k != LivePaceEmpty || v != 0 {
		t.Fatalf("empty buffer: got (%d, %v), want (0, empty)", v, k)
	}
}

// TestLivePaceSingleStrokeHeld: one stroke inside window returns Held.
func TestLivePaceSingleStrokeHeld(t *testing.T) {
	buf := []event.StrokePayload{ps(1, 9.5, 30)}
	_, k := LivePace(buf, 5.0, 10.0)
	if k != LivePaceHeld {
		t.Fatalf("single stroke: got %v, want held", k)
	}
}

// TestLivePaceSparseWindowHeld: < 2 strokes inside the window → held,
// even if earlier strokes exist outside.
func TestLivePaceSparseWindowHeld(t *testing.T) {
	// One stroke long ago, one stroke barely inside.
	buf := []event.StrokePayload{
		ps(1, 0.0, 0),
		ps(2, 9.9, 50),
	}
	_, k := LivePace(buf, 5.0, 10.0)
	if k != LivePaceHeld {
		t.Fatalf("sparse window: got %v, want held", k)
	}
}

// TestLivePaceNormalRowing: constant 10 m/s ⇒ 500 m / 10 = 50 s split.
// strokes every 2 s at 20 m apart, window 5 s ending at t=20.
func TestLivePaceNormalRowing(t *testing.T) {
	buf := make([]event.StrokePayload, 0, 10)
	for n := 1; n <= 10; n++ {
		buf = append(buf, ps(n, float64(n)*2.0, n*20))
	}
	// now = 20.0, window = 5.0 ⇒ tStart=15.0 (between stroke 7@14 and 8@16).
	// dist@15 = 140 + (160-140)*(15-14)/(16-14) = 150.
	// dist@20 = 200.
	// distance covered = 50 m in 5 s ⇒ 10 m/s ⇒ 500 / 10 = 50 s.
	v, k := LivePace(buf, 5.0, 20.0)
	if k != LivePaceValue {
		t.Fatalf("normal rowing kind: got %v, want value", k)
	}
	if v != 50 {
		t.Fatalf("normal rowing pace: got %d, want 50", v)
	}
}

// TestLivePaceLeadingEdgeInterpolation: assert the leading-edge interpolation
// matches interpTime arithmetic to float-rounding. We construct a window
// where tStart falls strictly between two strokes with a non-trivial fraction.
func TestLivePaceLeadingEdgeInterpolation(t *testing.T) {
	// Stroke 1: t=10, d=100
	// Stroke 2: t=13, d=130
	// Stroke 3: t=18, d=170 (last)
	// now = 18.0, window = 7.0 ⇒ tStart = 11.0.
	// interp between (t=10,d=100) and (t=13,d=130) at t=11:
	//   d = 100 + (130-100)*(11-10)/(13-10) = 110.
	// dist covered = 170 - 110 = 60 m in 7 s ⇒ 8.571… m/s
	// pace = 500 / 60 * 7 = 58.333… s
	buf := []event.StrokePayload{
		ps(1, 10.0, 100),
		ps(2, 13.0, 130),
		ps(3, 18.0, 170),
	}
	v, k := LivePace(buf, 7.0, 18.0)
	if k != LivePaceValue {
		t.Fatalf("interp kind: got %v, want value", k)
	}
	covered := 60.0
	wantF := 500.0 / covered * 7.0
	want := int(wantF)
	if v != want {
		t.Fatalf("interp pace: got %d, want %d", v, want)
	}
	// Also sanity-check that the float-rounding arithmetic is exact.
	// dist@tStart re-derived independently:
	d0, t0, d1, t1, dx := 100.0, 10.0, 130.0, 13.0, 11.0
	dAt := d0 + (d1-d0)*(dx-t0)/(t1-t0)
	if math.Abs(dAt-110.0) > 1e-9 {
		t.Fatalf("interp check: got %v, want 110", dAt)
	}
}

// TestLivePaceLargeStrokeGap: a long gap between two strokes; tStart falls
// inside the gap. Interpolation must still work (not divide by zero, not
// return held just because strokes are sparse outside the window).
func TestLivePaceLargeStrokeGap(t *testing.T) {
	// Three strokes; stroke 2 lands far after stroke 1, stroke 3 right
	// after. Window includes strokes 2 and 3; leading edge falls in the
	// gap between 1 and 2.
	buf := []event.StrokePayload{
		ps(1, 0.0, 0),
		ps(2, 19.0, 100),
		ps(3, 20.0, 110),
	}
	// now = 20.0, window = 5.0 ⇒ tStart = 15.0.
	// interp between (0,0) and (19,100) at t=15: d = 0 + 100*(15-0)/(19-0)
	// = 1500/19 ≈ 78.947.
	// dist@20 = 110. covered ≈ 31.0526 m in 5 s.
	// pace = 500/31.0526*5 ≈ 80.508 s
	v, k := LivePace(buf, 5.0, 20.0)
	if k != LivePaceValue {
		t.Fatalf("large gap kind: got %v, want value", k)
	}
	dStart := 100.0 * 15.0 / 19.0
	covered := 110.0 - dStart
	want := int(500.0 / covered * 5.0)
	if v != want {
		t.Fatalf("large gap pace: got %d, want %d", v, want)
	}
}

// TestLivePaceEdgeInclusion: a stroke landing exactly at tStart should be
// counted as inside the window (closed-left). With trailing edge = now,
// strokes at exactly t=now are also inside.
func TestLivePaceEdgeInclusion(t *testing.T) {
	// Strokes at t=10 (edge), t=12, t=15 (edge = now).
	// window=5, now=15 ⇒ tStart=10. Two strokes inside (10 and 12 and 15
	// = three actually). Distance covered = d@15 - d@10.
	buf := []event.StrokePayload{
		ps(1, 10.0, 100),
		ps(2, 12.0, 120),
		ps(3, 15.0, 150),
	}
	v, k := LivePace(buf, 5.0, 15.0)
	if k != LivePaceValue {
		t.Fatalf("edge inclusion kind: got %v, want value", k)
	}
	// 50 m in 5 s ⇒ 10 m/s ⇒ 50 s.
	if v != 50 {
		t.Fatalf("edge inclusion pace: got %d, want 50", v)
	}
}

// TestLivePaceWindowParameterTunable: 3 s window vs 5 s window over the
// same buffer yields different answers — the value really is a parameter.
func TestLivePaceWindowParameterTunable(t *testing.T) {
	// Accelerating row: distances 0, 10, 25, 45, 70 (m) at t = 0, 2, 4, 6, 8.
	buf := []event.StrokePayload{
		ps(1, 0.0, 0),
		ps(2, 2.0, 10),
		ps(3, 4.0, 25),
		ps(4, 6.0, 45),
		ps(5, 8.0, 70),
	}
	v3, k3 := LivePace(buf, 3.0, 8.0)
	v5, k5 := LivePace(buf, 5.0, 8.0)
	if k3 != LivePaceValue || k5 != LivePaceValue {
		t.Fatalf("kinds: 3s=%v 5s=%v", k3, k5)
	}
	if v3 == v5 {
		t.Fatalf("expected different paces for 3s vs 5s windows; both %d", v3)
	}
}
