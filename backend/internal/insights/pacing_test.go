package insights

import (
	"math"
	"testing"

	"github.com/gloeckner-daniel/splits/internal/event"
)

func samplesFromSplits(splits []int) *event.SessionSamples {
	s := &event.SessionSamples{Split: splits}
	for i := range splits {
		s.T = append(s.T, float64(i+1))
		s.Watt = append(s.Watt, 200)
		s.SPM = append(s.SPM, 22)
		s.DPS = append(s.DPS, 9.0)
		s.SPI = append(s.SPI, 9)
	}
	return s
}

func TestPacingPositiveSplit(t *testing.T) {
	// First half ~119.6, second half ~123.2 → +3.6s.
	s := samplesFromSplits([]int{118, 119, 120, 120, 121, 121, 122, 123, 124, 126})
	f, ok := DetectPacing(s)
	if !ok {
		t.Fatal("expected finding")
	}
	if f.Code != CodePositiveSplit {
		t.Fatalf("code = %q, want POSITIVE_SPLIT", f.Code)
	}
	if f.Severity != SeverityNotable {
		t.Errorf("severity = %q, want NOTABLE", f.Severity)
	}
	if math.Abs(f.Evidence["delta"]-3.6) > 0.05 {
		t.Errorf("delta = %v, want ~3.6", f.Evidence["delta"])
	}
	if f.MessageDE != "Positiver Split: Zweite Hälfte im Schnitt 3,6s langsamer als die erste (1:59,6 → 2:03,2)." {
		t.Errorf("message: %q", f.MessageDE)
	}
}

func TestPacingNegativeSplit(t *testing.T) {
	s := samplesFromSplits([]int{126, 125, 124, 123, 122, 121, 120, 119, 118, 117})
	f, ok := DetectPacing(s)
	if !ok {
		t.Fatal("expected finding")
	}
	if f.Code != CodeNegativeSplit {
		t.Fatalf("code = %q, want NEGATIVE_SPLIT", f.Code)
	}
	if f.Severity != SeverityInfo {
		t.Errorf("severity = %q, want INFO", f.Severity)
	}
}

func TestPacingEvenSplit(t *testing.T) {
	s := samplesFromSplits([]int{120, 121, 120, 121, 120, 121, 120, 121, 120, 121})
	f, ok := DetectPacing(s)
	if !ok {
		t.Fatal("expected finding")
	}
	if f.Code != CodeEvenSplit {
		t.Fatalf("code = %q, want EVEN_SPLIT", f.Code)
	}
}

func TestPacingEmptySamplesSkips(t *testing.T) {
	if _, ok := DetectPacing(&event.SessionSamples{}); ok {
		t.Fatal("expected no finding on empty samples")
	}
}
