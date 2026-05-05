package insights_test

import (
	"encoding/csv"
	"os"
	"path/filepath"
	"strconv"
	"testing"

	"github.com/gloeckner-daniel/splits/internal/event"
	"github.com/gloeckner-daniel/splits/internal/insights"
	"github.com/gloeckner-daniel/splits/internal/stats"
)

// loadFixtureStrokes reads a CSV fixture from specs/int/fixtures/ipm/
// and synthesises StrokePayload entries with derived pace and DPS,
// matching the fields ComputeSamples consumes. PaceSecPer500m is
// computed from the delta between consecutive rows to reflect
// instantaneous boat speed.
func loadFixtureStrokes(t *testing.T, name string) []event.StrokePayload {
	t.Helper()
	path := filepath.Join("..", "..", "..", "specs", "int", "fixtures", "ipm", name)
	f, err := os.Open(path)
	if err != nil {
		t.Fatalf("open %s: %v", path, err)
	}
	defer f.Close()
	r := csv.NewReader(f)
	rows, err := r.ReadAll()
	if err != nil {
		t.Fatalf("read %s: %v", path, err)
	}
	if len(rows) < 2 {
		t.Fatalf("fixture %s has no data rows", name)
	}

	var out []event.StrokePayload
	var prevT float64
	var prevD int
	for i, row := range rows[1:] {
		timeSec, _ := strconv.ParseFloat(row[1], 64)
		distM, _ := strconv.Atoi(row[2])
		spm, _ := strconv.Atoi(row[3])
		power, _ := strconv.Atoi(row[4])

		var pace int
		if i == 0 {
			if distM > 0 {
				pace = int(timeSec / float64(distM) * 500)
			}
		} else if distM > prevD {
			pace = int((timeSec - prevT) / float64(distM-prevD) * 500)
		}
		var dps float64
		if spm > 0 {
			dps = float64(distM) / (timeSec / 60.0) / float64(spm)
		}
		out = append(out, event.StrokePayload{
			StrokeNo:       i + 1,
			TimeSec:        timeSec,
			DistanceM:      distM,
			SPM:            spm,
			PowerW:         power,
			PaceSecPer500m: pace,
			DPS:            dps,
			Phase:          "work",
		})
		prevT, prevD = timeSec, distM
	}
	return out
}

// TestIntegrationLongFixtureProducesFindings drives the full
// fixture → ComputeSamples → insights.Run path with the m3-long
// fixture (1035m, 284s, 124 work strokes). Eligibility is bypassed
// by passing an explicitly-eligible SessionMeta, since the fixture
// is just below the 5min/1km gate. Asserts the detector pipeline
// produces a finding for each detector and a non-empty synthesis.
func TestIntegrationLongFixtureProducesFindings(t *testing.T) {
	strokes := loadFixtureStrokes(t, "session-m3-long.csv")
	if len(strokes) < 50 {
		t.Fatalf("expected ≥50 strokes, got %d", len(strokes))
	}

	samples := stats.ComputeSamples(strokes, stats.DefaultBucketStrokes)
	if samples == nil || len(samples.Split) < 5 {
		t.Fatalf("expected ≥5 sample buckets, got %d", len(samples.Split))
	}

	res := insights.Run(insights.SessionMeta{
		WorkoutMode: "distance",
		DurationSec: 600,
		DistanceM:   2000,
	}, samples)

	if !res.Eligible {
		t.Fatalf("expected eligible (override), got reason=%q", res.Reason)
	}
	if len(res.Findings) == 0 {
		t.Fatalf("expected at least one finding from real fixture data")
	}
	if res.SynthesisDE == "" {
		t.Errorf("expected non-empty synthesis paragraph")
	}

	gotDetectors := map[string]insights.Finding{}
	for _, f := range res.Findings {
		gotDetectors[f.DetectorID] = f
	}
	for _, want := range []string{"pacing", "consistency"} {
		if _, ok := gotDetectors[want]; !ok {
			t.Errorf("missing finding from detector %q (got %v)", want, keys(gotDetectors))
		}
	}

	for _, f := range res.Findings {
		if f.MessageDE == "" {
			t.Errorf("detector %q produced empty MessageDE", f.DetectorID)
		}
		if f.Code == "" {
			t.Errorf("detector %q produced empty Code", f.DetectorID)
		}
	}

	t.Logf("m3-long synthesis: %s", res.SynthesisDE)
	for _, f := range res.Findings {
		t.Logf("  finding [%s/%s]: %s (evidence=%v)", f.Severity, f.Code, f.MessageDE, f.Evidence)
	}
}

// TestIntegrationFixtureEligibilityGate verifies that a fixture
// shorter than the 5min/1km thresholds is correctly rejected by the
// eligibility gate even though detector input would otherwise be
// well-formed. Uses session-short.csv.
func TestIntegrationFixtureEligibilityGate(t *testing.T) {
	strokes := loadFixtureStrokes(t, "session-short.csv")
	samples := stats.ComputeSamples(strokes, stats.DefaultBucketStrokes)

	last := strokes[len(strokes)-1]
	res := insights.Run(insights.SessionMeta{
		WorkoutMode: "distance",
		DurationSec: last.TimeSec,
		DistanceM:   last.DistanceM,
	}, samples)

	if res.Eligible {
		t.Fatalf("expected ineligible (fixture is short), got eligible")
	}
	if res.Reason != insights.ReasonTooShort {
		t.Errorf("reason = %q, want %q", res.Reason, insights.ReasonTooShort)
	}
	if len(res.Findings) != 0 {
		t.Errorf("expected zero findings on ineligible session, got %d", len(res.Findings))
	}
}

// TestIntegrationFixtureIntervalsSkipped verifies the workout-mode
// gate: even a long, otherwise-eligible session is skipped when
// workout.mode == "intervals".
func TestIntegrationFixtureIntervalsSkipped(t *testing.T) {
	strokes := loadFixtureStrokes(t, "session-m3-long.csv")
	samples := stats.ComputeSamples(strokes, stats.DefaultBucketStrokes)

	res := insights.Run(insights.SessionMeta{
		WorkoutMode: "intervals",
		DurationSec: 600,
		DistanceM:   2000,
	}, samples)

	if res.Eligible {
		t.Fatalf("expected intervals to skip detection")
	}
	if res.Reason != insights.ReasonIntervals {
		t.Errorf("reason = %q, want %q", res.Reason, insights.ReasonIntervals)
	}
}

func keys(m map[string]insights.Finding) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	return out
}
