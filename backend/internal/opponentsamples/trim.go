// Package opponentsamples encapsulates the warmup-trim/rebase rule that
// turns a session-sourced opponent's raw (t_sec[], distance_m[]) into
// parallel arrays aligned to the opponent's work-segment start.
//
// See PRD-0014 issue 0014-02. The rule is:
//
//   - warmupSec == 0  → no-op (arrays returned unchanged in content).
//   - warmupSec  > 0  → drop every leading sample whose t_sec < warmupSec,
//     then rebase the remaining t_sec[] by subtracting warmupSec
//     (so t_sec[0] is the gap between the first kept sample and the
//     work-segment start, which is 0 when warmupSec hits a sample
//     exactly), and rebase distance_m[] by subtracting the first kept
//     sample's distance (so distance_m[0] == 0).
//
// Synth-ghost callers must NOT use this — synth samples start at t=0 by
// construction, and routing them through here would still be a no-op
// but the synth-ghost path is explicitly outside this module's contract.
package opponentsamples

// Trim drops leading samples covering the warmup and rebases the remaining
// t_sec[] / distance_m[] so they begin at the work-segment start of the
// source session.
//
// Inputs are parallel arrays of equal length (the function tolerates
// distance_m being shorter and returns whatever distance values are
// available, but in practice the caller passes equal-length arrays).
//
// When warmupSec is 0 the function returns the inputs unchanged (same
// length, same values). When all samples are inside the warmup the
// function returns empty slices.
//
// Time-axis rebase: subtract warmupSec from every kept t_sec. This means
// that when the work-segment start falls strictly between two samples,
// the first kept sample's rebased t_sec is positive (the gap between
// warmupSec and the first sample's original t_sec), not 0. That choice
// keeps the time-axis monotone with the wall-clock cadence of the source
// session and avoids a phantom "instantaneous metres" at t=0.
//
// Distance-axis rebase: subtract the first kept sample's distance from
// every kept distance. The first kept sample is treated as the
// work-segment-start anchor for distance, so distance_m[0] == 0.
func Trim(tSec, distM []float64, warmupSec float64) ([]float64, []float64) {
	if warmupSec == 0 {
		return tSec, distM
	}
	// Find first index with t_sec >= warmupSec.
	start := 0
	for start < len(tSec) && tSec[start] < warmupSec {
		start++
	}
	if start >= len(tSec) {
		// Every sample is inside the warmup; preserve input slice
		// "emptiness" semantics: return zero-length non-nil slices.
		return []float64{}, []float64{}
	}
	kept := len(tSec) - start
	outT := make([]float64, kept)
	outD := make([]float64, 0, kept)
	for i := 0; i < kept; i++ {
		outT[i] = tSec[start+i] - warmupSec
	}
	// Distance rebase uses the first kept sample as the anchor.
	if start < len(distM) {
		base := distM[start]
		for i := start; i < len(distM); i++ {
			outD = append(outD, distM[i]-base)
		}
	}
	return outT, outD
}
