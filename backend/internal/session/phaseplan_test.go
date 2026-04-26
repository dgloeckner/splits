package session

import (
	"encoding/json"
	"testing"

	"github.com/gloeckner-daniel/home-ergo/internal/workout"
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
	cases := []struct {
		name     string
		dist     int
		time     float64
		want     Phase
		complete bool
	}{
		{"warmup mid", 0, 30, PhaseWarmup, false},
		{"work start", 5, 61, PhaseWork, false},
		{"work mid", 1000, 300, PhaseWork, false},
		{"cooldown start", 2000, 600, PhaseCooldown, false},
		{"cooldown mid", 2000, 660, PhaseCooldown, false},
		{"cooldown done", 2000, 721, PhaseDone, true},
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
	// hit 500 → rest segment begins; remain at 500m for the 30s rest
	if p, _ := plan.Classify(500, 121); p != PhaseRest {
		t.Fatalf("rest: got %v", p)
	}
	// rep 2 mid (distance advanced past rest's start anchor)
	if p, _ := plan.Classify(750, 200); p != PhaseWork {
		t.Fatalf("rep2: got %v", p)
	}
	// cooldown=0 means after both reps done the workout is complete
	if p, complete := plan.Classify(1000, 260); p != PhaseDone || !complete {
		t.Fatalf("done: got %v complete=%v", p, complete)
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
