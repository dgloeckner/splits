package api

import (
	"encoding/json"
	"testing"
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
