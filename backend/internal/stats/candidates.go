package stats

import (
	"math"

	"github.com/gloeckner-daniel/splits/internal/event"
)

// PBCandidates is the per-session set of best-effort values that
// future recomputes read instead of re-scanning strokes (which are
// gone after Mode 0 compaction). Persister stores this inside
// summary_json.pb_candidates at session_end.
type PBCandidates struct {
	Distance    []DistanceCandidate    `json:"distance,omitempty"`
	Window      []WindowCandidate      `json:"window,omitempty"`
	Consistency *ConsistencyCandidates `json:"consistency,omitempty"`
	// Workout candidate is filled by the persister when the session
	// is attached to a workout, since the per-workout PB depends on
	// the workout's shape_hash and mode (not in stroke data).
	Workout *WorkoutCandidate `json:"workout,omitempty"`
}

// DistanceCandidate is the best (shortest) inside-window time over
// the named target distance found anywhere in this session. Empty
// for sessions that never accumulate enough distance.
type DistanceCandidate struct {
	DistanceM         int     `json:"distance_m"`
	TimeSec           float64 `json:"time_sec"`
	WindowStartStroke int     `json:"window_start_stroke"`
	WindowEndStroke   int     `json:"window_end_stroke"`
}

// WindowCandidate is the best rolling-average of a metric over a
// fixed window. Kind is "seconds" or "strokes". Higher-is-better for
// power/dps/spi; lower-is-better for pace.
type WindowCandidate struct {
	Metric     string  `json:"metric"`
	Kind       string  `json:"kind"`
	Size       int     `json:"size"`
	Value      float64 `json:"value"`
}

// ConsistencyCandidates carry the three within-session CVs (FEAT-0010
// (c)). Lower is better. nil when the session has fewer than the
// minimum-strokes threshold.
type ConsistencyCandidates struct {
	PowerCV     float64 `json:"power_cv"`
	PaceSplitCV float64 `json:"pace_split_cv"`
	SPMCV       float64 `json:"spm_cv"`
}

// WorkoutCandidate is the per-workout PB's value for this session.
// ValueKind is "time_sec" or "distance_m" depending on the workout's
// mode. The shape_hash, mode, and params live on the workout row;
// they are not duplicated here.
type WorkoutCandidate struct {
	ShapeHash string  `json:"shape_hash"`
	Mode      string  `json:"mode"`
	ValueKind string  `json:"value_kind"`
	Value     float64 `json:"value"`
}

// StandardDistances are the rolling-window targets we always track.
var StandardDistances = []int{500, 1000, 2000, 5000, 6000, 10000}

// WindowDefs lists the fixed window-PB definitions. Locked at
// deployment per FEAT-0010 — adding a definition later cannot
// back-fill historical sessions whose strokes are gone.
//
// Pace is intentionally absent: split = sec/500m by definition, so
// a "best 60 s avg pace" is not a metric rowers track. Continuous
// 500 m and longer distance PBs cover the split story; window-PBs
// here are reserved for intensity metrics with no natural
// distance equivalent (power) or stroke-quality metrics
// (DPS, SPI).
var WindowDefs = []WindowDef{
	{Metric: "power", Kind: "seconds", Size: 60},
	{Metric: "dps", Kind: "strokes", Size: 30},
	{Metric: "spi", Kind: "strokes", Size: 30},
}

// MinStrokesForConsistency is the threshold below which a session
// does not contribute consistency candidates.
const MinStrokesForConsistency = 80

// WindowDef is one entry in WindowDefs.
type WindowDef struct {
	Metric string
	Kind   string
	Size   int
}

// ComputeCandidates runs every per-session candidate computation
// over `strokes` (already ordered by stroke_no). Returns a fully
// populated PBCandidates (Workout slot left for the caller to fill
// in if a workout is attached).
//
// Distance and window candidates are computed per work-segment run
// (split wherever stroke_no jumps by more than 1, indicating a rest
// interval whose strokes were filtered out). The best value across
// runs wins. Consistency candidates are computed over the full stroke
// list, as they measure whole-session variability.
func ComputeCandidates(strokes []event.StrokePayload) *PBCandidates {
	runs := splitByStrokeNoGap(strokes)
	out := &PBCandidates{}
	for _, run := range runs {
		mergeDistance(&out.Distance, distanceCandidates(run, StandardDistances))
		mergeWindow(&out.Window, windowCandidates(run, WindowDefs))
	}
	if len(strokes) >= MinStrokesForConsistency {
		out.Consistency = consistencyCandidates(strokes)
	}
	return out
}

// splitByStrokeNoGap splits strokes into contiguous work-segment runs.
// A gap is detected when consecutive stroke_no values differ by more
// than 1 (rest strokes were filtered before this call).
//
// Runs are passed as-is (cumulative DistanceM / TimeSec preserved)
// to distanceCandidates, which uses inter-stroke windows only and
// therefore never requires a (0,0) origin pseudo-stroke.
func splitByStrokeNoGap(strokes []event.StrokePayload) [][]event.StrokePayload {
	if len(strokes) == 0 {
		return nil
	}
	var out [][]event.StrokePayload
	cur := []event.StrokePayload{strokes[0]}
	for i := 1; i < len(strokes); i++ {
		if strokes[i].StrokeNo-strokes[i-1].StrokeNo > 1 {
			out = append(out, cur)
			cur = nil
		}
		cur = append(cur, strokes[i])
	}
	if len(cur) > 0 {
		out = append(out, cur)
	}
	return out
}

// mergeDistance merges in into acc, keeping the best (shortest) time
// per distance target.
func mergeDistance(acc *[]DistanceCandidate, in []DistanceCandidate) {
	for _, c := range in {
		found := false
		for i := range *acc {
			if (*acc)[i].DistanceM == c.DistanceM {
				if c.TimeSec < (*acc)[i].TimeSec {
					(*acc)[i] = c
				}
				found = true
				break
			}
		}
		if !found {
			*acc = append(*acc, c)
		}
	}
}

// mergeWindow merges in into acc, keeping the best value per
// (metric, kind, size) triple.
func mergeWindow(acc *[]WindowCandidate, in []WindowCandidate) {
	for _, c := range in {
		found := false
		for i := range *acc {
			ex := (*acc)[i]
			if ex.Metric == c.Metric && ex.Kind == c.Kind && ex.Size == c.Size {
				if better(c.Metric, c.Value, ex.Value) {
					(*acc)[i] = c
				}
				found = true
				break
			}
		}
		if !found {
			*acc = append(*acc, c)
		}
	}
}

// distanceCandidates finds, for each target distance, the shortest
// time over a window of *exactly* d metres. Strokes carry cumulative
// DistanceM and TimeSec; treat the trace as a piecewise-linear curve
// of time-vs-distance and slide a d-metre-wide window over it.
//
// Window endpoints are linearly interpolated between adjacent strokes,
// so a "500 m PB" really represents 500 m of work, not the next-whole-
// stroke overshoot (which over-stated the split by up to ~one stroke
// distance / ~1–2 s on a fast 500 m). Two scans cover both
// optimum-anchor classes (end snapped to a stroke vs. start snapped to
// a stroke); their min is the true best.
func distanceCandidates(strokes []event.StrokePayload, distances []int) []DistanceCandidate {
	if len(strokes) < 2 {
		return nil
	}
	out := make([]DistanceCandidate, 0, len(distances))
	for _, d := range distances {
		bestDur := math.Inf(1)
		bestStart, bestEnd := 0, 0

		// Scan A: anchor end at each stroke j; interpolate start at
		// distance D[j]-d within segment [i, i+1].
		i := 0
		for j := 0; j < len(strokes); j++ {
			target := float64(strokes[j].DistanceM - d)
			if target < float64(strokes[0].DistanceM) {
				continue
			}
			for i+1 < j && float64(strokes[i+1].DistanceM) <= target {
				i++
			}
			if i+1 >= len(strokes) || strokes[i+1].DistanceM < strokes[j].DistanceM-d {
				continue
			}
			startT := interpTime(
				float64(strokes[i].DistanceM), strokes[i].TimeSec,
				float64(strokes[i+1].DistanceM), strokes[i+1].TimeSec,
				target,
			)
			dur := strokes[j].TimeSec - startT
			if dur > 0 && dur < bestDur {
				bestDur = dur
				bestStart, bestEnd = strokes[i].StrokeNo, strokes[j].StrokeNo
			}
		}

		// Scan B: anchor start at each stroke i; interpolate end at
		// distance D[i]+d within segment [j, j+1].
		j := 0
		for k := 0; k < len(strokes); k++ {
			target := float64(strokes[k].DistanceM + d)
			if target > float64(strokes[len(strokes)-1].DistanceM) {
				break
			}
			if j < k {
				j = k
			}
			for j+1 < len(strokes) && float64(strokes[j+1].DistanceM) <= target {
				j++
			}
			if j+1 >= len(strokes) {
				continue
			}
			endT := interpTime(
				float64(strokes[j].DistanceM), strokes[j].TimeSec,
				float64(strokes[j+1].DistanceM), strokes[j+1].TimeSec,
				target,
			)
			dur := endT - strokes[k].TimeSec
			if dur > 0 && dur < bestDur {
				bestDur = dur
				bestStart, bestEnd = strokes[k].StrokeNo, strokes[j+1].StrokeNo
			}
		}

		if !math.IsInf(bestDur, 1) {
			out = append(out, DistanceCandidate{
				DistanceM:         d,
				TimeSec:           bestDur,
				WindowStartStroke: bestStart,
				WindowEndStroke:   bestEnd,
			})
		}
	}
	return out
}

// interpTime linearly interpolates time at distance dx within a
// segment whose endpoints are (d0, t0) and (d1, t1). When the segment
// has zero distance (degenerate), returns t0.
func interpTime(d0, t0, d1, t1, dx float64) float64 {
	if d1 == d0 {
		return t0
	}
	return t0 + (t1-t0)*(dx-d0)/(d1-d0)
}

// windowCandidates computes one best per WindowDef. Stroke-based
// windows look back N strokes; second-based windows look back until
// the cumulative time delta meets size.
func windowCandidates(strokes []event.StrokePayload, defs []WindowDef) []WindowCandidate {
	if len(strokes) == 0 {
		return nil
	}
	out := make([]WindowCandidate, 0, len(defs))
	for _, d := range defs {
		var best float64
		var have bool
		switch d.Kind {
		case "strokes":
			if len(strokes) < d.Size {
				continue
			}
			var sum float64
			for i := 0; i < d.Size; i++ {
				sum += strokeMetric(strokes[i], d.Metric)
			}
			best = sum / float64(d.Size)
			have = true
			for j := d.Size; j < len(strokes); j++ {
				sum += strokeMetric(strokes[j], d.Metric)
				sum -= strokeMetric(strokes[j-d.Size], d.Metric)
				v := sum / float64(d.Size)
				if better(d.Metric, v, best) {
					best = v
				}
			}
		case "seconds":
			i := 0
			var sum float64
			for j := range strokes {
				sum += strokeMetric(strokes[j], d.Metric)
				for i < j && strokes[j].TimeSec-strokes[i].TimeSec > float64(d.Size) {
					sum -= strokeMetric(strokes[i], d.Metric)
					i++
				}
				if strokes[j].TimeSec-strokes[i].TimeSec >= float64(d.Size) {
					n := j - i + 1
					v := sum / float64(n)
					if !have || better(d.Metric, v, best) {
						best = v
						have = true
					}
				}
			}
		}
		if have {
			out = append(out, WindowCandidate{
				Metric: d.Metric, Kind: d.Kind, Size: d.Size, Value: best,
			})
		}
	}
	return out
}

func strokeMetric(s event.StrokePayload, metric string) float64 {
	switch metric {
	case "power":
		return float64(s.PowerW)
	case "pace":
		return float64(s.PaceSecPer500m)
	case "dps":
		return s.DPS
	case "spi":
		// Stroke-power index ≈ work per stroke in joules.
		return float64(s.EnergyJoules)
	}
	return 0
}

// better reports whether candidate v should replace cur for the
// given metric. Pace is lower-is-better; everything else is
// higher-is-better.
func better(metric string, v, cur float64) bool {
	if metric == "pace" {
		return v < cur
	}
	return v > cur
}

// consistencyCandidates returns the three CVs (σ / mean) for the
// session. Caller checks the minimum-strokes threshold first.
func consistencyCandidates(strokes []event.StrokePayload) *ConsistencyCandidates {
	power := make([]float64, len(strokes))
	pace := make([]float64, len(strokes))
	spm := make([]float64, len(strokes))
	for i, s := range strokes {
		power[i] = float64(s.PowerW)
		pace[i] = float64(s.PaceSecPer500m)
		spm[i] = float64(s.SPM)
	}
	return &ConsistencyCandidates{
		PowerCV:     coeffOfVar(power),
		PaceSplitCV: coeffOfVar(pace),
		SPMCV:       coeffOfVar(spm),
	}
}

func coeffOfVar(xs []float64) float64 {
	if len(xs) == 0 {
		return 0
	}
	var sum float64
	for _, v := range xs {
		sum += v
	}
	mean := sum / float64(len(xs))
	if mean == 0 {
		return 0
	}
	var sq float64
	for _, v := range xs {
		d := v - mean
		sq += d * d
	}
	stddev := math.Sqrt(sq / float64(len(xs)))
	return stddev / mean
}
