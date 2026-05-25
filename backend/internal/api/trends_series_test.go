package api

import (
	"encoding/json"
	"testing"
	"time"
)

func TestIsCompletedSession(t *testing.T) {
	cases := []struct {
		name    string
		mode    string
		params  string
		distM   int
		timeSec float64
		want    bool
	}{
		{"distance 5k completed", "distance", `{"meters":5000}`, 5004, 1138, true},
		{"distance 5k at 80%", "distance", `{"meters":5000}`, 4000, 900, true},
		{"distance 5k below 80%", "distance", `{"meters":5000}`, 3999, 800, false},
		{"distance 500m abandoned at 134m", "distance", `{"meters":500}`, 134, 36, false},
		{"race 2k completed", "race", `{"meters":2000}`, 2010, 420, true},
		{"race 500m completed", "race", `{"meters":500}`, 603, 163, true},
		// REAL production time-mode params shape is "seconds", not "sec".
		// A regression here would silently drop every time-mode workout.
		{"time 20min completed", "time", `{"seconds":1200}`, 5500, 1200, true},
		{"time 20min at 80%", "time", `{"seconds":1200}`, 4000, 960, true},
		{"time 20min abandoned", "time", `{"seconds":1200}`, 2000, 500, false},
		// Defensive: the broken {"sec":N} shape that the old code accidentally
		// expected must NOT be silently accepted. With DecodeParams this fails
		// validation (seconds==0) and the session is treated as not-completed.
		{"time with wrong key", "time", `{"sec":1200}`, 5500, 1200, false},
		{"intervals never qualifies", "intervals", `{"reps":4,"length":{"unit":"m","value":500},"rest_sec":60}`, 2200, 600, false},
		{"just_row never qualifies", "just_row", `{}`, 5000, 1100, false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got := isCompletedSession(c.mode, json.RawMessage(c.params), c.distM, c.timeSec)
			if got != c.want {
				t.Fatalf("isCompletedSession(%q, %q, %d, %v) = %v, want %v",
					c.mode, c.params, c.distM, c.timeSec, got, c.want)
			}
		})
	}
}

func TestAssembleSeriesGroupsByShapeHash(t *testing.T) {
	t0 := time.Date(2026, 5, 9, 8, 35, 0, 0, time.UTC)
	rows := []sessionRow{
		// 4× distance 5k — all share hash H_5K (mode-agnostic, warmup-agnostic).
		{ID: "a", StartedAt: t0,                          Mode: "distance", Params: json.RawMessage(`{"meters":5000}`), ShapeHash: "H_5K", DistM: 5004, TimeSec: 1138, AvgPower: 374, AvgPace: 110, AvgDPS: 9.69, AvgSPI: 12, AvgSPM: 28.0},
		{ID: "b", StartedAt: t0.Add(6 * 24 * time.Hour),  Mode: "distance", Params: json.RawMessage(`{"meters":5000}`), ShapeHash: "H_5K", DistM: 5005, TimeSec: 1122, AvgPower: 375, AvgPace: 109, AvgDPS: 9.62, AvgSPI: 12, AvgSPM: 28.4},
		{ID: "c", StartedAt: t0.Add(8 * 24 * time.Hour),  Mode: "distance", Params: json.RawMessage(`{"meters":5000}`), ShapeHash: "H_5K", DistM: 5029, TimeSec: 1102, AvgPower: 379, AvgPace: 107, AvgDPS: 9.53, AvgSPI: 12, AvgSPM: 28.9},
		{ID: "d", StartedAt: t0.Add(14 * 24 * time.Hour), Mode: "distance", Params: json.RawMessage(`{"meters":5000}`), ShapeHash: "H_5K", DistM: 5008, TimeSec: 1082, AvgPower: 382, AvgPace: 107, AvgDPS: 9.59, AvgSPI: 12, AvgSPM: 28.7},
		// 1× race 2k + 1× distance 2k — share hash H_2K, collapse to ONE series with 2 points.
		{ID: "e", StartedAt: t0.Add(4 * 24 * time.Hour), Mode: "race",     Params: json.RawMessage(`{"meters":2000}`), ShapeHash: "H_2K", DistM: 2010, TimeSec: 420, AvgPower: 410, AvgPace: 105, AvgDPS: 9.0, AvgSPI: 13, AvgSPM: 32.0},
		{ID: "f", StartedAt: t0.Add(5 * 24 * time.Hour), Mode: "distance", Params: json.RawMessage(`{"meters":2000}`), ShapeHash: "H_2K", DistM: 2020, TimeSec: 440, AvgPower: 390, AvgPace: 109, AvgDPS: 9.2, AvgSPI: 12, AvgSPM: 30.0},
		// 1× just_row — excluded.
		{ID: "h", StartedAt: t0.Add(16 * 24 * time.Hour), Mode: "just_row", Params: json.RawMessage(`{}`),             ShapeHash: "H_JR", DistM: 3000, TimeSec: 700, AvgPower: 200, AvgPace: 120, AvgDPS: 9.0, AvgSPI: 10, AvgSPM: 24.0},
	}
	series := assembleSeries(rows)

	if len(series) != 2 {
		t.Fatalf("got %d series, want 2 (5k + 2k); got hashes %v", len(series), hashesOf(series))
	}
	if series[0].Key.ShapeHash != "H_5K" || len(series[0].Points) != 4 {
		t.Fatalf("first series should be H_5K with 4 points, got %s with %d", series[0].Key.ShapeHash, len(series[0].Points))
	}
	if series[1].Key.ShapeHash != "H_2K" || len(series[1].Points) != 2 {
		t.Fatalf("second series should be H_2K with 2 points (race + distance collapsed), got %s with %d", series[1].Key.ShapeHash, len(series[1].Points))
	}
}

func hashesOf(s []trendsSeries) []string {
	out := make([]string, len(s))
	for i, sr := range s {
		out[i] = sr.Key.ShapeHash
	}
	return out
}
