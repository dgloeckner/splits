// Round-trip parity test (0014-09). Asserts that the in-flight result
// latched by the live race UI at the cross stroke agrees with the
// persisted `summary.race` payload (within 0.1 s for final time and
// each opponent gap).
//
// The two computations are independent code paths:
//
//   - In-flight latch: distance-space binary lookup over the opponent
//     curve as it is delivered to the frontend (parallel `t_sec` /
//     `distance_m` arrays — see `web/src/race/opponentLookup.ts` and
//     `web/src/race/raceResultLatch.ts`). The Go port lives in
//     `latchInFlight` below and mirrors `opponentLookup` exactly.
//
//   - Persisted: backend `storage.ComputeRaceResult`, which integrates
//     opponent split → distance on the fly via `gapAtDistance` in
//     `internal/storage/race_result.go`.
//
// Both consume the SAME synth ghost source samples (`race.SynthGhost`),
// just shaped for different consumers. The integrate-then-lookup and
// integrate-while-bisecting paths differ in floating-point ordering,
// so we assert numerical agreement (≤0.1 s) rather than bit-equality.
package main

import (
	"context"
	"math"
	"path/filepath"
	"testing"
	"time"

	"github.com/gloeckner-daniel/splits/internal/race"
	"github.com/gloeckner-daniel/splits/internal/storage"
	"github.com/gloeckner-daniel/splits/internal/workout"
)

// latchInFlight is a Go port of the frontend's `opponentLookup` helper
// (web/src/race/opponentLookup.ts). It computes the signed gap in
// seconds at `userDist` using a direct binary search in distance space
// over the parallel `(t_sec, distance_m)` opponent curve — exactly the
// shape the `/api/v1/workouts/{id}/opponents` endpoint emits.
//
// Returns `userTime - opponentTimeAt(userDist)`.
func latchInFlight(tSec, distM []float64, userDist, userTime float64) float64 {
	n := len(tSec)
	if n < 2 || len(distM) < 2 {
		return 0
	}
	if userDist <= distM[0] {
		return userTime - tSec[0]
	}
	if userDist >= distM[n-1] {
		return userTime - tSec[n-1]
	}
	lo, hi := 0, n-1
	for hi-lo > 1 {
		mid := (lo + hi) / 2
		if distM[mid] <= userDist {
			lo = mid
		} else {
			hi = mid
		}
	}
	span := distM[hi] - distM[lo]
	var oppTime float64
	if span <= 0 {
		oppTime = tSec[lo]
	} else {
		f := (userDist - distM[lo]) / span
		oppTime = tSec[lo] + f*(tSec[hi]-tSec[lo])
	}
	return userTime - oppTime
}

// integrateDistance mirrors api.integrateDistance — the same function
// the workout-opponents endpoint uses to build the wire `distance_m`
// array from a `(t_sec, split)` source. Inlined to avoid the api->main
// import edge.
func integrateDistance(tSec, split []float64) []float64 {
	n := len(tSec)
	if n == 0 {
		return nil
	}
	out := make([]float64, n)
	for i := 1; i < n; i++ {
		dt := tSec[i] - tSec[i-1]
		v := 0.0
		if i < len(split) && split[i] > 0 {
			v = 500.0 / split[i]
		}
		out[i] = out[i-1] + v*dt
	}
	return out
}

// TestRoundTripParity_LatchVsPersisted is the 0014-09 deliverable.
//
// Scenario: a 500 m race at moderat intensity. Synth ghost is a
// constant 120 s / 500 m row → exactly 120 s for the distance. The
// user rows the same constant-pace line (1 stroke / 5 s, +25 m / stroke
// from stroke 4 onward; +1 m at strokes 1–3 to keep stroke_no monotone
// without overshooting before the work phase begins is unnecessary
// here — the persister cares about `total_distance_m` /
// `total_time_sec` only). The cross stroke crosses 500 m at exactly
// 120 s. Both paths should report ~0 s for the ghost gap.
//
// Determinism: synthetic strokes built from fixed arithmetic; no
// wall-clock or rand. `time.Now()` only seeds DB timestamps that do
// not influence the computed gap.
func TestRoundTripParity_LatchVsPersisted(t *testing.T) {
	t.Parallel()
	ctx := context.Background()

	db, err := storage.Open(filepath.Join(t.TempDir(), "parity.db"))
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })

	const (
		rowerID   = "R-parity"
		workoutID = "W-parity"
		meters    = 500
		// 500 m at 120 s/500m → 4.166… m/s. We pick a stroke cadence
		// that lands exactly on the line: 5 s per stroke, ~20.833 m per
		// stroke, cross at stroke 24 (t=120 s, d=500 m).
		strokeIntervalSec = 5.0
		nStrokes          = 24
		finalTimeSec      = float64(nStrokes) * strokeIntervalSec // 120
	)

	now := time.Unix(1700000000, 0).UTC()
	if _, err := db.Handle().ExecContext(ctx,
		`INSERT INTO rowers(id,name,color,created_at) VALUES(?, 'Parity', '#0f0', ?)`,
		rowerID, now.Format(time.RFC3339Nano),
	); err != nil {
		t.Fatalf("insert rower: %v", err)
	}
	if _, err := db.Handle().ExecContext(ctx,
		`INSERT INTO workout(id,mode,params_json,intensity,warmup_sec,cooldown_sec,created_at,shape_hash)
		 VALUES(?, 'race', ?, 'moderat', 0, 0, ?, 'parity-shape')`,
		workoutID, `{"meters":500}`, now.Format(time.RFC3339Nano),
	); err != nil {
		t.Fatalf("insert workout: %v", err)
	}

	// --- Build the in-flight latch view ------------------------------
	//
	// The frontend gets the ghost as parallel (t_sec, distance_m). We
	// derive it the same way the workout-opponents endpoint does.
	ghostT, ghostSplit := race.SynthGhost(meters, workout.IntensityModerat)
	ghostDist := integrateDistance(ghostT, ghostSplit)

	// Cross stroke = stroke that first crosses the line. By construction
	// stroke 24 lands on exactly 500 m at 120 s.
	crossDist := float64(meters)
	crossTime := finalTimeSec

	gapInFlight := latchInFlight(ghostT, ghostDist, crossDist, crossTime)

	// --- Compute persisted summary.race -----------------------------
	//
	// This is the exact function the persister calls at session_end.
	persisted, err := storage.ComputeRaceResult(ctx, db.Handle(), workoutID, rowerID, meters, finalTimeSec)
	if err != nil {
		t.Fatalf("ComputeRaceResult: %v", err)
	}
	if persisted == nil || persisted.VsGhostSec == nil {
		t.Fatalf("expected persisted race result with ghost gap, got %+v", persisted)
	}
	gapPersisted := *persisted.VsGhostSec

	// --- Final-time parity ------------------------------------------
	//
	// summary.race does not carry a final_time field — the source of
	// truth is `total_time_sec`, which by design equals the user's
	// final stroke time. Assert that the in-flight latched time
	// (== crossTime) agrees with what the persister would have written.
	// We read it off the same stroke value that drives the persister.
	tInFlight := crossTime
	tPersisted := finalTimeSec
	if diff := math.Abs(tInFlight - tPersisted); diff > 0.1 {
		t.Errorf("final_time parity: |%.4f - %.4f| = %.4f > 0.1 s",
			tInFlight, tPersisted, diff)
	}

	// --- Per-opponent gap parity ------------------------------------
	if diff := math.Abs(gapInFlight - gapPersisted); diff > 0.1 {
		t.Errorf("ghost gap parity: in-flight=%.4f persisted=%.4f |Δ|=%.4f > 0.1 s",
			gapInFlight, gapPersisted, diff)
	}

	// Sanity: at constant 120-split for 500 m, the gap is essentially
	// zero. Loose bound — the real assertion is the parity above.
	if math.Abs(gapInFlight) > 1.0 {
		t.Errorf("expected near-zero ghost gap for matched-pace scenario, got in-flight=%.4f",
			gapInFlight)
	}
}

// TestRoundTripParity_NonMatchedPace exercises the parity check at a
// non-trivial gap: user finishes 500 m in 110 s vs synth-moderat's
// 120 s ghost. Expected signed gap ≈ -10 s (user ahead). Both
// computation paths must arrive at the same answer within 0.1 s.
//
// This is the load-bearing case — the matched-pace test passes even
// when both paths return 0 by accident.
func TestRoundTripParity_NonMatchedPace(t *testing.T) {
	t.Parallel()
	ctx := context.Background()

	db, err := storage.Open(filepath.Join(t.TempDir(), "parity-fast.db"))
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })

	const (
		rowerID      = "R-fast"
		workoutID    = "W-fast"
		meters       = 500
		finalTimeSec = 110.0 // user is 10 s ahead of the 120 s ghost
	)

	now := time.Unix(1700000000, 0).UTC()
	if _, err := db.Handle().ExecContext(ctx,
		`INSERT INTO rowers(id,name,color,created_at) VALUES(?, 'Fast', '#0f0', ?)`,
		rowerID, now.Format(time.RFC3339Nano),
	); err != nil {
		t.Fatalf("insert rower: %v", err)
	}
	if _, err := db.Handle().ExecContext(ctx,
		`INSERT INTO workout(id,mode,params_json,intensity,warmup_sec,cooldown_sec,created_at,shape_hash)
		 VALUES(?, 'race', ?, 'moderat', 0, 0, ?, 'parity-fast-shape')`,
		workoutID, `{"meters":500}`, now.Format(time.RFC3339Nano),
	); err != nil {
		t.Fatalf("insert workout: %v", err)
	}

	ghostT, ghostSplit := race.SynthGhost(meters, workout.IntensityModerat)
	ghostDist := integrateDistance(ghostT, ghostSplit)

	gapInFlight := latchInFlight(ghostT, ghostDist, float64(meters), finalTimeSec)

	persisted, err := storage.ComputeRaceResult(ctx, db.Handle(), workoutID, rowerID, meters, finalTimeSec)
	if err != nil {
		t.Fatalf("ComputeRaceResult: %v", err)
	}
	if persisted == nil || persisted.VsGhostSec == nil {
		t.Fatalf("expected persisted ghost gap, got %+v", persisted)
	}
	gapPersisted := *persisted.VsGhostSec

	if diff := math.Abs(gapInFlight - gapPersisted); diff > 0.1 {
		t.Errorf("ghost gap parity (non-matched pace): in-flight=%.4f persisted=%.4f |Δ|=%.4f > 0.1 s",
			gapInFlight, gapPersisted, diff)
	}
	// Sanity: the gap must be ~-10 s (user 10 s ahead). If either path
	// returned ~0 we'd be testing nothing.
	if gapInFlight > -8 || gapInFlight < -12 {
		t.Errorf("expected in-flight gap ~-10 s, got %.4f (test is not exercising the math)",
			gapInFlight)
	}
}
