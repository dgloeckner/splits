package insights

import (
	"testing"

	"github.com/gloeckner-daniel/splits/internal/event"
)

func TestRunSkippedIneligible(t *testing.T) {
	res := Run(SessionMeta{WorkoutMode: "intervals", DurationSec: 600, DistanceM: 2000}, &event.SessionSamples{})
	if res.Eligible {
		t.Fatal("expected ineligible")
	}
	if res.Reason != ReasonIntervals {
		t.Errorf("reason = %q", res.Reason)
	}
	if len(res.Findings) != 0 {
		t.Errorf("findings = %d, want 0", len(res.Findings))
	}
	if res.SynthesisDE != "" {
		t.Errorf("synthesis = %q", res.SynthesisDE)
	}
}

func TestRunStandardSession(t *testing.T) {
	splits := []int{118, 119, 120, 120, 121, 121, 122, 123, 124, 126}
	watts := []int{215, 210, 205, 205, 200, 200, 198, 195, 190, 183}
	s := &event.SessionSamples{Split: splits, Watt: watts}
	for i := range splits {
		s.T = append(s.T, float64(i+1))
		s.SPM = append(s.SPM, 22)
		s.DPS = append(s.DPS, 9.0)
		s.SPI = append(s.SPI, 9)
	}
	res := Run(SessionMeta{WorkoutMode: "distance", DurationSec: 600, DistanceM: 2480}, s)
	if !res.Eligible {
		t.Fatalf("expected eligible, reason=%q", res.Reason)
	}
	codes := map[Code]bool{}
	for _, f := range res.Findings {
		codes[f.Code] = true
	}
	for _, want := range []Code{CodePositiveSplit, CodeFade} {
		if !codes[want] {
			t.Errorf("missing finding %q", want)
		}
	}
	if res.SynthesisDE == "" {
		t.Error("expected synthesis text")
	}
}
