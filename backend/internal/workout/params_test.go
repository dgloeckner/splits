package workout

import (
	"encoding/json"
	"testing"
)

func TestParamsRoundTrip(t *testing.T) {
	cases := []struct {
		name string
		mode Mode
		in   string
	}{
		{"just_row", ModeJustRow, `{}`},
		{"distance", ModeDistance, `{"meters":5000}`},
		{"time", ModeTime, `{"seconds":1800}`},
		{"intervals_meters", ModeIntervals, `{"reps":6,"length":{"unit":"m","value":500},"rest_sec":120}`},
		{"intervals_minutes", ModeIntervals, `{"reps":4,"length":{"unit":"min","value":4},"rest_sec":60}`},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			p, err := DecodeParams(tc.mode, json.RawMessage(tc.in))
			if err != nil {
				t.Fatalf("decode: %v", err)
			}
			out, err := p.Encode()
			if err != nil {
				t.Fatalf("encode: %v", err)
			}
			if string(out) == "" {
				t.Fatal("empty encoded params")
			}
		})
	}
}

func TestParamsValidation(t *testing.T) {
	cases := []struct {
		name    string
		mode    Mode
		in      string
		wantErr bool
	}{
		{"distance zero", ModeDistance, `{"meters":0}`, true},
		{"distance negative", ModeDistance, `{"meters":-100}`, true},
		{"time zero", ModeTime, `{"seconds":0}`, true},
		{"intervals zero reps", ModeIntervals, `{"reps":0,"length":{"unit":"m","value":500},"rest_sec":0}`, true},
		{"intervals zero length", ModeIntervals, `{"reps":6,"length":{"unit":"m","value":0},"rest_sec":0}`, true},
		{"intervals bad unit", ModeIntervals, `{"reps":6,"length":{"unit":"km","value":1},"rest_sec":0}`, true},
		{"intervals negative rest", ModeIntervals, `{"reps":6,"length":{"unit":"m","value":500},"rest_sec":-1}`, true},
		{"intervals rest zero ok", ModeIntervals, `{"reps":6,"length":{"unit":"m","value":500},"rest_sec":0}`, false},
		{"unknown mode", Mode("pyramid"), `{}`, true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, err := DecodeParams(tc.mode, json.RawMessage(tc.in))
			if (err != nil) != tc.wantErr {
				t.Fatalf("err=%v wantErr=%v", err, tc.wantErr)
			}
		})
	}
}
