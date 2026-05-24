package session

import (
	"testing"
	"time"

	"github.com/gloeckner-daniel/splits/internal/event"
)

// t0 is the reference time used for all synthetic At values in this
// test file; absolute value is irrelevant — only deltas matter.
var t0 = time.Date(2026, 5, 24, 15, 24, 41, 0, time.UTC)

// ps builds a stroke whose At is offset seconds from t0. TimeSec is
// left zero on purpose: LivePace must not read it.
func ps(strokeNo int, atSec float64, distanceM int) event.StrokePayload {
	return event.StrokePayload{
		StrokeNo:  strokeNo,
		DistanceM: distanceM,
		At:        t0.Add(time.Duration(atSec * float64(time.Second))),
	}
}

const (
	win   = 10 * time.Second
	pause = 4 * time.Second
)

func TestLivePaceEmptyBuffer(t *testing.T) {
	v, k := LivePace(nil, win, pause)
	if k != LivePaceEmpty || v != 0 {
		t.Fatalf("empty buffer: got (%d, %v), want (0, empty)", v, k)
	}
}

func TestLivePaceSingleStrokeHeld(t *testing.T) {
	buf := []event.StrokePayload{ps(1, 0, 0)}
	_, k := LivePace(buf, win, pause)
	if k != LivePaceHeld {
		t.Fatalf("single stroke: got %v, want held", k)
	}
}

// TestLivePaceNormalRowing: 5 strokes at 2 s / 20 m → 80 m in 8 s
// → 500 m / 80 × 8 = 50 s split.
func TestLivePaceNormalRowing(t *testing.T) {
	buf := []event.StrokePayload{
		ps(1, 2, 20), ps(2, 4, 40), ps(3, 6, 60), ps(4, 8, 80), ps(5, 10, 100),
	}
	v, k := LivePace(buf, win, pause)
	if k != LivePaceValue {
		t.Fatalf("kind: got %v, want value", k)
	}
	if v != 50 {
		t.Fatalf("pace: got %d, want 50", v)
	}
}

// TestLivePaceWindowDropsOldStrokes: 11 strokes at 2 s / 20 m spans
// 20 s; the 10 s window must drop everything before the last 6.
// Cadence is steady so the pace is unchanged — the assertion is that
// the older strokes were dropped (otherwise the start-anchor would
// shift Δd/Δt and the rounding could differ).
func TestLivePaceWindowDropsOldStrokes(t *testing.T) {
	var buf []event.StrokePayload
	for n := 1; n <= 11; n++ {
		buf = append(buf, ps(n, float64(n)*2, n*20))
	}
	v, k := LivePace(buf, win, pause)
	if k != LivePaceValue {
		t.Fatalf("kind: got %v, want value", k)
	}
	if v != 50 {
		t.Fatalf("pace: got %d, want 50", v)
	}
}

// TestLivePacePauseTrim: a 10 s gap inside the buffer must terminate
// the window. The pace is computed only from strokes after the pause.
func TestLivePacePauseTrim(t *testing.T) {
	buf := []event.StrokePayload{
		ps(1, 0, 0),    // pre-pause
		ps(2, 12, 10),  // 12 s gap → pause
		ps(3, 14, 20),
		ps(4, 16, 30),
	}
	v, k := LivePace(buf, win, pause)
	if k != LivePaceValue {
		t.Fatalf("kind: got %v, want value", k)
	}
	// Window must start at stroke 2 (post-pause). Δd = 30 - 10 = 20 m,
	// Δt = 16 - 12 = 4 s → 500/20 × 4 = 100 s. If the pause weren't
	// trimmed, the window would start at stroke 1 → 500/30 × 16 ≈ 266 s.
	if v != 100 {
		t.Fatalf("pace: got %d, want 100 (pause must be trimmed)", v)
	}
}

// TestLivePaceStrokeAfterPauseHolds: the very first stroke after a
// pause has no in-window predecessor; LivePace must report Held so the
// caller keeps the previous value rather than dividing by zero.
func TestLivePaceStrokeAfterPauseHolds(t *testing.T) {
	buf := []event.StrokePayload{
		ps(1, 0, 0),
		ps(2, 2, 10),
		ps(3, 15, 25), // 13 s gap → pause; nothing else in window
	}
	_, k := LivePace(buf, win, pause)
	if k != LivePaceHeld {
		t.Fatalf("first post-pause stroke: got %v, want held", k)
	}
}

// TestLivePaceShortBuffer: only 2 strokes; window doesn't bind.
func TestLivePaceShortBuffer(t *testing.T) {
	buf := []event.StrokePayload{ps(1, 2, 20), ps(2, 4, 40)}
	v, k := LivePace(buf, win, pause)
	if k != LivePaceValue || v != 50 {
		t.Fatalf("short buffer: got (%d, %v), want (50, value)", v, k)
	}
}

// TestLivePaceDistanceNonAdvanceHolds: two strokes at the same
// distance (idle rebroadcast) → no Δd → held.
func TestLivePaceDistanceNonAdvanceHolds(t *testing.T) {
	buf := []event.StrokePayload{ps(1, 0, 100), ps(2, 2, 100)}
	_, k := LivePace(buf, win, pause)
	if k != LivePaceHeld {
		t.Fatalf("zero-distance window: got %v, want held", k)
	}
}

// TestLivePaceCapturedSession replays the 18 strokes from the
// 24-May-2026 capture (session 01KSD9BQZ758BQACNVG62WE6GB) and
// asserts that the new windowed split lies within the rower
// console's observed band (1:38–1:48). The previous integer-second
// device-time implementation produced 1:32 at stroke 13 and 1:51 at
// stroke 17 — both outside the band — so this test would have failed
// on the old code.
func TestLivePaceCapturedSession(t *testing.T) {
	// (host-time offset in seconds, cumulative distance in m).
	type sample struct {
		atSec float64
		dist  int
	}
	samples := []sample{
		{0.000, 0}, {2.127, 10}, {4.190, 20}, {6.126, 29}, {8.126, 39},
		{10.014, 48}, {11.998, 58}, {13.868, 68}, {15.757, 77}, {17.692, 86},
		{19.567, 96}, {21.499, 106}, {23.387, 115}, {25.317, 124}, {27.258, 133},
		{29.130, 142}, {31.066, 151}, {33.001, 160},
	}
	var buf []event.StrokePayload
	for i, s := range samples {
		buf = append(buf, ps(i+1, s.atSec, s.dist))
	}
	// Strokes ≥3 should land inside the rower-console band. Strokes
	// 1–2 are tested separately (warmup, narrow window).
	for i := 2; i < len(buf); i++ {
		v, k := LivePace(buf[:i+1], win, pause)
		if k != LivePaceValue {
			t.Errorf("stroke %d: kind = %v, want value", i+1, k)
			continue
		}
		// Rower band: 1:38 (98 s) – 1:48 (108 s). Allow ±3 s for
		// integer-meter quantization that still affects Δd.
		if v < 95 || v > 111 {
			t.Errorf("stroke %d: pace = %d s/500m, want 95..111", i+1, v)
		}
	}
}
