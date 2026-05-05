package insights

import (
	"fmt"
	"math"

	"github.com/gloeckner-daniel/splits/internal/event"
)

const (
	// CVHigh is the upper edge of "sehr gleichmäßig" (very even).
	CVHigh = 2.0
	// CVMid is the upper edge of "gleichmäßig"; above → "ungleichmäßig".
	CVMid = 5.0
)

// DetectConsistency reports the coefficient of variation of the split
// series, bucketed into three labels.
func DetectConsistency(s *event.SessionSamples) (Finding, bool) {
	if s == nil || len(s.Split) < 3 {
		return Finding{}, false
	}
	mean := meanInt(s.Split)
	if mean <= 0 {
		return Finding{}, false
	}
	var sumSq float64
	for _, v := range s.Split {
		d := float64(v) - mean
		sumSq += d * d
	}
	std := math.Sqrt(sumSq / float64(len(s.Split)))
	cv := std / mean * 100

	var code Code
	var sev Severity
	var label string
	switch {
	case cv < CVHigh:
		code, sev, label = CodeConsistentHigh, SeverityInfo, "sehr gleichmäßig"
	case cv < CVMid:
		code, sev, label = CodeConsistentMid, SeverityInfo, "gleichmäßig"
	default:
		code, sev, label = CodeInconsistent, SeverityNotable, "ungleichmäßig"
	}
	msg := fmt.Sprintf("Tempokonstanz: %s (Split-Variation %s%%).", label, FormatDecimal(cv, 1))

	return Finding{
		DetectorID: "consistency",
		Code:       code,
		Severity:   sev,
		Category:   CategoryConsistency,
		MessageDE:  msg,
		Evidence: map[string]float64{
			"cv":   cv,
			"mean": mean,
			"std":  std,
		},
	}, true
}
