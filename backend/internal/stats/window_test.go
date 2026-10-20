package stats

import (
	"testing"

	"github.com/gloeckner-daniel/splits/internal/event"
)

// rowStrokes builds n work strokes, 10 m and 2 s each, so stroke i
// (1-based) sits at 10·i m and 2·i s.
func rowStrokes(n int) []event.StrokePayload {
	out := make([]event.StrokePayload, n)
	for i := range out {
		out[i] = event.StrokePayload{
			StrokeNo:  i + 1,
			TimeSec:   float64(i+1) * 2,
			DistanceM: (i + 1) * 10,
			Phase:     "work",
		}
	}
	return out
}

func TestComputeAnalysisWindow(t *testing.T) {
	cases := []struct {
		name    string
		strokes int
		goal    WorkoutGoal
		want    event.SamplesWindow
	}{
		// 52 strokes → 11 buckets. 500 m is stroke 50 (index 49) →
		// bucket 9; the overrun strokes 51–52 form bucket 10.
		{"distance goal mid-session", 52, WorkoutGoal{Mode: "distance", Target: 500}, event.SamplesWindow{From: 1, To: 10}},
		// 500 m reached on the very last stroke → window runs to the end.
		{"distance goal at last stroke", 50, WorkoutGoal{Mode: "distance", Target: 500}, event.SamplesWindow{From: 1, To: 10}},
		{"distance goal never reached", 40, WorkoutGoal{Mode: "distance", Target: 500}, event.SamplesWindow{From: 1, To: 8}},
		// 60 s is stroke 30 (index 29) → bucket 5.
		{"time goal", 40, WorkoutGoal{Mode: "time", Target: 60}, event.SamplesWindow{From: 1, To: 6}},
		{"just_row", 40, WorkoutGoal{Mode: "just_row"}, event.SamplesWindow{From: 1, To: 8}},
		{"race ends at last bucket", 52, WorkoutGoal{Mode: "race", Target: 500}, event.SamplesWindow{From: 1, To: 11}},
		{"no workout", 40, WorkoutGoal{}, event.SamplesWindow{From: 1, To: 8}},
		// A warmup ran 100 m / 20 s before the work phase: the 500 m goal
		// is measured from there, so it falls on cumulative 600 m.
		{"distance goal after warmup", 62, WorkoutGoal{Mode: "distance", Target: 500, OriginDistanceM: 100}, event.SamplesWindow{From: 1, To: 12}},
		{"time goal after warmup", 40, WorkoutGoal{Mode: "time", Target: 40, OriginTimeSec: 20}, event.SamplesWindow{From: 1, To: 6}},
		// One bucket: dropping it would leave nothing → full series.
		{"one bucket falls back", 5, WorkoutGoal{Mode: "just_row"}, event.SamplesWindow{From: 0, To: 1}},
		// Two buckets: dropping the first leaves one → full series.
		{"two buckets fall back", 8, WorkoutGoal{Mode: "just_row"}, event.SamplesWindow{From: 0, To: 2}},
		// Goal reached in the first bucket → window would be empty.
		{"goal in first bucket falls back", 20, WorkoutGoal{Mode: "distance", Target: 30}, event.SamplesWindow{From: 0, To: 4}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := ComputeAnalysisWindow(rowStrokes(tc.strokes), 5, tc.goal)
			if got == nil || *got != tc.want {
				t.Fatalf("window = %+v, want %+v", got, tc.want)
			}
		})
	}
}

func TestComputeAnalysisWindowNoStrokes(t *testing.T) {
	if w := ComputeAnalysisWindow(nil, 5, WorkoutGoal{Mode: "distance", Target: 500}); w != nil {
		t.Fatalf("window = %+v, want nil", w)
	}
}

// The window indexes the buckets ComputeSamples builds, so it must
// never run past them.
func TestComputeAnalysisWindowMatchesSamples(t *testing.T) {
	for n := 1; n <= 60; n++ {
		strokes := rowStrokes(n)
		s := ComputeSamples(strokes, 5)
		w := ComputeAnalysisWindow(strokes, 5, WorkoutGoal{Mode: "distance", Target: 300})
		if w.From < 0 || w.To > len(s.Split) || w.From >= w.To {
			t.Fatalf("n=%d: window %+v outside %d buckets", n, w, len(s.Split))
		}
	}
}
