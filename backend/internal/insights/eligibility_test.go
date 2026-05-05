package insights

import "testing"

func TestEligibleStandardSession(t *testing.T) {
	r := CheckEligibility(SessionMeta{
		WorkoutMode: "distance",
		DurationSec: 600,
		DistanceM:   2480,
	})
	if !r.OK {
		t.Fatalf("expected eligible, got reason=%q", r.Reason)
	}
}

func TestNotEligibleIntervals(t *testing.T) {
	r := CheckEligibility(SessionMeta{
		WorkoutMode: "intervals",
		DurationSec: 1200,
		DistanceM:   3000,
	})
	if r.OK || r.Reason != ReasonIntervals {
		t.Fatalf("got OK=%v reason=%q", r.OK, r.Reason)
	}
}

func TestNotEligibleTooShort(t *testing.T) {
	cases := []SessionMeta{
		{WorkoutMode: "distance", DurationSec: 200, DistanceM: 1500},
		{WorkoutMode: "just_row", DurationSec: 600, DistanceM: 800},
	}
	for _, m := range cases {
		r := CheckEligibility(m)
		if r.OK || r.Reason != ReasonTooShort {
			t.Errorf("got OK=%v reason=%q for %+v", r.OK, r.Reason, m)
		}
	}
}

func TestEligibleEmptyWorkoutMode(t *testing.T) {
	// Sessions without an attached workout (legacy / just-row direct).
	r := CheckEligibility(SessionMeta{
		WorkoutMode: "",
		DurationSec: 600,
		DistanceM:   1500,
	})
	if !r.OK {
		t.Fatalf("expected eligible, got reason=%q", r.Reason)
	}
}
