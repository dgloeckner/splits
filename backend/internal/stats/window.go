package stats

import "github.com/gloeckner-daniel/splits/internal/event"

// WorkoutGoal is the target an analysis window ends at. Mode is the
// workout mode ("distance", "time", …); Target is metres for distance
// and seconds for time, and is ignored for every other mode.
//
// OriginDistanceM and OriginTimeSec are the cumulative distance and
// time at which the work phase began (0 without a warmup), so the goal
// is measured over the work phase only.
type WorkoutGoal struct {
	Mode            string
	Target          float64
	OriginDistanceM int
	OriginTimeSec   float64
}

// minWindowBuckets is the smallest window worth analysing. A rule that
// leaves fewer buckets falls back to the full series.
const minWindowBuckets = 2

// ComputeAnalysisWindow returns the analysis window (Analysefenster,
// FEAT-0011) over the buckets ComputeSamples builds from the same
// strokes and bucket size.
//
//   - From is 1: the first bucket gets the boat up to speed and is
//     dropped.
//   - To ends after the bucket holding the first stroke that reaches
//     the goal: cumulative work distance ≥ Target for "distance", work
//     time ≥ Target for "time". Every other mode, and a session that
//     ends before the goal, ends at the last bucket.
//
// When that leaves fewer than two buckets the window is the full
// series. Returns nil when there are no strokes.
func ComputeAnalysisWindow(strokes []event.StrokePayload, bucketStrokes int, goal WorkoutGoal) *event.SamplesWindow {
	if len(strokes) == 0 {
		return nil
	}
	if bucketStrokes <= 0 {
		bucketStrokes = DefaultBucketStrokes
	}
	nBuckets := (len(strokes) + bucketStrokes - 1) / bucketStrokes

	to := nBuckets
	if goalIdx := goalStrokeIndex(strokes, goal); goalIdx >= 0 {
		to = goalIdx/bucketStrokes + 1
	}
	w := &event.SamplesWindow{From: 1, To: to}
	if w.To-w.From < minWindowBuckets {
		return &event.SamplesWindow{From: 0, To: nBuckets}
	}
	return w
}

// goalStrokeIndex returns the index of the first stroke that reaches
// the goal, or -1 when the mode has no goal or it was never reached.
func goalStrokeIndex(strokes []event.StrokePayload, goal WorkoutGoal) int {
	if goal.Target <= 0 {
		return -1
	}
	for i, s := range strokes {
		switch goal.Mode {
		case "distance":
			if float64(s.DistanceM-goal.OriginDistanceM) >= goal.Target {
				return i
			}
		case "time":
			if s.TimeSec-goal.OriginTimeSec >= goal.Target {
				return i
			}
		default:
			return -1
		}
	}
	return -1
}
