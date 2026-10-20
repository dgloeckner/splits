package insights

import "github.com/gloeckner-daniel/splits/internal/event"

// Result is the full output of a run: either a list of findings + a
// synthesis paragraph, or an ineligibility reason.
type Result struct {
	Eligible    bool      `json:"eligible"`
	Reason      Reason    `json:"reason,omitempty"`
	Findings    []Finding `json:"findings"`
	SynthesisDE string    `json:"synthesis_de"`
}

// Run executes the eligibility gate and (if eligible) every detector
// over the supplied samples, then synthesises a paragraph. Pure —
// no IO. Caller persists the result.
func Run(meta SessionMeta, samples *event.SessionSamples) Result {
	gate := CheckEligibility(meta)
	if !gate.OK {
		return Result{Eligible: false, Reason: gate.Reason, Findings: []Finding{}}
	}
	var findings []Finding
	if f, ok := DetectPacing(samples); ok {
		findings = append(findings, f)
	}
	fade, faded := DetectFade(samples)
	if faded {
		findings = append(findings, fade)
	}
	if f, ok := DetectConsistency(samples); ok {
		findings = append(findings, f)
	}
	// A fade already explains the watt drop; drift would double it.
	if f, ok := DetectDrift(samples); ok && !faded {
		findings = append(findings, f)
	}
	findings = Reconcile(findings)
	return Result{
		Eligible:    true,
		Findings:    findings,
		SynthesisDE: Synthesize(findings),
	}
}
