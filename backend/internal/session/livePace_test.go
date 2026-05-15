package session

import (
	"testing"

	"github.com/gloeckner-daniel/splits/internal/event"
)

// ps is a synthetic stroke for fixture construction.
func ps(strokeNo int, timeSec float64, distanceM int) event.StrokePayload {
	return event.StrokePayload{StrokeNo: strokeNo, TimeSec: timeSec, DistanceM: distanceM}
}

// TestLivePaceEmptyBuffer: empty buffer returns (0, KindEmpty).
func TestLivePaceEmptyBuffer(t *testing.T) {
	v, k := LivePace(nil, 5, 0)
	if k != LivePaceEmpty || v != 0 {
		t.Fatalf("empty buffer: got (%d, %v), want (0, empty)", v, k)
	}
}

// TestLivePaceSingleStrokeHeld: one stroke in the buffer → held (need 2).
func TestLivePaceSingleStrokeHeld(t *testing.T) {
	buf := []event.StrokePayload{ps(1, 9.5, 30)}
	_, k := LivePace(buf, 5, 0)
	if k != LivePaceHeld {
		t.Fatalf("single stroke: got %v, want held", k)
	}
}

// TestLivePaceNormalRowing: 5 strokes at 2 s / 20 m → 100 m in 10 s
// → 500 m / 100 × 10 = 50 s split.
func TestLivePaceNormalRowing(t *testing.T) {
	buf := make([]event.StrokePayload, 0, 5)
	for n := 1; n <= 5; n++ {
		buf = append(buf, ps(n, float64(n)*2.0, n*20))
	}
	v, k := LivePace(buf, 5, 0)
	if k != LivePaceValue {
		t.Fatalf("kind: got %v, want value", k)
	}
	// Window = strokes 1..5 (= all 5). Covered = 100 - 20 = 80 m in
	// 10 - 2 = 8 s. Pace = 500/80*8 = 50.
	if v != 50 {
		t.Fatalf("normal rowing pace: got %d, want 50", v)
	}
}

// TestLivePaceWindowShrinksWhenBufferShort: only 3 strokes available
// but window asks for 5 → use what's there (≥2 still required).
func TestLivePaceWindowShrinksWhenBufferShort(t *testing.T) {
	buf := []event.StrokePayload{
		ps(1, 2.0, 20),
		ps(2, 4.0, 40),
		ps(3, 6.0, 60),
	}
	v, k := LivePace(buf, 5, 0)
	if k != LivePaceValue {
		t.Fatalf("kind: got %v, want value", k)
	}
	// 40 m in 4 s ⇒ 500/40*4 = 50.
	if v != 50 {
		t.Fatalf("short-buffer pace: got %d, want 50", v)
	}
}

// TestLivePaceOnlyTrailingNCount: buffer longer than N — only the last
// N strokes are considered, older strokes ignored.
func TestLivePaceOnlyTrailingNCount(t *testing.T) {
	// Slow first stretch (10 m / 2 s ≈ 100 s split), then fast: last 5
	// strokes are 20 m / 2 s (≈ 50 s split). Pace should reflect the
	// fast tail only.
	buf := []event.StrokePayload{
		ps(1, 0, 0), ps(2, 2, 10), ps(3, 4, 20), ps(4, 6, 30), ps(5, 8, 40),
		ps(6, 10, 60), ps(7, 12, 80), ps(8, 14, 100), ps(9, 16, 120), ps(10, 18, 140),
	}
	v, k := LivePace(buf, 5, 0)
	if k != LivePaceValue {
		t.Fatalf("kind: got %v, want value", k)
	}
	// Last 5 strokes (stroke 6..10): distance 140-60 = 80 m in 18-10 = 8 s.
	// Pace = 500/80 * 8 = 50 s. Whole-buffer pace would be 500/140 *
	// 18 ≈ 64 — the assertion is that the slow opening is excluded.
	if v != 50 {
		t.Fatalf("trailing-N pace: got %d, want 50 (slow opening must be excluded)", v)
	}
}

// TestLivePaceWindowParameterTunable: different N values over the same
// buffer must produce different answers — the N parameter is real.
func TestLivePaceWindowParameterTunable(t *testing.T) {
	// Accelerating row: distances 0, 10, 25, 45, 70, 100 at t=0,2,4,6,8,10.
	buf := []event.StrokePayload{
		ps(1, 0, 0), ps(2, 2, 10), ps(3, 4, 25),
		ps(4, 6, 45), ps(5, 8, 70), ps(6, 10, 100),
	}
	v3, k3 := LivePace(buf, 3, 0)
	v5, k5 := LivePace(buf, 5, 0)
	if k3 != LivePaceValue || k5 != LivePaceValue {
		t.Fatalf("kinds: 3-stroke=%v 5-stroke=%v", k3, k5)
	}
	if v3 == v5 {
		t.Fatalf("expected different paces for 3 vs 5 stroke windows; both %d", v3)
	}
	// Sanity: the trailing 3 strokes are faster (45 → 100 = 55 m in 4 s
	// = ~36 s pace) than the trailing 5 (10 → 100 = 90 m in 8 s
	// = ~44 s pace). Faster pace = lower number.
	if v3 >= v5 {
		t.Fatalf("expected accelerating row to produce v3<v5; got v3=%d v5=%d", v3, v5)
	}
}

// TestLivePaceMinWindowClamped: window<2 is clamped to 2 (need at
// least two samples to compute a window).
func TestLivePaceMinWindowClamped(t *testing.T) {
	buf := []event.StrokePayload{ps(1, 0, 0), ps(2, 2, 10), ps(3, 4, 25)}
	v, k := LivePace(buf, 1, 0)
	if k != LivePaceValue {
		t.Fatalf("kind: got %v, want value", k)
	}
	// Clamped to 2 → last two strokes: 15 m in 2 s → 500/15*2 ≈ 66.
	if v < 60 || v > 70 {
		t.Fatalf("clamped window pace: got %d, want ~66", v)
	}
}
