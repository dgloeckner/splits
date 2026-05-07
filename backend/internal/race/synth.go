// Package race generates synthetic opponents for the race workout
// mode (FEAT-0013). When a user starts a race for a distance they
// have never rowed before, this package builds a constant-pace ghost
// from the chosen intensity so the race is still playable.
package race

import "github.com/gloeckner-daniel/splits/internal/workout"

const sampleStepSec = 5.0

// targetSplitFor returns the seconds-per-500m for the given intensity.
// Unknown intensities map to moderat.
func targetSplitFor(in workout.Intensity) float64 {
	switch in {
	case workout.IntensityLocker:
		return 135
	case workout.IntensityHart:
		return 110
	case workout.IntensityAllOut:
		return 102
	}
	return 120
}

// SynthGhost returns parallel (t_sec, split) arrays that cover a
// constant-pace row from 0 to `meters`. Sample step is 5 s; the
// trailing sample lands on the precise total duration.
func SynthGhost(meters int, intensity workout.Intensity) ([]float64, []float64) {
	split := targetSplitFor(intensity)
	velocity := 500 / split // m/s
	totalSec := float64(meters) / velocity
	n := int(totalSec/sampleStepSec) + 1
	tSec := make([]float64, 0, n+1)
	splits := make([]float64, 0, n+1)
	for i := 0; i < n; i++ {
		tSec = append(tSec, float64(i)*sampleStepSec)
		splits = append(splits, split)
	}
	if tSec[len(tSec)-1] < totalSec {
		tSec = append(tSec, totalSec)
		splits = append(splits, split)
	}
	return tSec, splits
}
