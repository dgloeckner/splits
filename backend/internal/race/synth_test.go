package race

import (
	"testing"

	"github.com/gloeckner-daniel/splits/internal/workout"
)

func TestSynthGhostConstantSplit(t *testing.T) {
	// 2:00/500m at 1000 m → 240 s total. Sample every 5 s.
	tSec, split := SynthGhost(1000, workout.IntensityModerat)
	if got, want := len(tSec), len(split); got != want {
		t.Fatalf("len mismatch: tSec=%d split=%d", got, want)
	}
	if tSec[0] != 0 {
		t.Fatalf("first t=%v, want 0", tSec[0])
	}
	last := tSec[len(tSec)-1]
	if last < 239 || last > 241 {
		t.Fatalf("last t=%v, want ~240", last)
	}
	for _, s := range split {
		if s != 120 {
			t.Fatalf("split=%v, want constant 120", s)
		}
	}
}

func TestSynthGhostHardnessMappings(t *testing.T) {
	cases := map[workout.Intensity]float64{
		workout.IntensityLocker:  135, // 2:15
		workout.IntensityModerat: 120, // 2:00
		workout.IntensityHart:    110, // 1:50
		workout.IntensityAllOut:  102, // 1:42
	}
	for in, wantSplit := range cases {
		_, split := SynthGhost(2000, in)
		if split[0] != wantSplit {
			t.Errorf("intensity %q: split=%v want %v", in, split[0], wantSplit)
		}
	}
}

func TestSynthGhostUnknownIntensityFallsBackToModerate(t *testing.T) {
	_, split := SynthGhost(500, workout.Intensity(""))
	if split[0] != 120 {
		t.Fatalf("default split=%v, want 120", split[0])
	}
}
