package stats

import (
	"math"
	"testing"

	"github.com/gloeckner-daniel/splits/internal/event"
)

// makeStrokes synthesises a session with constant pace.
// distancePerStroke (m) and timePerStroke (s) drive a steady ergo.
func makeStrokes(n int, distancePerStroke, timePerStroke float64) []event.StrokePayload {
	out := make([]event.StrokePayload, n)
	for i := 0; i < n; i++ {
		out[i] = event.StrokePayload{
			StrokeNo:       i + 1,
			TimeSec:        float64(i+1) * timePerStroke,
			DistanceM:      int(float64(i+1) * distancePerStroke),
			PowerW:         200,
			PaceSecPer500m: 120,
			DPS:            distancePerStroke,
			EnergyJoules:   500,
			SPM:            int(60 / timePerStroke),
		}
	}
	return out
}

func TestDistanceCandidatesFindsTargetsBelowSessionTotal(t *testing.T) {
	// 610 strokes of 10 m, 2 s each: 6100 m in 1220 s.
	// Using 610 instead of 600 ensures the session extends past the 6000m
	// target by more than one stroke, so inter-stroke windows can cover all
	// standard distances up to 6000m (the new algorithm uses real stroke
	// pairs, losing at most one stroke's worth of distance at run start).
	strokes := makeStrokes(610, 10, 2)
	cs := distanceCandidates(strokes, []int{500, 1000, 2000, 5000, 6000, 10000})

	got := map[int]float64{}
	for _, c := range cs {
		got[c.DistanceM] = c.TimeSec
	}
	for _, d := range []int{500, 1000, 2000, 5000, 6000} {
		if _, ok := got[d]; !ok {
			t.Errorf("missing candidate for %dm", d)
		}
	}
	if _, ok := got[10000]; ok {
		t.Errorf("should not produce 10000m candidate (session is 6100m)")
	}
	// 2k at 10 m / stroke = 200 strokes × 2 s = 400 s.
	if v, ok := got[2000]; !ok || math.Abs(v-400) > 5 {
		t.Errorf("2000m time = %v, want ~400", v)
	}
}

func TestWindowCandidatesPower60s(t *testing.T) {
	strokes := makeStrokes(60, 10, 2) // 60 strokes × 2 s = 120 s, plenty for 60 s window
	cs := windowCandidates(strokes, []WindowDef{{Metric: "power", Kind: "seconds", Size: 60}})
	if len(cs) != 1 {
		t.Fatalf("want 1 window candidate, got %d", len(cs))
	}
	if cs[0].Value != 200 {
		t.Errorf("power 60s avg = %v, want 200", cs[0].Value)
	}
}

func TestWindowCandidatesDPS30Strokes(t *testing.T) {
	strokes := makeStrokes(40, 8, 2)
	cs := windowCandidates(strokes, []WindowDef{{Metric: "dps", Kind: "strokes", Size: 30}})
	if len(cs) != 1 {
		t.Fatalf("want 1 candidate, got %d", len(cs))
	}
	if math.Abs(cs[0].Value-8) > 0.01 {
		t.Errorf("dps 30-stroke avg = %v, want 8", cs[0].Value)
	}
}

func TestConsistencyOnlyAboveThreshold(t *testing.T) {
	if c := consistencyCandidates(makeStrokes(MinStrokesForConsistency, 10, 2)); c == nil || c.PowerCV != 0 {
		t.Errorf("perfect-steady CV should be 0, got %+v", c)
	}
	got := ComputeCandidates(makeStrokes(MinStrokesForConsistency-1, 10, 2))
	if got.Consistency != nil {
		t.Errorf("below threshold should skip consistency, got %+v", got.Consistency)
	}
}

func TestComputeCandidatesPopulatesAll(t *testing.T) {
	c := ComputeCandidates(makeStrokes(600, 10, 2))
	if len(c.Distance) == 0 {
		t.Error("missing distance candidates")
	}
	if len(c.Window) == 0 {
		t.Error("missing window candidates")
	}
	if c.Consistency == nil {
		t.Error("missing consistency candidates")
	}
}

func TestComputeCandidatesProduces2kForExactWorkout(t *testing.T) {
	// Simulate strokes from a 2000m distance workout with no warmup.
	// The run starts near 0 (first stroke at 10m) and ends slightly past
	// the target (last stroke at 2010m), which is the normal case when the
	// final stroke crosses the target distance. A 2000m candidate must be
	// produced; with the old normalizeRun + implicit-origin code this
	// failed because the first stroke's distance was stripped, leaving
	// only 1990m of recoverable span.
	var in []event.StrokePayload
	for i := 1; i <= 201; i++ {
		in = append(in, event.StrokePayload{
			StrokeNo:  i,
			TimeSec:   float64(i) * 2.0, // 2s per stroke
			DistanceM: i * 10,           // 10m per stroke; last stroke = 2010m
			PowerW:    200,
		})
	}
	c := ComputeCandidates(in)
	var got *DistanceCandidate
	for i := range c.Distance {
		if c.Distance[i].DistanceM == 2000 {
			got = &c.Distance[i]
		}
	}
	if got == nil {
		t.Fatal("expected 2000m candidate, got none")
	}
	// Window from stroke 1 (10m, t=2) to stroke 201 (2010m, t=402): 2000m
	// span in 400s. Accept anything within ±10s of 400.
	if got.TimeSec > 410 || got.TimeSec < 390 {
		t.Fatalf("2000m time = %v, expected ~400", got.TimeSec)
	}
}

func TestComputeCandidatesPerWorkSegmentRuns(t *testing.T) {
	mk := func(no int, ts float64, d int, p int) event.StrokePayload {
		return event.StrokePayload{StrokeNo: no, TimeSec: ts, DistanceM: d, PowerW: p}
	}
	in := []event.StrokePayload{
		mk(1, 1, 50, 200), mk(2, 2, 100, 200), mk(3, 4, 250, 200),
		mk(4, 5, 500, 200),
		// rep 2 starts after rest (rest strokes filtered out → stroke_no jumps)
		mk(20, 65, 550, 200), mk(21, 66, 600, 200), mk(22, 68, 750, 200),
		mk(23, 69, 1000, 200),
	}
	c := ComputeCandidates(in)
	for _, d := range c.Distance {
		if d.DistanceM == 1000 {
			t.Fatalf("did not expect a 1k candidate spanning rest gap: %+v", d)
		}
	}
}
