package insights

import (
	"fmt"

	"github.com/gloeckner-daniel/splits/internal/event"
)

// FadePct is the percentage drop in mean watts (final 20% segment vs
// session mean) above which we flag a fade.
const FadePct = 5.0

// FadeFinalFraction is the trailing fraction of buckets used as the
// "final segment" in the fade calculation.
const FadeFinalFraction = 0.20

// DetectFade flags a watt drop in the trailing FadeFinalFraction of
// the analysis window, so strokes after the goal can neither create
// nor hide a fade. Severity is ATTENTION (it's actionable) once
// triggered.
func DetectFade(s *event.SessionSamples) (Finding, bool) {
	if s == nil {
		return Finding{}, false
	}
	a := analysedSamples(s)
	if len(a.Watt) < 5 {
		return Finding{}, false
	}
	avg := meanInt(a.Watt)
	if avg <= 0 {
		return Finding{}, false
	}
	tail := int(float64(len(a.Watt)) * FadeFinalFraction)
	if tail < 1 {
		tail = 1
	}
	final := meanInt(a.Watt[len(a.Watt)-tail:])
	dropPct := (avg - final) / avg * 100
	if dropPct < FadePct {
		return Finding{}, false
	}
	msg := fmt.Sprintf(
		"Leistungsabfall von %s%% im Schlussabschnitt (%dW Schnitt → %dW).",
		FormatDecimal(dropPct, 1), int(avg+0.5), int(final+0.5),
	)
	return Finding{
		DetectorID: "fade",
		Code:       CodeFade,
		Severity:   SeverityAttention,
		Category:   CategoryEfficiency,
		MessageDE:  msg,
		Evidence: a.withWindow(map[string]float64{
			"avg":   avg,
			"final": final,
			"pct":   dropPct,
		}),
	}, true
}
