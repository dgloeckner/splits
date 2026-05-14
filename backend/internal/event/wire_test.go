package event

import (
	"encoding/json"
	"testing"
	"time"
)

func TestMarshalStroke(t *testing.T) {
	e := Event{
		ID:        47,
		Kind:      KindStroke,
		SessionID: "01HV00000000000000000000A1",
		At:        time.Unix(0, 0),
		Stroke: &StrokePayload{
			StrokeNo: 47, TimeSec: 85.3, DistanceM: 342,
			SPM: 27, PowerW: 245, CalPerHr: 1175, Level: 3,
			DPS: 8.4, StrokeCycleSec: 2.22, PaceSecPer500m: 132, EnergyJoules: 544,
		},
	}
	got, err := Marshal(e)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	var got2 map[string]any
	if err := json.Unmarshal(got, &got2); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	want := map[string]any{
		"session_id":         "01HV00000000000000000000A1",
		"stroke":             float64(47),
		"time_sec":           85.3,
		"distance_m":         float64(342),
		"spm":                float64(27),
		"power_w":            float64(245),
		"cal_per_hr":         float64(1175),
		"level":              float64(3),
		"dps":                8.4,
		"stroke_cycle_sec":   2.22,
		"pace_sec_per_500m":  float64(132),
		"energy_joules":      float64(544),
	}
	for k, v := range want {
		if got2[k] != v {
			t.Errorf("%s: got %v, want %v", k, got2[k], v)
		}
	}
}

func TestMarshalSessionStart(t *testing.T) {
	base := Event{
		ID:        1,
		Kind:      KindSessionStart,
		SessionID: "01HV00000000000000000000A1",
		At:        time.Unix(0, 0),
		SessionStart: &SessionStartPayload{
			StartedAt:    time.Unix(0, 0),
			RowerID:      "R1",
			RowerName:    "Alice",
			InitialLevel: 3,
		},
	}

	t.Run("workout_id omitted when empty", func(t *testing.T) {
		got, err := Marshal(base)
		if err != nil {
			t.Fatalf("marshal: %v", err)
		}
		var m map[string]any
		if err := json.Unmarshal(got, &m); err != nil {
			t.Fatalf("unmarshal: %v", err)
		}
		if _, present := m["workout_id"]; present {
			t.Errorf("expected workout_id to be omitted, but it was present in JSON")
		}
	})

	t.Run("workout_id present when set", func(t *testing.T) {
		e := base
		sp := *base.SessionStart
		sp.WorkoutID = "W1"
		e.SessionStart = &sp
		got, err := Marshal(e)
		if err != nil {
			t.Fatalf("marshal: %v", err)
		}
		var m map[string]any
		if err := json.Unmarshal(got, &m); err != nil {
			t.Fatalf("unmarshal: %v", err)
		}
		if m["workout_id"] != "W1" {
			t.Errorf("workout_id: got %v, want %q", m["workout_id"], "W1")
		}
	})
}

func TestEventNameMatrix(t *testing.T) {
	cases := []struct {
		kind Kind
		want string
	}{
		{KindStroke, "stroke"},
		{KindSessionStart, "session_start"},
		{KindSessionEnd, "session_end"},
		{KindLevelChange, "level_change"},
		{KindSessionFinalized, "session_finalized"},
	}
	for _, tc := range cases {
		if got := EventName(tc.kind); got != tc.want {
			t.Errorf("EventName(%d) = %q, want %q", tc.kind, got, tc.want)
		}
	}
}
