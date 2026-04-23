// Package event defines the pipeline-internal Event type used from the
// sessionizer onward. See specs/arch/0001-backend-pipeline.md.
package event

import "time"

// Kind discriminates the Event payload variants.
type Kind uint8

const (
	KindStroke Kind = iota + 1
	KindSessionStart
	KindSessionEnd
	KindLevelChange
)

// Event is the internal envelope handed from the sessionizer to every
// downstream consumer. Exactly one of the pointer fields is non-nil,
// determined by Kind.
type Event struct {
	ID        uint64    // lifetime-monotonic, stamped by the sessionizer
	Kind      Kind
	SessionID string    // ULID; set on session_start, copied into subsequent events
	At        time.Time // server receive time

	Stroke       *StrokePayload
	SessionStart *SessionStartPayload
	SessionEnd   *SessionEndPayload
	LevelChange  *LevelChangePayload
}

// StrokePayload carries one decoded A8 message plus Tier-2 derivations.
// The Tier-2 fields (DPS, StrokeCycleSec, PaceSecPer500m, EnergyJoules)
// are zero in M1 — they are populated by the sessionizer in M2.
type StrokePayload struct {
	StrokeNo    int
	TimeSec     float64
	DistanceM   int
	SPM         int
	PowerW      int
	CalPerHr    int
	Level       int
	RawPayload  string
	UnknownJSON []byte

	DPS             float64
	StrokeCycleSec  float64
	PaceSecPer500m  int
	EnergyJoules    int
}

type SessionStartPayload struct {
	StartedAt    time.Time
	RowerID      string
	RowerName    string
	InitialLevel int
	WorkoutID    string // empty if none attached
}

type SessionEndPayload struct {
	EndedAt time.Time
	Summary SessionSummary
}

type SessionSummary struct {
	TotalDistanceM    int
	TotalTimeSec      float64
	TotalStrokes      int
	AvgPowerW         int
	PeakPowerW        int
	AvgSPM            float64
	AvgDPS            float64
	AvgPaceSecPer500m int
	SessionCalories   int
}

type LevelChangePayload struct {
	From       int
	To         int
	AtStroke   int
	AtTimeSec  float64
}
