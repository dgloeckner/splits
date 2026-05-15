package session

import (
	"encoding/json"
	"fmt"

	"github.com/gloeckner-daniel/splits/internal/workout"
)

// Phase classifies a stroke against the workout's segment plan.
type Phase uint8

const (
	PhaseWork Phase = iota + 1
	PhaseWarmup
	PhaseRest
	PhaseCooldown
	PhaseDone
)

func (p Phase) String() string {
	switch p {
	case PhaseWork:
		return "work"
	case PhaseWarmup:
		return "warmup"
	case PhaseRest:
		return "rest"
	case PhaseCooldown:
		return "cooldown"
	case PhaseDone:
		return "done"
	}
	return "unknown"
}

// segment is the internal expanded form. Mirrors web/src/live/segments.ts
// but only carries what the classifier needs.
type segment struct {
	kind          Phase
	durationSec   float64 // 0 if not time-based
	distanceM     int     // 0 if not distance-based
	startDistance int     // cumulative distance offset at start of this segment
}

// PhasePlan classifies a (distance, time) point into a phase. Stateful:
//
//   - crossedAt records the first timeSec at which each distance
//     segment's target was crossed, so that following time-based
//     segments (rest, cooldown) anchor their countdown to that moment.
//   - warmupEndDistance records the cumulative distance at the first
//     stroke after warmup completes. Distance segments are evaluated
//     relative to this anchor (B5): a 5K distance workout should mean
//     5 km of post-warmup rowing, not 5 km of cumulative session
//     distance — otherwise the metres rowed while the warmup timer
//     ticks down silently shorten the work goal. -1 = not yet
//     recorded (no stroke past warmup, or no warmup at all).
type PhasePlan struct {
	segs              []segment
	hasAny            bool // false for FreeRow
	crossedAt         map[int]float64 // key: segment slice index of distance segments
	warmupEndDistance int             // cumulative distance at warmup-end; -1 = unset
}

// FreeRowPhasePlan is the no-workout plan: every stroke is work, never
// completes.
func FreeRowPhasePlan() *PhasePlan {
	return &PhasePlan{hasAny: false, crossedAt: make(map[int]float64), warmupEndDistance: -1}
}

// BuildPhasePlan expands a workout into segments.
func BuildPhasePlan(w *workout.Workout) (*PhasePlan, error) {
	if w == nil {
		return FreeRowPhasePlan(), nil
	}
	if w.Mode == workout.ModeJustRow {
		return FreeRowPhasePlan(), nil
	}
	p := &PhasePlan{hasAny: true, crossedAt: make(map[int]float64), warmupEndDistance: -1}
	if w.WarmupSec > 0 {
		p.segs = append(p.segs, segment{kind: PhaseWarmup, durationSec: float64(w.WarmupSec)})
	}
	switch w.Mode {
	case workout.ModeDistance:
		var params struct {
			Meters int `json:"meters"`
		}
		if err := json.Unmarshal(w.ParamsJSON, &params); err != nil {
			return nil, fmt.Errorf("parse distance params: %w", err)
		}
		p.segs = append(p.segs, segment{kind: PhaseWork, distanceM: params.Meters})
	case workout.ModeTime:
		var params struct {
			Seconds int `json:"seconds"`
		}
		if err := json.Unmarshal(w.ParamsJSON, &params); err != nil {
			return nil, fmt.Errorf("parse time params: %w", err)
		}
		p.segs = append(p.segs, segment{kind: PhaseWork, durationSec: float64(params.Seconds)})
	case workout.ModeIntervals:
		var params struct {
			Reps   int `json:"reps"`
			Length struct {
				Unit  string `json:"unit"`
				Value int    `json:"value"`
			} `json:"length"`
			RestSec int `json:"rest_sec"`
		}
		if err := json.Unmarshal(w.ParamsJSON, &params); err != nil {
			return nil, fmt.Errorf("parse intervals params: %w", err)
		}
		for i := 0; i < params.Reps; i++ {
			s := segment{kind: PhaseWork}
			if params.Length.Unit == "m" {
				s.distanceM = params.Length.Value
			} else {
				// "min" → convert to seconds
				s.durationSec = float64(params.Length.Value) * 60
			}
			p.segs = append(p.segs, s)
			if i < params.Reps-1 {
				p.segs = append(p.segs, segment{kind: PhaseRest, durationSec: float64(params.RestSec)})
			}
		}
	default:
		return nil, fmt.Errorf("unknown workout mode: %s", w.Mode)
	}
	if w.CooldownSec > 0 {
		p.segs = append(p.segs, segment{kind: PhaseCooldown, durationSec: float64(w.CooldownSec)})
	}

	// Fill in cumulative startDistance offsets.
	var cumD int
	for i := range p.segs {
		p.segs[i].startDistance = cumD
		cumD += p.segs[i].distanceM
	}
	return p, nil
}

// Reset clears the crossedAt cache so subsequent classifications behave
// as if the session just started. Used when the sessionizer re-anchors
// the phase plan (e.g. when a workout is attached mid-session).
func (p *PhasePlan) Reset() {
	if p == nil {
		return
	}
	p.crossedAt = make(map[int]float64)
	p.warmupEndDistance = -1
}

// hasWarmup reports whether the plan begins with a warmup segment.
func (p *PhasePlan) hasWarmup() bool {
	return len(p.segs) > 0 && p.segs[0].kind == PhaseWarmup
}

// Classify returns the phase for the given absolute (distanceM, timeSec).
// The second return is true when the entire workout is complete (cooldown
// elapsed, or last work segment done if no cooldown).
//
// Classify is stateful: the first time a distance segment's target is
// crossed, that stroke's timeSec is recorded in crossedAt so that any
// following time-based segment (rest, cooldown) anchors its countdown to
// that exact moment rather than session start.
func (p *PhasePlan) Classify(distanceM int, timeSec float64) (Phase, bool) {
	if !p.hasAny {
		return PhaseWork, false
	}

	// timeAnchor is the cumulative elapsed time used by time-based segments
	// that appear before any distance segment has been crossed.
	var timeAnchor float64

	// lastCrossedTime is the most recently recorded crossing timeSec
	// seen so far as we iterate segments. -1 means no distance segment
	// has been crossed yet in this call.
	lastCrossedTime := -1.0

	for idx, s := range p.segs {
		if s.durationSec > 0 {
			// Time-based segment.
			var anchor float64
			if lastCrossedTime >= 0 {
				anchor = lastCrossedTime
			} else {
				anchor = timeAnchor
			}
			consumed := timeSec - anchor
			if consumed < 0 {
				consumed = 0
			}
			if consumed < s.durationSec {
				return s.kind, false
			}
			// Segment elapsed: advance the anchor.
			if lastCrossedTime >= 0 {
				lastCrossedTime += s.durationSec
			} else {
				timeAnchor += s.durationSec
			}
			// B5: the moment we fall through the warmup segment, latch
			// the cumulative distance so subsequent distance segments
			// are measured from here, not from session start. Without
			// this anchor, distance rowed during warmup silently
			// shortens the work goal.
			if s.kind == PhaseWarmup && p.warmupEndDistance < 0 {
				p.warmupEndDistance = distanceM
			}
		} else if s.distanceM > 0 {
			// Distance-based segment. Offset by warmupEndDistance so
			// the goal counts post-warmup metres only (B5).
			offset := 0
			if p.warmupEndDistance > 0 {
				offset = p.warmupEndDistance
			}
			consumed := distanceM - s.startDistance - offset
			if consumed < s.distanceM {
				return s.kind, false
			}
			// Crossing or past: record the timeSec of FIRST crossing, then
			// for that very first crossing return the segment's own kind so
			// the stroke that crosses still counts as work. Subsequent calls
			// fall through to the next segment.
			if _, already := p.crossedAt[idx]; !already {
				p.crossedAt[idx] = timeSec
				return s.kind, false
			}
			lastCrossedTime = p.crossedAt[idx]
		}
	}
	return PhaseDone, true
}
