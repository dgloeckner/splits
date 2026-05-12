package opponentsamples

import (
	"reflect"
	"testing"
)

// TestTrim is a table-driven test for the warmup-trim/rebase rule used to
// produce opponent samples whose t_sec[0] == 0 corresponds to the work-segment
// start of the source session.
//
// Rule (see PRD 0014, issue 0014-02):
//   - warmupSec == 0 → no-op: arrays returned unchanged.
//   - warmupSec  > 0 → drop every leading sample whose t_sec < warmupSec,
//     then rebase the remaining t_sec[] and distance_m[] so the first kept
//     element is 0. The rebase subtracts warmupSec (not the first kept
//     sample's t_sec) — see the "edge between samples" case.
func TestTrim(t *testing.T) {
	cases := []struct {
		name      string
		tSec      []float64
		distM     []float64
		warmupSec float64
		wantT     []float64
		wantD     []float64
	}{
		{
			name:      "warmup_sec=0 is a no-op",
			tSec:      []float64{0, 5, 10},
			distM:     []float64{0, 25, 50},
			warmupSec: 0,
			wantT:     []float64{0, 5, 10},
			wantD:     []float64{0, 25, 50},
		},
		{
			name:      "warmup_sec>0 drops leading and rebases to zero",
			tSec:      []float64{0, 30, 60, 90, 120},
			distM:     []float64{0, 150, 300, 450, 600},
			warmupSec: 60,
			// drop samples with t < 60: keep idx 2,3,4
			// rebase t by warmupSec=60, distance by distM at the kept-boundary=300
			wantT:  []float64{0, 30, 60},
			wantD:  []float64{0, 150, 300},
		},
		{
			name: "edge: work-segment start falls between two samples",
			// warmupSec=45 falls between t=30 and t=60.
			// Rule: include the first sample whose t >= warmupSec (t=60),
			// and rebase by subtracting warmupSec (not by the first kept t),
			// so the first kept t becomes 60-45=15, not 0.
			tSec:      []float64{0, 30, 60, 90},
			distM:     []float64{0, 150, 300, 450},
			warmupSec: 45,
			wantT:     []float64{15, 45},
			wantD:     []float64{0, 150},
		},
		{
			name:      "empty input is a no-op",
			tSec:      []float64{},
			distM:     []float64{},
			warmupSec: 60,
			wantT:     []float64{},
			wantD:     []float64{},
		},
		{
			name:      "all samples inside warmup → empty result",
			tSec:      []float64{0, 10, 20},
			distM:     []float64{0, 30, 60},
			warmupSec: 60,
			wantT:     []float64{},
			wantD:     []float64{},
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			gotT, gotD := Trim(tc.tSec, tc.distM, tc.warmupSec)
			if !reflect.DeepEqual(gotT, tc.wantT) {
				t.Fatalf("t_sec: got %v want %v", gotT, tc.wantT)
			}
			if !reflect.DeepEqual(gotD, tc.wantD) {
				t.Fatalf("distance_m: got %v want %v", gotD, tc.wantD)
			}
		})
	}
}
