package session

import (
	"encoding/json"
	"testing"

	"github.com/gloeckner-daniel/splits/internal/workout"
)

func TestPhasePlanDistanceWithWarmupCooldown(t *testing.T) {
	w := &workout.Workout{
		ID:          "w1",
		Mode:        workout.ModeDistance,
		ParamsJSON:  json.RawMessage(`{"meters":2000}`),
		WarmupSec:   60,
		CooldownSec: 120,
	}
	plan, err := BuildPhasePlan(w)
	if err != nil {
		t.Fatalf("build: %v", err)
	}
	// B5: distance segments count post-warmup metres only. The first
	// stroke after warmup ends (here at d=5, t=61) latches
	// warmupEndDistance=5, so the 2000m work goal is reached at
	// cumulative distance 2005, not 2000.
	cases := []struct {
		name     string
		dist     int
		time     float64
		want     Phase
		complete bool
	}{
		{"warmup mid", 0, 30, PhaseWarmup, false},
		{"work start", 5, 61, PhaseWork, false}, // latches warmupEndDistance=5
		{"work mid", 1000, 300, PhaseWork, false},
		// (2005, 600) is the first stroke to reach 2000m post-warmup
		// (2005 cumulative − 5 warmup-end = 2000 work). Crossing stroke
		// itself stays classified as work.
		{"work crossing", 2005, 600, PhaseWork, false},
		// Next call at same distance: crossedAt set → cooldown begins.
		{"cooldown start", 2005, 600, PhaseCooldown, false},
		{"cooldown mid", 2005, 660, PhaseCooldown, false},
		{"cooldown done", 2005, 721, PhaseDone, true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, complete := plan.Classify(tc.dist, tc.time)
			if got != tc.want {
				t.Fatalf("phase: got %v want %v", got, tc.want)
			}
			if complete != tc.complete {
				t.Fatalf("complete: got %v want %v", complete, tc.complete)
			}
		})
	}
}

func TestPhasePlanIntervalsRestExcluded(t *testing.T) {
	w := &workout.Workout{
		ID:          "w2",
		Mode:        workout.ModeIntervals,
		ParamsJSON:  json.RawMessage(`{"reps":2,"length":{"unit":"m","value":500},"rest_sec":30}`),
		WarmupSec:   0,
		CooldownSec: 0,
	}
	plan, err := BuildPhasePlan(w)
	if err != nil {
		t.Fatalf("build: %v", err)
	}
	// rep 1 mid
	if p, _ := plan.Classify(250, 60); p != PhaseWork {
		t.Fatalf("rep1: got %v", p)
	}
	// First stroke that hits exactly 500m → crossing stroke still counted as
	// work so it is included in totals and PB candidates.
	if p, _ := plan.Classify(500, 121); p != PhaseWork {
		t.Fatalf("rep1 crossing: got %v, want PhaseWork", p)
	}
	// Second call at same distance: crossedAt already set → rest begins.
	if p, _ := plan.Classify(500, 121); p != PhaseRest {
		t.Fatalf("rest: got %v", p)
	}
	// rep 2 mid (distance advanced past rest's start anchor)
	if p, _ := plan.Classify(750, 200); p != PhaseWork {
		t.Fatalf("rep2: got %v", p)
	}
	// First stroke that hits exactly 1000m → crossing stroke for rep 2, still work.
	if p, _ := plan.Classify(1000, 260); p != PhaseWork {
		t.Fatalf("rep2 crossing: got %v, want PhaseWork", p)
	}
	// cooldown=0 means after both reps done the workout is complete;
	// second call (crossedAt already set) falls through to PhaseDone.
	if p, complete := plan.Classify(1000, 260); p != PhaseDone || !complete {
		t.Fatalf("done: got %v complete=%v", p, complete)
	}
}

func TestPhasePlanCrossingStrokeIsWork(t *testing.T) {
	w := &workout.Workout{
		ID:          "w1",
		Mode:        workout.ModeDistance,
		ParamsJSON:  []byte(`{"meters":100}`),
		WarmupSec:   0,
		CooldownSec: 0,
	}
	plan, err := BuildPhasePlan(w)
	if err != nil {
		t.Fatal(err)
	}
	// Stroke at exactly target distance → still work (crossing); first call
	// sees not-yet-crossed, returns PhaseWork, false.
	if p, complete := plan.Classify(100, 30); p != PhaseWork || complete {
		t.Fatalf("crossing stroke: got %v complete=%v want PhaseWork false", p, complete)
	}
	// Next stroke past the crossing → done, complete=true.
	if p, complete := plan.Classify(101, 31); p != PhaseDone || !complete {
		t.Fatalf("post-crossing stroke: got %v complete=%v want PhaseDone true", p, complete)
	}
}

func TestPhasePlanFreeRow(t *testing.T) {
	plan := FreeRowPhasePlan()
	if p, _ := plan.Classify(0, 0); p != PhaseWork {
		t.Fatalf("free row should be all work")
	}
	if p, complete := plan.Classify(99999, 99999); p != PhaseWork || complete {
		t.Fatalf("free row never completes")
	}
}
