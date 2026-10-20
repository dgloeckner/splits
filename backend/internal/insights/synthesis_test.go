package insights

import "testing"

func TestSynthesizeEmpty(t *testing.T) {
	if got := Synthesize(nil); got != "" {
		t.Errorf("got %q, want empty", got)
	}
}

func TestSynthesizeSingleFinding(t *testing.T) {
	got := Synthesize([]Finding{
		{Code: CodeFade, Severity: SeverityAttention, MessageDE: "Leistungsabfall."},
	})
	if got != "Leistungsabfall." {
		t.Errorf("got %q", got)
	}
}

func TestSynthesizeOrdersBySeverity(t *testing.T) {
	got := Synthesize([]Finding{
		{Code: CodeConsistentHigh, Severity: SeverityInfo, MessageDE: "C."},
		{Code: CodeFade, Severity: SeverityAttention, MessageDE: "F."},
		{Code: CodePositiveSplit, Severity: SeverityNotable, MessageDE: "P."},
	})
	if got != "F. P. C." {
		t.Errorf("got %q", got)
	}
}

func TestSynthesizeUsesEmDashConnective(t *testing.T) {
	got := Synthesize([]Finding{
		{Code: CodePositiveSplit, Severity: SeverityNotable, MessageDE: "Positiver Split."},
		{Code: CodeFade, Severity: SeverityAttention, MessageDE: "Leistungsabfall."},
	})
	// FADE wins on severity, dashed connective with POSITIVE_SPLIT.
	if got != "Leistungsabfall. — Positiver Split." {
		t.Errorf("got %q", got)
	}
}

func TestSynthesizeCapsAtThree(t *testing.T) {
	got := Synthesize([]Finding{
		{Code: CodeFade, Severity: SeverityAttention, MessageDE: "A."},
		{Code: CodePositiveSplit, Severity: SeverityNotable, MessageDE: "B."},
		{Code: CodeInconsistent, Severity: SeverityNotable, MessageDE: "C."},
		{Code: CodeNegativeSplit, Severity: SeverityInfo, MessageDE: "D."},
	})
	if got != "A. B. C." {
		t.Errorf("got %q", got)
	}
}
