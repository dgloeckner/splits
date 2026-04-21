package event

import (
	"encoding/json"
	"time"
)

// EventName returns the INT-0002 `event:` field for a kind, or "" if
// the kind has no wire representation (ping/eof are emitted directly
// by the broadcaster and don't round-trip through Event).
func EventName(k Kind) string {
	switch k {
	case KindStroke:
		return "stroke"
	case KindSessionStart:
		return "session_start"
	case KindSessionEnd:
		return "session_end"
	case KindLevelChange:
		return "level_change"
	}
	return ""
}

// Marshal renders the data payload of an Event as INT-0002 JSON. The
// caller is responsible for prepending `event:` and `id:` lines and
// the `data:` prefix.
func Marshal(e Event) ([]byte, error) {
	switch e.Kind {
	case KindStroke:
		p := e.Stroke
		return json.Marshal(strokeWire{
			SessionID:      e.SessionID,
			Stroke:         p.StrokeNo,
			TimeSec:        p.TimeSec,
			DistanceM:      p.DistanceM,
			SPM:            p.SPM,
			PowerW:         p.PowerW,
			CalPerHr:       p.CalPerHr,
			Level:          p.Level,
			DPS:            p.DPS,
			StrokeCycleSec: p.StrokeCycleSec,
			PaceSecPer500m: p.PaceSecPer500m,
			EnergyJoules:   p.EnergyJoules,
		})
	case KindSessionStart:
		p := e.SessionStart
		return json.Marshal(sessionStartWire{
			SessionID:    e.SessionID,
			StartedAt:    p.StartedAt,
			RowerID:      p.RowerID,
			RowerName:    p.RowerName,
			InitialLevel: p.InitialLevel,
		})
	case KindSessionEnd:
		p := e.SessionEnd
		return json.Marshal(sessionEndWire{
			SessionID: e.SessionID,
			EndedAt:   p.EndedAt,
			Summary:   summaryWire(p.Summary),
		})
	case KindLevelChange:
		p := e.LevelChange
		return json.Marshal(levelChangeWire{
			From: p.From, To: p.To, AtStroke: p.AtStroke, AtTimeSec: p.AtTimeSec,
		})
	}
	return nil, nil
}

type strokeWire struct {
	SessionID      string  `json:"session_id"`
	Stroke         int     `json:"stroke"`
	TimeSec        float64 `json:"time_sec"`
	DistanceM      int     `json:"distance_m"`
	SPM            int     `json:"spm"`
	PowerW         int     `json:"power_w"`
	CalPerHr       int     `json:"cal_per_hr"`
	Level          int     `json:"level"`
	DPS            float64 `json:"dps"`
	StrokeCycleSec float64 `json:"stroke_cycle_sec"`
	PaceSecPer500m int     `json:"pace_sec_per_500m"`
	EnergyJoules   int     `json:"energy_joules"`
}

type sessionStartWire struct {
	SessionID    string    `json:"session_id"`
	StartedAt    time.Time `json:"started_at"`
	RowerID      string    `json:"rower_id"`
	RowerName    string    `json:"rower_name"`
	InitialLevel int       `json:"initial_level"`
}

type sessionEndWire struct {
	SessionID string      `json:"session_id"`
	EndedAt   time.Time   `json:"ended_at"`
	Summary   summaryWire `json:"summary"`
}

type summaryWire struct {
	TotalDistanceM    int     `json:"total_distance_m"`
	TotalTimeSec      float64 `json:"total_time_sec"`
	TotalStrokes      int     `json:"total_strokes"`
	AvgPowerW         int     `json:"avg_power_w"`
	PeakPowerW        int     `json:"peak_power_w"`
	AvgSPM            float64 `json:"avg_spm"`
	AvgDPS            float64 `json:"avg_dps"`
	AvgPaceSecPer500m int     `json:"avg_pace_sec_per_500m"`
	SessionCalories   int     `json:"session_calories"`
}

type levelChangeWire struct {
	From      int     `json:"from"`
	To        int     `json:"to"`
	AtStroke  int     `json:"at_stroke"`
	AtTimeSec float64 `json:"at_time_sec"`
}
