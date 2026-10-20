package insights

// contradictions lists finding pairs that must not be presented as
// equals: when both codes fire, the Demote finding is downgraded to
// INFO and placed directly after the Keep finding. EVEN_SPLIT next to
// INCONSISTENT is almost always an edge-driven CV (the start-up bucket,
// see FEAT-0011 §Analysefenster); the halves are the sturdier reading.
var contradictions = []struct{ Keep, Demote Code }{
	{CodeEvenSplit, CodeInconsistent},
}

// Reconcile applies the contradiction table to a finding list and
// returns a new slice; the input is not modified. Findings not named in
// a firing pair keep their order and severity.
func Reconcile(findings []Finding) []Finding {
	out := make([]Finding, len(findings))
	copy(out, findings)
	for _, c := range contradictions {
		keep, demote := indexOf(out, c.Keep), indexOf(out, c.Demote)
		if keep < 0 || demote < 0 {
			continue
		}
		f := out[demote]
		f.Severity = SeverityInfo
		out = append(out[:demote], out[demote+1:]...)
		if demote < keep {
			keep--
		}
		out = append(out[:keep+1], append([]Finding{f}, out[keep+1:]...)...)
	}
	return out
}

func indexOf(findings []Finding, code Code) int {
	for i, f := range findings {
		if f.Code == code {
			return i
		}
	}
	return -1
}
