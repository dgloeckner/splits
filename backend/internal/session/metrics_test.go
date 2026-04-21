package session

import (
	"math"
	"testing"
)

func feq(a, b, eps float64) bool { return math.Abs(a-b) <= eps }

func TestDPS(t *testing.T) {
	// 8 m between strokes at stroke 2 → DPS = 8.
	if got := DPS(0, 8, 0); !feq(got, 8, 1e-9) {
		t.Errorf("got %v", got)
	}
	// First stroke: no previous distance, DPS is 0.
	if got := DPSFirst(); got != 0 {
		t.Errorf("got %v", got)
	}
}

func TestStrokeCycleSec(t *testing.T) {
	if got := StrokeCycleSec(83.1, 85.3); !feq(got, 2.2, 1e-9) {
		t.Errorf("got %v", got)
	}
	if got := StrokeCycleSec(85.3, 85.3); got != 0 {
		t.Errorf("got %v", got)
	}
}

func TestPaceSecPer500m(t *testing.T) {
	// 8 m per 2.2 s → 500/8*2.2 = 137.5 s, truncated to 137.
	if got := PaceSecPer500m(8, 2.2); got != 137 {
		t.Errorf("got %v", got)
	}
	if got := PaceSecPer500m(0, 2.2); got != 0 {
		t.Errorf("got %v", got)
	}
	if got := PaceSecPer500m(8, 0); got != 0 {
		t.Errorf("got %v", got)
	}
}

func TestEnergyJoules(t *testing.T) {
	// 245 W * 2.22 s = 543.9 J → 544 after Round.
	if got := EnergyJoules(245, 2.22); got != 544 {
		t.Errorf("got %v", got)
	}
	if got := EnergyJoules(245, 0); got != 0 {
		t.Errorf("got %v", got)
	}
}
