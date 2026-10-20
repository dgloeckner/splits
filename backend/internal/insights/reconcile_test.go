package insights

import (
	"reflect"
	"testing"
)

func codes(fs []Finding) []Code {
	out := make([]Code, len(fs))
	for i, f := range fs {
		out[i] = f.Code
	}
	return out
}

func TestReconcile(t *testing.T) {
	inconsistent := Finding{Code: CodeInconsistent, Severity: SeverityNotable, MessageDE: "Tempokonstanz: ungleichmäßig (Split-Variation 6,0 %)."}
	even := Finding{Code: CodeEvenSplit, Severity: SeverityInfo, MessageDE: "Gleichmäßiges Tempo über beide Hälften (1:48,3 / 1:47,8)."}
	fade := Finding{Code: CodeFade, Severity: SeverityAttention, MessageDE: "Leistungsabfall."}
	positive := Finding{Code: CodePositiveSplit, Severity: SeverityNotable, MessageDE: "Positiver Split."}

	cases := []struct {
		name     string
		in       []Finding
		want     []Code
		wantSevs []Severity
	}{
		{"inconsistent first is moved after even split", []Finding{inconsistent, even},
			[]Code{CodeEvenSplit, CodeInconsistent}, []Severity{SeverityInfo, SeverityInfo}},
		{"already after even split", []Finding{even, inconsistent},
			[]Code{CodeEvenSplit, CodeInconsistent}, []Severity{SeverityInfo, SeverityInfo}},
		{"other findings keep their place", []Finding{fade, inconsistent, even},
			[]Code{CodeFade, CodeEvenSplit, CodeInconsistent}, []Severity{SeverityAttention, SeverityInfo, SeverityInfo}},
		{"no even split, no change", []Finding{positive, inconsistent},
			[]Code{CodePositiveSplit, CodeInconsistent}, []Severity{SeverityNotable, SeverityNotable}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			in := append([]Finding(nil), tc.in...)
			got := Reconcile(in)
			if !reflect.DeepEqual(codes(got), tc.want) {
				t.Fatalf("order = %v, want %v", codes(got), tc.want)
			}
			for i, f := range got {
				if f.Severity != tc.wantSevs[i] {
					t.Errorf("%s severity = %s, want %s", f.Code, f.Severity, tc.wantSevs[i])
				}
			}
			if !reflect.DeepEqual(in, tc.in) {
				t.Error("Reconcile modified its input")
			}
		})
	}
}

// #40 slice 2: [INCONSISTENT(NOTABLE), EVEN_SPLIT] → pacing first,
// consistency downgraded to INFO.
func TestSynthesizeContradictionGuard(t *testing.T) {
	got := Synthesize([]Finding{
		{Code: CodeInconsistent, Severity: SeverityNotable, MessageDE: "Tempokonstanz: ungleichmäßig."},
		{Code: CodeEvenSplit, Severity: SeverityInfo, MessageDE: "Gleichmäßiges Tempo."},
	})
	if want := "Gleichmäßiges Tempo. Tempokonstanz: ungleichmäßig."; got != want {
		t.Errorf("got %q, want %q", got, want)
	}
}

func TestRunReconcilesBeforeReturning(t *testing.T) {
	// Even halves, but two wild buckets push the CV past 5 %.
	s := samplesFromSplits([]int{108, 160, 60, 108, 108, 108, 108, 108, 108, 108})
	res := Run(SessionMeta{WorkoutMode: "just_row", DurationSec: 600, DistanceM: 2000}, s)
	var cs []Code
	for _, f := range res.Findings {
		if f.Code == CodeInconsistent && f.Severity != SeverityInfo {
			t.Errorf("INCONSISTENT severity = %s, want INFO next to EVEN_SPLIT", f.Severity)
		}
		cs = append(cs, f.Code)
	}
	if !reflect.DeepEqual(cs, []Code{CodeEvenSplit, CodeInconsistent}) {
		t.Fatalf("findings = %v, want [EVEN_SPLIT INCONSISTENT]", cs)
	}
}
