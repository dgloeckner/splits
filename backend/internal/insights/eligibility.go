package insights

const (
	MinDurationSec = 300  // 5 min
	MinDistanceM   = 1000 // 1 km
)

type Reason string

const (
	ReasonNone      Reason = ""
	ReasonIntervals Reason = "intervals"
	ReasonTooShort  Reason = "too_short"
)

// SessionMeta is the minimum subset of a session needed by the
// eligibility gate. WorkoutMode == "" means "no workout attached".
type SessionMeta struct {
	WorkoutMode string
	DurationSec float64
	DistanceM   int
}

type EligibilityResult struct {
	OK     bool
	Reason Reason
}

func CheckEligibility(m SessionMeta) EligibilityResult {
	if m.WorkoutMode == "intervals" {
		return EligibilityResult{OK: false, Reason: ReasonIntervals}
	}
	if m.DurationSec < MinDurationSec || m.DistanceM < MinDistanceM {
		return EligibilityResult{OK: false, Reason: ReasonTooShort}
	}
	return EligibilityResult{OK: true, Reason: ReasonNone}
}
