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
	case KindWorkoutAttached:
		return "workout_attached"
	case KindPhaseChange:
		return "phase_change"
	case KindSessionFinalized:
		return "session_finalized"
	case KindSessionPaused:
		return "session_paused"
	case KindSessionResumed:
		return "session_resumed"
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
			Phase:          p.Phase,
			WorkDistanceM:  p.WorkDistanceM,
			WorkTimeSec:    p.WorkTimeSec,
			PhaseDistanceM: p.PhaseDistanceM,
			PhaseTimeSec:   p.PhaseTimeSec,
		})
	case KindSessionStart:
		p := e.SessionStart
		return json.Marshal(sessionStartWire{
			SessionID:    e.SessionID,
			StartedAt:    p.StartedAt,
			RowerID:      p.RowerID,
			RowerName:    p.RowerName,
			InitialLevel: p.InitialLevel,
			WorkoutID:    p.WorkoutID,
		})
	case KindSessionEnd:
		p := e.SessionEnd
		return json.Marshal(sessionEndWire{
			SessionID: e.SessionID,
			EndedAt:   p.EndedAt,
			// SSE consumers see totals only; samples are computed by the
			// persister after this event is emitted and are read from
			// summary_json on session-detail fetch (FEAT-0009 Mode 0).
			Summary: summaryWire{
				TotalDistanceM:    p.Summary.TotalDistanceM,
				TotalTimeSec:      p.Summary.TotalTimeSec,
				TotalStrokes:      p.Summary.TotalStrokes,
				AvgPowerW:         p.Summary.AvgPowerW,
				PeakPowerW:        p.Summary.PeakPowerW,
				AvgSPM:            p.Summary.AvgSPM,
				AvgDPS:            p.Summary.AvgDPS,
				AvgSPI:            p.Summary.AvgSPI,
				AvgPaceSecPer500m: p.Summary.AvgPaceSecPer500m,
				SessionCalories:   p.Summary.SessionCalories,
			},
		})
	case KindLevelChange:
		p := e.LevelChange
		return json.Marshal(levelChangeWire{
			From: p.From, To: p.To, AtStroke: p.AtStroke, AtTimeSec: p.AtTimeSec,
		})
	case KindWorkoutAttached:
		p := e.WorkoutAttached
		return json.Marshal(workoutAttachedWire{
			SessionID: e.SessionID,
			WorkoutID: p.WorkoutID,
		})
	case KindPhaseChange:
		p := e.PhaseChange
		return json.Marshal(phaseChangeWire{
			SessionID:   e.SessionID,
			From:        p.From,
			To:          p.To,
			AtStroke:    p.AtStroke,
			AtTimeSec:   p.AtTimeSec,
			AtDistanceM: p.AtDistanceM,
		})
	case KindSessionFinalized:
		p := e.SessionFinalized
		// The enriched summary is serialised verbatim using its JSON
		// tags so clients receive Race, Samples, PBCandidates, etc.
		return json.Marshal(sessionFinalizedWire{
			SessionID: e.SessionID,
			Summary:   p.Summary,
		})
	case KindSessionPaused, KindSessionResumed:
		p := e.SessionPause
		return json.Marshal(sessionPauseWire{
			SessionID: e.SessionID,
			AtTimeSec: p.AtTimeSec,
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
	Phase          string  `json:"phase,omitempty"`
	WorkDistanceM  int     `json:"work_distance_m"`
	WorkTimeSec    float64 `json:"work_time_sec"`
	PhaseDistanceM int     `json:"phase_distance_m"`
	PhaseTimeSec   float64 `json:"phase_time_sec"`
}

type phaseChangeWire struct {
	SessionID   string  `json:"session_id"`
	From        string  `json:"from"`
	To          string  `json:"to"`
	AtStroke    int     `json:"at_stroke"`
	AtTimeSec   float64 `json:"at_time_sec"`
	AtDistanceM int     `json:"at_distance_m"`
}

type sessionStartWire struct {
	SessionID    string    `json:"session_id"`
	StartedAt    time.Time `json:"started_at"`
	RowerID      string    `json:"rower_id"`
	RowerName    string    `json:"rower_name"`
	InitialLevel int       `json:"initial_level"`
	WorkoutID    string    `json:"workout_id,omitempty"`
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
	AvgSPI            int     `json:"avg_spi"`
	AvgPaceSecPer500m int     `json:"avg_pace_sec_per_500m"`
	SessionCalories   int     `json:"session_calories"`
}

type levelChangeWire struct {
	From      int     `json:"from"`
	To        int     `json:"to"`
	AtStroke  int     `json:"at_stroke"`
	AtTimeSec float64 `json:"at_time_sec"`
}

type workoutAttachedWire struct {
	SessionID string `json:"session_id"`
	WorkoutID string `json:"workout_id"`
}

type sessionFinalizedWire struct {
	SessionID string         `json:"session_id"`
	Summary   SessionSummary `json:"summary"`
}

type sessionPauseWire struct {
	SessionID string  `json:"session_id"`
	AtTimeSec float64 `json:"at_time_sec"`
}
