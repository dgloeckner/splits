package rower

import (
	"errors"
	"strings"
	"testing"
)

func ptrStr(v string) *string { return &v }

func TestValidateCreate_Bounds(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name string
		in   CreateInput
		want error
	}{
		{"empty name", CreateInput{}, ErrNameRequired},
		{"name too long", CreateInput{Name: strings.Repeat("ä", 81)}, ErrNameTooLong},
		{"weight too low", CreateInput{Name: "A", WeightKg: ptrFloat(10)}, ErrWeightRange},
		{"weight too high", CreateInput{Name: "A", WeightKg: ptrFloat(400)}, ErrWeightRange},
		{"height too low", CreateInput{Name: "A", HeightCm: ptrFloat(50)}, ErrHeightRange},
		{"height too high", CreateInput{Name: "A", HeightCm: ptrFloat(300)}, ErrHeightRange},
		{"dob malformed", CreateInput{Name: "A", DOB: ptrStr("2026/05/01")}, ErrDOBInvalid},
		{"dob ancient", CreateInput{Name: "A", DOB: ptrStr("1850-01-01")}, ErrDOBInvalid},
		{"dob future", CreateInput{Name: "A", DOB: ptrStr("2999-01-01")}, ErrDOBInvalid},
		{"ok minimal", CreateInput{Name: "A"}, nil},
		{"ok full", CreateInput{
			Name: "Daniel", WeightKg: ptrFloat(75), HeightCm: ptrFloat(180),
			DOB: ptrStr("1980-04-12"),
		}, nil},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			err := validateCreate(tc.in)
			if !errors.Is(err, tc.want) {
				t.Fatalf("got %v, want %v", err, tc.want)
			}
		})
	}
}

func TestValidateUpdate_Bounds(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name string
		in   UpdateInput
		want error
	}{
		{"name empty rejected", UpdateInput{Name: ptrStr("")}, ErrNameRequired},
		{"name too long", UpdateInput{Name: ptrStr(strings.Repeat("a", 81))}, ErrNameTooLong},
		{"weight bad", UpdateInput{WeightKg: ptrFloat(0)}, ErrWeightRange},
		{"height bad", UpdateInput{HeightCm: ptrFloat(0)}, ErrHeightRange},
		{"dob bad", UpdateInput{DOB: ptrStr("not-a-date")}, ErrDOBInvalid},
		{"empty input ok", UpdateInput{}, nil},
		{"name only ok", UpdateInput{Name: ptrStr("Daniel")}, nil},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			err := validateUpdate(tc.in)
			if !errors.Is(err, tc.want) {
				t.Fatalf("got %v, want %v", err, tc.want)
			}
		})
	}
}
