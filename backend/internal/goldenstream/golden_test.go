package goldenstream

import (
	"bytes"
	"encoding/json"
	"flag"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/gloeckner-daniel/splits/internal/event"
	"github.com/gloeckner-daniel/splits/internal/session"
	"github.com/gloeckner-daniel/splits/internal/workout"
)

var update = flag.Bool("update", false, "rewrite golden JSONL files")

const fixtureDir = "../../../specs/int/fixtures/ipm"
const goldenDir = "../../../specs/int/fixtures/golden"

// expectedWorkDistance is for free-row subtests only.
// Values are lastCSVDistanceM − firstCSVDistanceM — derived from the
// CSV directly, NOT copied from harness output.
var expectedWorkDistance = map[string]int{
	"session-m1":    155, // 163 − 8; hand-verified from CSV
	"session-short": 172, // 197 − 25; hand-verified from CSV
}

func harnessOpts() session.Options {
	return session.Options{
		IdleTimeout:  60 * time.Second,
		PauseTimeout: 10 * time.Second,
		ResumeWindow: 15 * time.Minute,
		RowerID:      "golden-rower",
		RowerName:    "Golden",
	}
}

func longHarnessOpts() session.Options {
	return session.Options{
		IdleTimeout:  10 * time.Minute,
		PauseTimeout: 0, // no pause detection for long sessions
		RowerID:      "golden-rower",
		RowerName:    "Golden",
	}
}

func marshalLines(evs []timedEvent) []byte {
	var buf bytes.Buffer
	enc := json.NewEncoder(&buf)
	for _, e := range evs {
		_ = enc.Encode(e)
	}
	return buf.Bytes()
}

func runAndAssertGolden(t *testing.T, name string, evs []timedEvent) {
	t.Helper()
	got := marshalLines(evs)
	goldenPath := filepath.Join(goldenDir, name+".jsonl")
	if *update {
		if err := os.MkdirAll(goldenDir, 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(goldenPath, got, 0o644); err != nil {
			t.Fatal(err)
		}
		return
	}
	want, err := os.ReadFile(goldenPath)
	if err != nil {
		t.Fatalf("golden missing (run with -update): %v", err)
	}
	if !bytes.Equal(got, want) {
		t.Errorf("golden mismatch for %s — if intentional, run `go test ./internal/goldenstream -update` and review the diff", name)
	}
	_ = event.EventName // keep import alive
}

func TestGoldenFixtures(t *testing.T) {
	// Free-row subtests
	for _, name := range []string{"session-m1", "session-short"} {
		name := name
		t.Run(name, func(t *testing.T) {
			frames, err := loadFixtureFrames(filepath.Join(fixtureDir, name+".csv"))
			if err != nil {
				t.Fatal(err)
			}
			evs, err := run(frames, harnessOpts(), "")
			if err != nil {
				t.Fatal(err)
			}

			// Invariant: summary total_distance_m == last stroke distance_m
			var lastStrokeDist int
			var summaryDist = -1
			for _, e := range evs {
				switch e.Event {
				case "stroke":
					var p struct {
						DistanceM int `json:"distance_m"`
					}
					_ = json.Unmarshal(e.Data, &p)
					lastStrokeDist = p.DistanceM
				case "session_end":
					var p struct {
						Summary struct {
							TotalDistanceM int `json:"total_distance_m"`
						} `json:"summary"`
					}
					_ = json.Unmarshal(e.Data, &p)
					summaryDist = p.Summary.TotalDistanceM
				}
			}
			if summaryDist != lastStrokeDist {
				t.Errorf("summary %d != last stroke %d", summaryDist, lastStrokeDist)
			}
			if want := expectedWorkDistance[name]; summaryDist != want {
				t.Errorf("summary distance %d != hand-derived %d", summaryDist, want)
			}

			runAndAssertGolden(t, name, evs)
		})
	}

	// Workout golden subtest
	t.Run("session-m3-long-w700", func(t *testing.T) {
		frames, err := loadFixtureFrames(filepath.Join(fixtureDir, "session-m3-long.csv"))
		if err != nil {
			t.Fatal(err)
		}
		opts := longHarnessOpts()
		opts.LoadWorkout = func(id string) (*workout.Workout, error) {
			return &workout.Workout{
				ID:          id,
				Mode:        workout.ModeDistance,
				ParamsJSON:  []byte(`{"meters":700}`),
				WarmupSec:   60,
				CooldownSec: 30,
			}, nil
		}
		evs, err := run(frames, opts, "golden-w1")
		if err != nil {
			t.Fatal(err)
		}

		// Structural assertions: must have phase transitions
		var phaseChanges []struct{ From, To string }
		var summaryDist = -1
		for _, e := range evs {
			switch e.Event {
			case "phase_change":
				var raw map[string]string
				_ = json.Unmarshal(e.Data, &raw)
				phaseChanges = append(phaseChanges, struct{ From, To string }{raw["from"], raw["to"]})
			case "session_end":
				var p struct {
					Summary struct {
						TotalDistanceM int `json:"total_distance_m"`
					} `json:"summary"`
				}
				_ = json.Unmarshal(e.Data, &p)
				summaryDist = p.Summary.TotalDistanceM
			}
		}

		// Must have warmup→work and work→cooldown transitions
		var hasWarmupToWork, hasWorkToCooldown bool
		for _, pc := range phaseChanges {
			if pc.From == "warmup" && pc.To == "work" {
				hasWarmupToWork = true
			}
			if pc.From == "work" && pc.To == "cooldown" {
				hasWorkToCooldown = true
			}
		}
		if !hasWarmupToWork {
			t.Error("expected warmup→work phase_change not found")
		}
		if !hasWorkToCooldown {
			t.Error("expected work→cooldown phase_change not found")
		}

		// Work distance should be close to 700m (the workout goal)
		if summaryDist < 650 || summaryDist > 750 {
			t.Errorf("workout total_distance_m = %d, want ~700", summaryDist)
		}

		runAndAssertGolden(t, "session-m3-long-w700", evs)
	})

	t.Run("session-synth-pause", func(t *testing.T) {
		opts := session.Options{
			PauseTimeout: 10 * time.Second,
			ResumeWindow: 15 * time.Minute,
			IdleTimeout:  15 * time.Minute,
			RowerID:      "golden-rower",
			RowerName:    "Golden",
		}
		evs, err := run(synthPauseFrames(), opts, "")
		if err != nil {
			t.Fatal(err)
		}

		// Exact assertions (derived analytically, not from harness output):
		// Stroke 1 (10m, devT 2s) = storage anchor → rebased to 0m / 0s work-time.
		// Stroke 20 = 190m / 38s work-clock (strokes 1..20, 10m each after rebase).
		// 45 idle broadcasts swallowed (policy a); pause arises at +10s.
		// Resume stroke lands at work-second 38 (stop-the-clock).
		// Stroke 40 = 390m / 76s work-clock.
		var pauseCount, resumeCount int
		var sessionEndCount int
		var finalDistM int
		var finalTimeSec float64
		for _, e := range evs {
			switch e.Event {
			case "session_paused":
				pauseCount++
			case "session_resumed":
				resumeCount++
			case "session_end":
				sessionEndCount++
				var p struct {
					Summary struct {
						TotalDistanceM int     `json:"total_distance_m"`
						TotalTimeSec   float64 `json:"total_time_sec"`
					} `json:"summary"`
				}
				_ = json.Unmarshal(e.Data, &p)
				finalDistM = p.Summary.TotalDistanceM
				finalTimeSec = p.Summary.TotalTimeSec
			}
		}
		if pauseCount != 1 {
			t.Errorf("want 1 session_paused, got %d", pauseCount)
		}
		if resumeCount != 1 {
			t.Errorf("want 1 session_resumed, got %d", resumeCount)
		}
		if sessionEndCount != 1 {
			t.Errorf("want exactly 1 session_end, got %d", sessionEndCount)
		}
		if finalDistM != 390 {
			t.Errorf("total_distance_m: want 390, got %d", finalDistM)
		}
		if finalTimeSec < 74 || finalTimeSec > 78 {
			t.Errorf("total_time_sec: want ~76, got %f", finalTimeSec)
		}

		runAndAssertGolden(t, "session-synth-pause", evs)
	})
}
