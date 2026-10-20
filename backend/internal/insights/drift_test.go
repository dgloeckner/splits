package insights

import (
	"strings"
	"testing"

	"github.com/gloeckner-daniel/splits/internal/event"
)

// driftSamples builds n buckets whose DPS, SPM and split move linearly
// from the first to the second value, at a steady 300 W.
func driftSamples(n int, dps [2]float64, spm [2]float64, split [2]int) *event.SessionSamples {
	s := &event.SessionSamples{BucketStrokes: 5}
	for i := 0; i < n; i++ {
		f := float64(i) / float64(n-1)
		s.T = append(s.T, float64(i+1)*10)
		s.DPS = append(s.DPS, dps[0]+(dps[1]-dps[0])*f)
		s.SPM = append(s.SPM, spm[0]+(spm[1]-spm[0])*f)
		s.Split = append(s.Split, split[0]+int(float64(split[1]-split[0])*f))
		s.Watt = append(s.Watt, 300)
	}
	return s
}

func TestDriftSilentOnFixture(t *testing.T) {
	// The reconstructed 11.06.2026 fixture shows DPS −5 % and SPM +2,
	// but its split gets 2.1 s faster: a deliberate speed-up, not drift.
	// (The stored session measures only −1.2 % / +0.7, FEAT-0011 §Sweep.)
	_, s := loadSamplesFixture(t, fixture5000m)
	m, ok := MeasureDrift(s)
	if !ok {
		t.Fatal("fixture not measurable")
	}
	if m.Split2-m.Split1 >= -PacingThresholdSec {
		t.Fatalf("split change = %.1f s, want faster than −%.0f s", m.Split2-m.Split1, PacingThresholdSec)
	}
	if f, ok := DetectDrift(s); ok {
		t.Errorf("fired on a speed-up: %s", f.MessageDE)
	}
}

func TestDriftFinding(t *testing.T) {
	s := driftSamples(104, [2]float64{10, 9.4}, [2]float64{27, 29}, [2]int{108, 108})
	f, ok := DetectDrift(s)
	if !ok {
		t.Fatal("expected a drift finding")
	}
	if f.Code != CodeEfficiencyDrift || f.Severity != SeverityNotable || f.Category != CategoryEfficiency {
		t.Errorf("finding = %s/%s/%s", f.Code, f.Severity, f.Category)
	}
	if !strings.HasPrefix(f.MessageDE, "Effizienzdrift: Schlaglänge von ") ||
		!strings.Contains(f.MessageDE, " m gesunken, Schlagzahl von ") ||
		!strings.HasSuffix(f.MessageDE, " gestiegen.") {
		t.Errorf("message = %q", f.MessageDE)
	}
	for _, k := range []string{"dps1", "dps2", "dps_pct", "spm1", "spm2", "split1", "split2", "window_from", "window_to"} {
		if _, ok := f.Evidence[k]; !ok {
			t.Errorf("evidence lacks %q", k)
		}
	}

	res := Run(SessionMeta{WorkoutMode: "distance", DurationSec: 1200, DistanceM: 5000}, s)
	if res.Findings[len(res.Findings)-1].Code != CodeEfficiencyDrift {
		t.Errorf("findings = %v, want EFFICIENCY_DRIFT from Run", codes(res.Findings))
	}
	// NOTABLE sorts ahead of the INFO pacing/consistency findings.
	if !strings.HasPrefix(Synthesize(res.Findings), "Effizienzdrift:") {
		t.Errorf("synthesis = %q", Synthesize(res.Findings))
	}
}

func TestDriftCases(t *testing.T) {
	cases := []struct {
		name string
		s    *event.SessionSamples
		want bool
	}{
		{"drift: DPS −6 %, SPM +2, split flat", driftSamples(40, [2]float64{10, 9.4}, [2]float64{27, 29}, [2]int{108, 108}), true},
		{"flat session", driftSamples(40, [2]float64{9.6, 9.6}, [2]float64{28, 28}, [2]int{108, 108}), false},
		{"DPS down without rate rise is not drift", driftSamples(40, [2]float64{10, 9.4}, [2]float64{28, 28.3}, [2]int{108, 108}), false},
		{"DPS down, SPM flat, split up is fade/positive split", driftSamples(40, [2]float64{10, 9.4}, [2]float64{28, 28}, [2]int{106, 114}), false},
		{"drift while slowing is a positive split", driftSamples(40, [2]float64{10, 9.4}, [2]float64{27, 29}, [2]int{106, 112}), false},
		{"drift while speeding up is a deliberate rate rise", driftSamples(40, [2]float64{10, 9.4}, [2]float64{26, 29}, [2]int{110, 104}), false},
		{"small DPS change", driftSamples(40, [2]float64{10, 9.7}, [2]float64{27, 29}, [2]int{108, 108}), false},
		{"window too short", driftSamples(DriftMinBuckets-1, [2]float64{10, 9}, [2]float64{26, 30}, [2]int{108, 108}), false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			f, ok := DetectDrift(tc.s)
			if ok != tc.want {
				t.Fatalf("fired = %v (%s), want %v", ok, f.MessageDE, tc.want)
			}
		})
	}
}

func TestRunSuppressesDriftWhenFadeFires(t *testing.T) {
	s := driftSamples(40, [2]float64{10, 9.4}, [2]float64{27, 29}, [2]int{108, 108})
	for i := 32; i < 40; i++ {
		s.Watt[i] = 240 // final 20 % sags 20 %
	}
	if _, ok := DetectDrift(s); !ok {
		t.Fatal("precondition: drift fires on its own")
	}
	res := Run(SessionMeta{WorkoutMode: "just_row", DurationSec: 600, DistanceM: 2000}, s)
	for _, f := range res.Findings {
		if f.Code == CodeEfficiencyDrift {
			t.Error("drift reported next to fade")
		}
	}
}
