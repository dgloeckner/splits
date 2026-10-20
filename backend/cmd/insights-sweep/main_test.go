package main

import (
	"bytes"
	"strings"
	"testing"

	"github.com/gloeckner-daniel/splits/internal/insights"
)

func TestReport(t *testing.T) {
	rows := []row{
		{ID: "a", StartedAt: "2026-06-11T21:27:00Z", Mode: "distance",
			M: insights.DriftMeasure{DPS1: 9.97, DPS2: 9.47, DPSPct: -5.0, SPM1: 27.5, SPM2: 29.6, Split1: 107.7, Split2: 105.6}},
		{ID: "b", StartedAt: "2026-06-12T18:00:00Z", Mode: "just_row",
			M: insights.DriftMeasure{DPS1: 9.5, DPS2: 9.4, DPSPct: -1.1, SPM1: 28, SPM2: 28.2, Split1: 110, Split2: 110}},
		{ID: "c", StartedAt: "2026-06-13T18:00:00Z", Mode: "time", Fade: true,
			M: insights.DriftMeasure{DPS1: 10, DPS2: 9.4, DPSPct: -6, SPM1: 27, SPM2: 29, Split1: 108, Split2: 108}},
	}
	var b bytes.Buffer
	report(&b, rows, 4)
	out := b.String()
	if !strings.Contains(out, "3 sessions measured, 4 skipped") || !strings.Contains(out, "1 fire") {
		t.Errorf("summary missing:\n%s", out)
	}
	if !strings.Contains(out, "dps_pct      min -6.0") {
		t.Errorf("distribution missing:\n%s", out)
	}
}
