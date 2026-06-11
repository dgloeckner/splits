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

// TestComputeCandidates_PreB5SessionsYieldNoOversizedCandidate covers
// the pre-B5 scenario (session 01KRNGHFXX...) where a 5K distance
// workout had a warmup eating into the cumulative distance: warmup
// ended at ~410m, work ended at ~5110m → work-only span = ~4700m.
// Since B5, the work phase always contains the full goal distance, so
// this shape no longer occurs in new sessions. With warmup excluded,
// no 5000m candidate must be produced when work-only span < 5000m.
//
// Pre-B5 DB sessions affected by this lose synthetic 5km PBs on the
// next recompute by design (accuracy over retention, decision
// 2026-06-10).
func TestComputeCandidates_PreB5SessionsYieldNoOversizedCandidate(t *testing.T) {
	// 40 slow warmup strokes covering ~410m, then 470 work strokes at
	// 10m/2s covering 4700m → work-only span = 4700m < 5000m.
	var in []event.StrokePayload
	cumD := 0
	cumT := 0.0
	for i := 1; i <= 40; i++ {
		cumT += 3 // slow recovery, ~3 s/stroke
		cumD += 10
		in = append(in, event.StrokePayload{
			StrokeNo: i, TimeSec: cumT, DistanceM: cumD, PowerW: 150, Phase: "warmup",
		})
	}
	for i := 41; i <= 510; i++ {
		cumT += 2
		cumD += 10
		in = append(in, event.StrokePayload{
			StrokeNo: i, TimeSec: cumT, DistanceM: cumD, PowerW: 260, Phase: "work",
		})
	}
	c := ComputeCandidates(in)
	for i := range c.Distance {
		if c.Distance[i].DistanceM == 5000 {
			t.Errorf("unexpected 5000m candidate with work-only span <5000m: %+v — warmup must not contribute headroom", c.Distance[i])
		}
	}
}

// TestComputeCandidates_DistanceExcludesWarmup: a fast 500m warmup
// followed by slower 500m of work must produce a 500m candidate from
// the WORK strokes only — the warmup sprint must not become the PB.
func TestComputeCandidates_DistanceExcludesWarmup(t *testing.T) {
	// Build strokes: warmup 0-500m at ~2s/stroke (fast), work 500-1000m at ~2.6s/stroke (slower)
	var strokes []event.StrokePayload
	// Warmup: 50 strokes of 10m each, 2s per stroke, fast (~100s for 500m)
	for i := 0; i < 50; i++ {
		strokes = append(strokes, event.StrokePayload{
			StrokeNo:  i + 1,
			Phase:     "warmup",
			DistanceM: (i + 1) * 10,
			TimeSec:   float64(i+1) * 2.0,
			PowerW:    300,
			SPM:       26,
		})
	}
	// Work: 51 strokes of 10m each, 2.6s per stroke, slower (~130s for 500m).
	// DistanceM starts at 500 (first work stroke) and ends at 1000 (51st),
	// giving the window algorithm a 500m span to work with.
	for i := 0; i <= 50; i++ {
		strokes = append(strokes, event.StrokePayload{
			StrokeNo:  51 + i,
			Phase:     "work",
			DistanceM: 500 + i*10,
			TimeSec:   100.0 + float64(i)*2.6,
			PowerW:    200,
			SPM:       22,
		})
	}
	candidates := ComputeCandidates(strokes)
	var found *DistanceCandidate
	for i := range candidates.Distance {
		if candidates.Distance[i].DistanceM == 500 {
			found = &candidates.Distance[i]
			break
		}
	}
	if found == nil {
		t.Fatal("no 500m candidate produced — work phase spans exactly 500m and should yield one")
	}
	// The 500m candidate must come from work strokes (time ~130s), not warmup (time ~100s).
	if found.TimeSec < 120 {
		t.Errorf("500m candidate TimeSec=%f looks like warmup pace (~100s) — warmup must be excluded; expected ~130s from work strokes", found.TimeSec)
	}
}

// TestComputeCandidatesB1_WindowCandidatesIgnoreWarmup confirms that
// warmup strokes still don't dilute non-distance candidates: the
// per-candidate phase filter keeps work-only strokes for window and
// consistency computation.
func TestComputeCandidatesB1_WindowCandidatesIgnoreWarmup(t *testing.T) {
	var in []event.StrokePayload
	// 30 weak warmup strokes (60W) then 100 strong work strokes (300W).
	cumD := 0
	cumT := 0.0
	for i := 1; i <= 30; i++ {
		cumT += 2
		cumD += 5
		in = append(in, event.StrokePayload{
			StrokeNo: i, TimeSec: cumT, DistanceM: cumD, PowerW: 60, Phase: "warmup",
		})
	}
	for i := 31; i <= 130; i++ {
		cumT += 2
		cumD += 10
		in = append(in, event.StrokePayload{
			StrokeNo: i, TimeSec: cumT, DistanceM: cumD, PowerW: 300, Phase: "work",
		})
	}
	c := ComputeCandidates(in)
	for _, w := range c.Window {
		if w.Metric == "power" && w.Kind == "seconds" && w.Size == 60 {
			if w.Value < 250 {
				t.Errorf("power-60s window value = %v, expected ≥ 250W (warmup leaked into window?)", w.Value)
			}
			return
		}
	}
	t.Fatal("expected a power-60s window candidate")
}

func distancesOf(in []DistanceCandidate) []int {
	out := make([]int, 0, len(in))
	for _, c := range in {
		out = append(out, c.DistanceM)
	}
	return out
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
