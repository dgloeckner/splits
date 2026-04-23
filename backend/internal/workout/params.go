// Package workout owns pre-session training configuration. A Workout
// is transient (one row per session that used a workout); a Favorite
// is the user-named template in the library.
package workout

import (
	"encoding/json"
	"errors"
	"fmt"
)

type Mode string

const (
	ModeJustRow   Mode = "just_row"
	ModeDistance  Mode = "distance"
	ModeTime      Mode = "time"
	ModeIntervals Mode = "intervals"
)

func (m Mode) Valid() bool {
	switch m {
	case ModeJustRow, ModeDistance, ModeTime, ModeIntervals:
		return true
	}
	return false
}

type Intensity string

const (
	IntensityLocker  Intensity = "locker"
	IntensityModerat Intensity = "moderat"
	IntensityHart    Intensity = "hart"
	IntensityAllOut  Intensity = "allout"
)

func (i Intensity) Valid() bool {
	if i == "" {
		return true
	}
	switch i {
	case IntensityLocker, IntensityModerat, IntensityHart, IntensityAllOut:
		return true
	}
	return false
}

// Params is the mode-specific payload. Exactly one of the pointer
// fields is populated, chosen by Mode.
type Params struct {
	Mode      Mode             `json:"-"`
	JustRow   *JustRowParams   `json:"-"`
	Distance  *DistanceParams  `json:"-"`
	Time      *TimeParams      `json:"-"`
	Intervals *IntervalsParams `json:"-"`
}

type JustRowParams struct{}
type DistanceParams struct {
	Meters int `json:"meters"`
}
type TimeParams struct {
	Seconds int `json:"seconds"`
}
type IntervalLength struct {
	Unit  string `json:"unit"`
	Value int    `json:"value"`
}
type IntervalsParams struct {
	Reps    int            `json:"reps"`
	Length  IntervalLength `json:"length"`
	RestSec int            `json:"rest_sec"`
}

var ErrInvalidParams = errors.New("workout: invalid params")

func DecodeParams(mode Mode, raw json.RawMessage) (*Params, error) {
	if !mode.Valid() {
		return nil, fmt.Errorf("%w: unknown mode %q", ErrInvalidParams, mode)
	}
	p := &Params{Mode: mode}
	switch mode {
	case ModeJustRow:
		p.JustRow = &JustRowParams{}
	case ModeDistance:
		var d DistanceParams
		if err := json.Unmarshal(raw, &d); err != nil {
			return nil, fmt.Errorf("%w: %v", ErrInvalidParams, err)
		}
		if d.Meters <= 0 {
			return nil, fmt.Errorf("%w: meters must be > 0", ErrInvalidParams)
		}
		p.Distance = &d
	case ModeTime:
		var tp TimeParams
		if err := json.Unmarshal(raw, &tp); err != nil {
			return nil, fmt.Errorf("%w: %v", ErrInvalidParams, err)
		}
		if tp.Seconds <= 0 {
			return nil, fmt.Errorf("%w: seconds must be > 0", ErrInvalidParams)
		}
		p.Time = &tp
	case ModeIntervals:
		var i IntervalsParams
		if err := json.Unmarshal(raw, &i); err != nil {
			return nil, fmt.Errorf("%w: %v", ErrInvalidParams, err)
		}
		if i.Reps <= 0 {
			return nil, fmt.Errorf("%w: reps must be > 0", ErrInvalidParams)
		}
		if i.Length.Unit != "m" && i.Length.Unit != "min" {
			return nil, fmt.Errorf("%w: length.unit must be 'm' or 'min'", ErrInvalidParams)
		}
		if i.Length.Value <= 0 {
			return nil, fmt.Errorf("%w: length.value must be > 0", ErrInvalidParams)
		}
		if i.RestSec < 0 {
			return nil, fmt.Errorf("%w: rest_sec must be >= 0", ErrInvalidParams)
		}
		p.Intervals = &i
	}
	return p, nil
}

func (p *Params) Encode() (json.RawMessage, error) {
	switch p.Mode {
	case ModeJustRow:
		return json.RawMessage(`{}`), nil
	case ModeDistance:
		return json.Marshal(p.Distance)
	case ModeTime:
		return json.Marshal(p.Time)
	case ModeIntervals:
		return json.Marshal(p.Intervals)
	}
	return nil, fmt.Errorf("%w: cannot encode mode %q", ErrInvalidParams, p.Mode)
}
