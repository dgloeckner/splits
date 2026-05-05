package insights

import (
	"testing"

	"github.com/gloeckner-daniel/splits/internal/event"
)

func samplesFromWatts(watts []int) *event.SessionSamples {
	s := &event.SessionSamples{Watt: watts}
	for i := range watts {
		s.T = append(s.T, float64(i+1))
		s.Split = append(s.Split, 120)
		s.SPM = append(s.SPM, 22)
		s.DPS = append(s.DPS, 9.0)
		s.SPI = append(s.SPI, 9)
	}
	return s
}

func TestFadeFlagged(t *testing.T) {
	// 10 buckets; mean ~200, last 20% (2 buckets) mean ~185 → 7.5% drop.
	s := samplesFromWatts([]int{215, 210, 205, 205, 200, 200, 198, 195, 190, 183})
	f, ok := DetectFade(s)
	if !ok {
		t.Fatal("expected finding")
	}
	if f.Code != CodeFade {
		t.Fatalf("code = %q, want FADE", f.Code)
	}
	if f.Severity != SeverityAttention {
		t.Errorf("severity = %q, want ATTENTION", f.Severity)
	}
	if f.Evidence["pct"] < 5.0 {
		t.Errorf("pct = %v, want ≥5", f.Evidence["pct"])
	}
}

func TestFadeBelowThresholdNoFinding(t *testing.T) {
	// Steady watts → no fade.
	s := samplesFromWatts([]int{200, 200, 200, 200, 200, 200, 200, 200, 200, 200})
	if _, ok := DetectFade(s); ok {
		t.Fatal("expected no finding for steady session")
	}
}

func TestFadeShortSamplesSkip(t *testing.T) {
	if _, ok := DetectFade(&event.SessionSamples{Watt: []int{200}}); ok {
		t.Fatal("expected no finding on too-short samples")
	}
}
