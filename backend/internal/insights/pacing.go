package insights

import (
	"fmt"

	"github.com/gloeckner-daniel/splits/internal/event"
)

// PacingThresholdSec is the per-half delta (seconds per 500m) above
// which we flag a positive/negative split. Anything within ±this is
// considered an even split.
const PacingThresholdSec = 2.0

// DetectPacing compares the mean split of the first vs second half
// of the analysis window. Returns (Finding, true) on success, or
// (_, false) when the input is too short to evaluate (≤1 bucket).
func DetectPacing(s *event.SessionSamples) (Finding, bool) {
	if s == nil {
		return Finding{}, false
	}
	a := analysedSamples(s)
	if len(a.Split) < 2 {
		return Finding{}, false
	}
	mid := len(a.Split) / 2
	h1 := meanInt(a.Split[:mid])
	h2 := meanInt(a.Split[mid:])
	delta := h2 - h1

	var code Code
	var sev Severity
	var msg string
	switch {
	case delta > PacingThresholdSec:
		code, sev = CodePositiveSplit, SeverityNotable
		msg = fmt.Sprintf(
			"Positiver Split: Zweite Hälfte im Schnitt %ss langsamer als die erste (%s → %s).",
			FormatDecimal(delta, 1), FormatSplit(h1), FormatSplit(h2),
		)
	case delta < -PacingThresholdSec:
		code, sev = CodeNegativeSplit, SeverityInfo
		msg = fmt.Sprintf(
			"Negativer Split: Steigerung um %ss in der zweiten Hälfte (%s → %s).",
			FormatDecimal(-delta, 1), FormatSplit(h1), FormatSplit(h2),
		)
	default:
		code, sev = CodeEvenSplit, SeverityInfo
		msg = fmt.Sprintf(
			"Gleichmäßiges Tempo über beide Hälften (%s / %s).",
			FormatSplit(h1), FormatSplit(h2),
		)
	}

	return Finding{
		DetectorID: "pacing",
		Code:       code,
		Severity:   sev,
		Category:   CategoryPacing,
		MessageDE:  msg,
		Evidence: a.withWindow(map[string]float64{
			"h1":    h1,
			"h2":    h2,
			"delta": delta,
		}),
	}, true
}

func meanInt(xs []int) float64 {
	if len(xs) == 0 {
		return 0
	}
	var sum int
	for _, x := range xs {
		sum += x
	}
	return float64(sum) / float64(len(xs))
}
