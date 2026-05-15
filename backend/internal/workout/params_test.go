package workout

import (
	"encoding/json"
	"errors"
	"fmt"
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

func TestModeRaceValid(t *testing.T) {
	if !ModeRace.Valid() {
		t.Fatal("ModeRace should be valid")
	}
}

func TestDecodeRaceParamsAcceptsStandardDistances(t *testing.T) {
	for _, m := range []int{500, 1000, 2000, 5000, 6000, 10000} {
		raw := json.RawMessage(fmt.Sprintf(`{"meters":%d}`, m))
		p, err := DecodeParams(ModeRace, raw)
		if err != nil {
			t.Fatalf("meters=%d: %v", m, err)
		}
		if p.Race == nil || p.Race.Meters != m {
			t.Fatalf("meters=%d: got %+v", m, p.Race)
		}
	}
}

func TestDecodeRaceParamsRejectsNonStandard(t *testing.T) {
	cases := []int{0, -1, 100, 750, 1500, 3000}
	for _, m := range cases {
		raw := json.RawMessage(fmt.Sprintf(`{"meters":%d}`, m))
		if _, err := DecodeParams(ModeRace, raw); !errors.Is(err, ErrInvalidParams) {
			t.Fatalf("meters=%d: expected ErrInvalidParams, got %v", m, err)
		}
	}
}

func TestEncodeRaceParamsRoundTrip(t *testing.T) {
	p := &Params{Mode: ModeRace, Race: &RaceParams{Meters: 2000}}
	raw, err := p.Encode()
	if err != nil {
		t.Fatal(err)
	}
	if string(raw) != `{"meters":2000}` {
		t.Fatalf("encode = %s", string(raw))
	}
}
