package insights

import (
	"testing"

	"github.com/gloeckner-daniel/splits/internal/event"
)

func TestConsistencyVeryEven(t *testing.T) {
	// CV ~1% (tightly clustered around 120).
	s := samplesFromSplits([]int{119, 120, 120, 121, 120, 119, 120, 121, 120, 120})
	f, ok := DetectConsistency(s)
	if !ok {
		t.Fatal("expected finding")
	}
	if f.Code != CodeConsistentHigh {
		t.Fatalf("code = %q, want CONSISTENT_HIGH", f.Code)
	}
	if f.Severity != SeverityInfo {
		t.Errorf("severity = %q, want INFO", f.Severity)
	}
}

func TestConsistencyMid(t *testing.T) {
	// CV in [2,5)%.
	s := samplesFromSplits([]int{115, 118, 120, 122, 124, 122, 120, 118, 116, 120})
	f, ok := DetectConsistency(s)
	if !ok {
		t.Fatal("expected finding")
	}
	if f.Code != CodeConsistentMid {
		t.Fatalf("code = %q, want CONSISTENT_MID, msg=%q cv=%v", f.Code, f.MessageDE, f.Evidence["cv"])
	}
}

func TestConsistencyInconsistent(t *testing.T) {
	// CV ≥ 5%.
	s := samplesFromSplits([]int{100, 130, 110, 135, 105, 128, 115, 140, 108, 125})
	f, ok := DetectConsistency(s)
	if !ok {
		t.Fatal("expected finding")
	}
	if f.Code != CodeInconsistent {
		t.Fatalf("code = %q, want INCONSISTENT", f.Code)
	}
	if f.Severity != SeverityNotable {
		t.Errorf("severity = %q, want NOTABLE", f.Severity)
	}
}

func TestConsistencyShortSkip(t *testing.T) {
	if _, ok := DetectConsistency(&event.SessionSamples{Split: []int{120}}); ok {
		t.Fatal("expected no finding on too-short samples")
	}
}
