package api

import (
	"encoding/json"
	"testing"
	"time"
)

func TestIsCompletedSession(t *testing.T) {
	cases := []struct {
		name      string
		mode      string
		params    string
		distM     int
		timeSec   float64
		want      bool
	}{
		{"distance 5k completed", "distance", `{"meters":5000}`, 5004, 1138, true},
		{"distance 5k abandoned at 80%", "distance", `{"meters":5000}`, 4000, 900, true},
		{"distance 5k abandoned below 80%", "distance", `{"meters":5000}`, 3999, 800, false},
		{"distance 500m abandoned at 134m", "distance", `{"meters":500}`, 134, 36, false},
		{"race 2k completed", "race", `{"meters":2000}`, 2010, 420, true},
		{"race 500m completed", "race", `{"meters":500}`, 603, 163, true},
		{"time 20min completed", "time", `{"sec":1200}`, 5500, 1200, true},
		{"time 20min completed at 80%", "time", `{"sec":1200}`, 4000, 960, true},
		{"time 20min abandoned", "time", `{"sec":1200}`, 2000, 500, false},
		{"intervals never qualifies (deferred)", "intervals", `{"reps":4,"length":{"unit":"m","value":500},"rest_sec":60}`, 2200, 600, false},
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

func TestAssembleSeriesGroupsByModeAndHash(t *testing.T) {
	t0 := time.Date(2026, 5, 9, 8, 35, 0, 0, time.UTC)
	rows := []sessionRow{
		// 4× distance 5k — one shape
		{ID: "a", StartedAt: t0,                          Mode: "distance", Params: json.RawMessage(`{"meters":5000}`), ShapeHash: "H_DIST_5K", DistM: 5004, TimeSec: 1138, AvgPower: 374, AvgPace: 110, AvgDPS: 9.69, AvgSPI: 12, AvgSPM: 28.0},
		{ID: "b", StartedAt: t0.Add(6 * 24 * time.Hour),  Mode: "distance", Params: json.RawMessage(`{"meters":5000}`), ShapeHash: "H_DIST_5K", DistM: 5005, TimeSec: 1122, AvgPower: 375, AvgPace: 109, AvgDPS: 9.62, AvgSPI: 12, AvgSPM: 28.4},
		{ID: "c", StartedAt: t0.Add(8 * 24 * time.Hour),  Mode: "distance", Params: json.RawMessage(`{"meters":5000}`), ShapeHash: "H_DIST_5K", DistM: 5029, TimeSec: 1102, AvgPower: 379, AvgPace: 107, AvgDPS: 9.53, AvgSPI: 12, AvgSPM: 28.9},
		{ID: "d", StartedAt: t0.Add(14 * 24 * time.Hour), Mode: "distance", Params: json.RawMessage(`{"meters":5000}`), ShapeHash: "H_DIST_5K", DistM: 5008, TimeSec: 1082, AvgPower: 382, AvgPace: 107, AvgDPS: 9.59, AvgSPI: 12, AvgSPM: 28.7},
		// 1× race 2k — same hash as distance 2k, but separate series
		{ID: "e", StartedAt: t0.Add(4 * 24 * time.Hour), Mode: "race", Params: json.RawMessage(`{"meters":2000}`), ShapeHash: "H_DIST_2K", DistM: 2010, TimeSec: 420, AvgPower: 410, AvgPace: 105, AvgDPS: 9.0, AvgSPI: 13, AvgSPM: 32.0},
		// 1× distance 2k — same hash as race 2k, different mode → different series
		{ID: "f", StartedAt: t0.Add(5 * 24 * time.Hour), Mode: "distance", Params: json.RawMessage(`{"meters":2000}`), ShapeHash: "H_DIST_2K", DistM: 2020, TimeSec: 440, AvgPower: 390, AvgPace: 109, AvgDPS: 9.2, AvgSPI: 12, AvgSPM: 30.0},
		// 1× just_row — never appears
		{ID: "h", StartedAt: t0.Add(16 * 24 * time.Hour), Mode: "just_row", Params: json.RawMessage(`{}`), ShapeHash: "H_JUSTROW", DistM: 3000, TimeSec: 700, AvgPower: 200, AvgPace: 120, AvgDPS: 9.0, AvgSPI: 10, AvgSPM: 24.0},
	}
	series := assembleSeries(rows)

	if len(series) != 3 {
		t.Fatalf("got %d series, want 3 (distance 5k, race 2k, distance 2k); got keys %v", len(series), keysOf(series))
	}
	bySid := indexByKey(series)

	dist5k := bySid["distance|H_DIST_5K"]
	if dist5k == nil {
		t.Fatal("missing distance|H_DIST_5K series")
	}
	if len(dist5k.Points) != 4 {
		t.Fatalf("distance 5k: got %d points, want 4", len(dist5k.Points))
	}
	// Series should be most-rowed first.
	if series[0].Key.Mode != "distance" || series[0].Key.ShapeHash != "H_DIST_5K" {
		t.Fatalf("expected distance|H_DIST_5K to be first series (most rowed), got %s|%s",
			series[0].Key.Mode, series[0].Key.ShapeHash)
	}
	if dist5k.DisplayName != "5 k" {
		t.Fatalf("distance 5k display_name = %q, want \"5 k\"", dist5k.DisplayName)
	}

	race2k := bySid["race|H_DIST_2K"]
	if race2k == nil {
		t.Fatal("missing race|H_DIST_2K series")
	}
	if len(race2k.Points) != 1 {
		t.Fatalf("race 2k: got %d points, want 1", len(race2k.Points))
	}
	if race2k.DisplayName != "Race 2 k" {
		t.Fatalf("race 2k display_name = %q, want \"Race 2 k\"", race2k.DisplayName)
	}

	dist2k := bySid["distance|H_DIST_2K"]
	if dist2k == nil {
		t.Fatal("missing distance|H_DIST_2K series")
	}
	if len(dist2k.Points) != 1 {
		t.Fatalf("distance 2k: got %d points, want 1", len(dist2k.Points))
	}
	if dist2k.DisplayName != "2 k" {
		t.Fatalf("distance 2k display_name = %q, want \"2 k\"", dist2k.DisplayName)
	}
}

func keysOf(s []trendsSeries) []string {
	out := make([]string, len(s))
	for i, sr := range s {
		out[i] = sr.Key.Mode + "|" + sr.Key.ShapeHash
	}
	return out
}

func indexByKey(s []trendsSeries) map[string]*trendsSeries {
	out := make(map[string]*trendsSeries, len(s))
	for i := range s {
		k := s[i].Key.Mode + "|" + s[i].Key.ShapeHash
		out[k] = &s[i]
	}
	return out
}
