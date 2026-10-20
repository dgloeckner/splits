package insights

import (
	"fmt"
	"math"

	"github.com/gloeckner-daniel/splits/internal/event"
)

// v1 thresholds of the efficiency drift detector (FEAT-0011
// §Effizienzdrift), chosen on the 11.06.2026 session and to be tuned
// with cmd/insights-sweep.
const (
	// DriftDPSPct is the DPS change (first → last quarter, percent) at
	// or below which stroke length counts as fallen.
	DriftDPSPct = -4.0
	// DriftSPMRise is the SPM rise (first → last quarter) at or above
	// which the rate counts as compensating.
	DriftSPMRise = 1.0
	// DriftMinBuckets is the smallest window the quarters are taken on.
	DriftMinBuckets = 8
)

// DriftMeasure is the first- vs last-quarter comparison over the
// analysis window that DetectDrift judges. Exported for
// cmd/insights-sweep, which prints it for every stored session.
type DriftMeasure struct {
	DPS1, DPS2, DPSPct   float64
	SPM1, SPM2           float64
	Split1, Split2       float64
	WindowFrom, WindowTo int
}

// Fires reports whether the measure crosses all three v1 thresholds.
func (m DriftMeasure) Fires() bool {
	return m.DPSPct <= DriftDPSPct && m.SPM2-m.SPM1 >= DriftSPMRise && m.Split2-m.Split1 <= PacingThresholdSec
}

// MeasureDrift compares the first and last quarter of the analysis
// window. ok is false when the window is shorter than DriftMinBuckets
// or the series are incomplete.
func MeasureDrift(s *event.SessionSamples) (m DriftMeasure, ok bool) {
	if s == nil {
		return m, false
	}
	a := analysedSamples(s)
	n := len(a.Split)
	if n < DriftMinBuckets || len(a.DPS) != n || len(a.SPM) != n {
		return m, false
	}
	q := n / 4
	m = DriftMeasure{
		DPS1: meanFloat(a.DPS[:q]), DPS2: meanFloat(a.DPS[n-q:]),
		SPM1: meanFloat(a.SPM[:q]), SPM2: meanFloat(a.SPM[n-q:]),
		Split1: meanInt(a.Split[:q]), Split2: meanInt(a.Split[n-q:]),
		WindowFrom: a.From, WindowTo: a.To,
	}
	if m.DPS1 <= 0 {
		return m, false
	}
	m.DPSPct = (m.DPS2 - m.DPS1) / m.DPS1 * 100
	return m, true
}

// DetectDrift flags "stroke gets shorter, rate goes up to hold pace":
// DPS falls, SPM rises and the split does not slow by more than the
// pacing threshold, comparing the first and last quarter of the
// analysis window. Run suppresses it when fade fired.
func DetectDrift(s *event.SessionSamples) (Finding, bool) {
	m, ok := MeasureDrift(s)
	if !ok || !m.Fires() {
		return Finding{}, false
	}
	msg := fmt.Sprintf(
		"Effizienzdrift: Schlaglänge von %s auf %s m gesunken, Schlagzahl von %s auf %s gestiegen.",
		FormatDecimal(m.DPS1, 2), FormatDecimal(m.DPS2, 2), FormatDecimal(m.SPM1, 1), FormatDecimal(m.SPM2, 1),
	)
	return Finding{
		DetectorID: "drift",
		Code:       CodeEfficiencyDrift,
		Severity:   SeverityNotable,
		Category:   CategoryEfficiency,
		MessageDE:  msg,
		Evidence: map[string]float64{
			"dps1":        m.DPS1,
			"dps2":        m.DPS2,
			"dps_pct":     m.DPSPct,
			"spm1":        m.SPM1,
			"spm2":        m.SPM2,
			"split1":      m.Split1,
			"split2":      m.Split2,
			"window_from": float64(m.WindowFrom),
			"window_to":   float64(m.WindowTo),
		},
	}, true
}

func meanFloat(xs []float64) float64 {
	if len(xs) == 0 {
		return math.NaN()
	}
	var sum float64
	for _, x := range xs {
		sum += x
	}
	return sum / float64(len(xs))
}
