// Package insights implements FEAT-0011 — per-session, rules-based
// findings (Pacing/Fade/Consistency) computed from
// summary_json.samples at session_end.
package insights

type Severity string

const (
	SeverityInfo      Severity = "INFO"
	SeverityNotable   Severity = "NOTABLE"
	SeverityAttention Severity = "ATTENTION"
)

type Category string

const (
	CategoryPacing      Category = "PACING"
	CategoryEfficiency  Category = "EFFICIENCY"
	CategoryConsistency Category = "CONSISTENCY"
)

// Code is the stable, machine-readable identifier for a finding kind.
type Code string

const (
	CodePositiveSplit  Code = "POSITIVE_SPLIT"
	CodeNegativeSplit  Code = "NEGATIVE_SPLIT"
	CodeEvenSplit      Code = "EVEN_SPLIT"
	CodeFade           Code = "FADE"
	CodeConsistentHigh Code = "CONSISTENT_HIGH"
	CodeConsistentMid  Code = "CONSISTENT_MID"
	CodeInconsistent   Code = "INCONSISTENT"
)

// Finding is the unit emitted by every detector.
type Finding struct {
	DetectorID string             `json:"detector_id"`
	Code       Code               `json:"code"`
	Severity   Severity           `json:"severity"`
	Category   Category           `json:"category"`
	MessageDE  string             `json:"message_de"`
	Evidence   map[string]float64 `json:"evidence"`
}
