package insights

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/gloeckner-daniel/splits/internal/event"
)

// loadSamplesFixture reads a session-samples fixture from testdata/
// (see testdata/README.md).
func loadSamplesFixture(t *testing.T, name string) (mode string, s *event.SessionSamples) {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join("testdata", name))
	if err != nil {
		t.Fatal(err)
	}
	var fx struct {
		Workout struct {
			Mode string `json:"mode"`
		} `json:"workout"`
		Samples *event.SessionSamples `json:"samples"`
	}
	if err := json.Unmarshal(raw, &fx); err != nil {
		t.Fatalf("%s: %v", name, err)
	}
	return fx.Workout.Mode, fx.Samples
}

const fixture5000m = "2026-06-11-5000m.json"

// TestFixture5000mWindow pins the #36 regression on the 11.06.2026
// 5000 m session: with the analysis window, consistency no longer
// reads "ungleichmäßig" and nothing contradicts the even pacing.
func TestFixture5000mWindow(t *testing.T) {
	mode, s := loadSamplesFixture(t, fixture5000m)
	if s.Window == nil || *s.Window != (event.SamplesWindow{From: 1, To: 105}) {
		t.Fatalf("fixture window = %+v, want [1, 105)", s.Window)
	}
	res := Run(SessionMeta{WorkoutMode: mode, DurationSec: s.T[len(s.T)-1], DistanceM: 5006}, s)
	byID := map[string]Finding{}
	for _, f := range res.Findings {
		byID[f.DetectorID] = f
	}

	c, ok := byID["consistency"]
	if !ok {
		t.Fatal("no consistency finding")
	}
	if c.Code == CodeInconsistent || c.Evidence["cv"] >= CVMid {
		t.Errorf("consistency = %s (cv %.2f), want gleichmäßig or better", c.Code, c.Evidence["cv"])
	}
	if c.Evidence["window_from"] != 1 || c.Evidence["window_to"] != 105 {
		t.Errorf("consistency window = [%v, %v), want [1, 105)", c.Evidence["window_from"], c.Evidence["window_to"])
	}
	if p := byID["pacing"]; p.Code != CodeEvenSplit {
		t.Errorf("pacing = %s, want EVEN_SPLIT", p.Code)
	}
	if f, ok := byID["fade"]; ok {
		t.Errorf("unexpected fade: %s", f.MessageDE)
	}
}

// TestFixture5000mWithoutWindow documents the bug the window fixes:
// over the full series the start bucket alone pushes the CV past 5 %.
func TestFixture5000mWithoutWindow(t *testing.T) {
	_, s := loadSamplesFixture(t, fixture5000m)
	s.Window = nil
	c, ok := DetectConsistency(s)
	if !ok {
		t.Fatal("no consistency finding")
	}
	if c.Code != CodeInconsistent {
		t.Errorf("full-series consistency = %s (cv %.2f), want INCONSISTENT", c.Code, c.Evidence["cv"])
	}
}
