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
	KindWorkoutAttached
	KindPhaseChange
)

// Event is the internal envelope handed from the sessionizer to every
// downstream consumer. Exactly one of the pointer fields is non-nil,
// determined by Kind.
type Event struct {
	ID        uint64    // lifetime-monotonic, stamped by the sessionizer
	Kind      Kind
	SessionID string    // ULID; set on session_start, copied into subsequent events
	At        time.Time // server receive time

	Stroke          *StrokePayload
	SessionStart    *SessionStartPayload
	SessionEnd      *SessionEndPayload
	LevelChange     *LevelChangePayload
	WorkoutAttached *WorkoutAttachedPayload
	PhaseChange     *PhaseChangePayload
}

// WorkoutAttachedPayload signals that a workout was attached to the
// currently open session after session_start was already emitted.
// Persister updates sessions.workout_id; frontend updates live state.
type WorkoutAttachedPayload struct {
	WorkoutID string
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
	Phase       string
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
	TotalDistanceM    int     `json:"total_distance_m"`
	TotalTimeSec      float64 `json:"total_time_sec"`
	TotalStrokes      int     `json:"total_strokes"`
	AvgPowerW         int     `json:"avg_power_w"`
	PeakPowerW        int     `json:"peak_power_w"`
	AvgSPM            float64 `json:"avg_spm"`
	AvgDPS            float64 `json:"avg_dps"`
	AvgPaceSecPer500m int     `json:"avg_pace_sec_per_500m"`
	SessionCalories   int     `json:"session_calories"`
	WarmupSec         float64 `json:"warmup_sec,omitempty"`
	RestSec           float64 `json:"rest_sec,omitempty"`
	CooldownSec       float64 `json:"cooldown_sec,omitempty"`

	// Samples is the downsampled per-stroke series used by past-session
	// charts after compaction (FEAT-0009). Populated by the persister at
	// session_end; the sessionizer leaves it nil. Omitted from JSON when
	// nil so existing summaries don't grow a useless empty field.
	Samples *SessionSamples `json:"samples,omitempty"`

	// PBCandidates is the per-session best-effort set used by the
	// FEAT-0010 recompute path. Stored as opaque JSON here — the
	// stats package owns the type. Persister fills it in along with
	// Samples.
	PBCandidates any `json:"pb_candidates,omitempty"`

	// Flags is a small set of free-form tags persisted with the
	// session (e.g. ["recovered"] when the boot janitor finalised an
	// orphaned session). Cheap surface for "soft" annotations
	// without per-flag schema columns.
	Flags []string `json:"flags,omitempty"`
}

// SessionSamples is N-stroke-bucket-averaged time series. Length is
// always equal across all four arrays. T is the time-axis in seconds
// from session start (one entry per bucket).
type SessionSamples struct {
	BucketStrokes int       `json:"bucket_strokes"`
	T             []float64 `json:"t_sec"`
	Split         []int     `json:"split"`
	Watt          []int     `json:"watt"`
	SPM           []int     `json:"spm"`
}

type LevelChangePayload struct {
	From       int
	To         int
	AtStroke   int
	AtTimeSec  float64
}

type PhaseChangePayload struct {
	From        string  `json:"from"`
	To          string  `json:"to"`
	AtStroke    int     `json:"at_stroke"`
	AtTimeSec   float64 `json:"at_time_sec"`
	AtDistanceM int     `json:"at_distance_m"`
}
