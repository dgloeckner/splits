package insights

import (
	"sort"
	"strings"
)

const synthesisCap = 3

var severityRank = map[Severity]int{
	SeverityAttention: 0,
	SeverityNotable:   1,
	SeverityInfo:      2,
}

// dashedPairs lists ordered Code pairs (a, b) where joining the
// b-message after the a-message uses an em-dash connective. Pair
// order follows already-severity-sorted output.
var dashedPairs = map[[2]Code]bool{
	{CodeFade, CodePositiveSplit}:       true,
	{CodeFade, CodeInconsistent}:        true,
	{CodePositiveSplit, CodeFade}:       true,
	{CodePositiveSplit, CodeInconsistent}: true,
}

// Synthesize joins the top-N findings into a single German paragraph.
// Contradicting pairs are reconciled first (see Reconcile), then sorted
// by severity (ATTENTION > NOTABLE > INFO), capped at 3.
func Synthesize(findings []Finding) string {
	if len(findings) == 0 {
		return ""
	}
	sorted := Reconcile(findings)
	sort.SliceStable(sorted, func(i, j int) bool {
		return severityRank[sorted[i].Severity] < severityRank[sorted[j].Severity]
	})
	if len(sorted) > synthesisCap {
		sorted = sorted[:synthesisCap]
	}
	var b strings.Builder
	b.WriteString(sorted[0].MessageDE)
	for i := 1; i < len(sorted); i++ {
		prev, cur := sorted[i-1].Code, sorted[i].Code
		if len(sorted) == 2 && dashedPairs[[2]Code{prev, cur}] {
			b.WriteString(" — ")
		} else {
			b.WriteString(" ")
		}
		b.WriteString(sorted[i].MessageDE)
	}
	return b.String()
}
