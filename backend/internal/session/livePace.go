package session

import (
	"github.com/gloeckner-daniel/splits/internal/event"
)

// LivePaceKind classifies a LivePace return: a fresh value, a held
// (sparse-window fallback) state, or empty (no strokes yet).
type LivePaceKind int

const (
	// LivePaceEmpty means the stroke buffer is empty; no value can be
	// produced and the caller should not emit a pace yet.
	LivePaceEmpty LivePaceKind = iota
	// LivePaceHeld means fewer than two strokes are inside the window;
	// the previously-displayed value should be re-emitted.
	LivePaceHeld
	// LivePaceValue means the function produced a fresh windowed pace.
	LivePaceValue
)

// DefaultLivePaceWindowSec is the provisional 5-second window from
// ADR-0011. Override via build-time flag for replay experiments
// (see LivePaceWindowSec).
const DefaultLivePaceWindowSec = 5.0

// LivePaceWindowSec is the active window value. It is a var (not a
// const) so a build-time -ldflags '-X' override or a test can swap it
// without touching call sites. Defaults to DefaultLivePaceWindowSec.
var LivePaceWindowSec = DefaultLivePaceWindowSec

// LivePace computes the current sliding-window pace in seconds per
// 500 m over the trailing windowSec seconds ending at nowSec.
//
// strokes must be sorted by TimeSec ascending. nowSec is the trailing
// edge of the window; tStart = nowSec - windowSec is the leading edge.
//
// Algorithm (matches ADR-0011 and reuses the linear-interpolation
// arithmetic from stats/candidates.go:interpTime):
//
//  1. If the buffer is empty → (0, LivePaceEmpty).
//  2. Find the strokes inside [tStart, nowSec]. If fewer than 2
//     → (0, LivePaceHeld) — caller re-emits the last value.
//  3. Compute distance at tStart by linear interpolation between the
//     bracketing strokes (or clamp to the first stroke if tStart is
//     before it).
//  4. Compute distance at nowSec the same way (clamping to the last
//     stroke if nowSec is past it).
//  5. pace = 500 / (dEnd - dStart) * windowSec, rounded to int.
//
// The window represents exactly windowSec seconds of motion: both
// edges are interpolated against the time axis rather than snapped to
// stroke boundaries.
func LivePace(strokes []event.StrokePayload, windowSec, nowSec float64) (int, LivePaceKind) {
	if len(strokes) == 0 {
		return 0, LivePaceEmpty
	}
	tStart := nowSec - windowSec

	// Count strokes inside [tStart, nowSec] (closed-closed).
	inside := 0
	for _, s := range strokes {
		if s.TimeSec >= tStart && s.TimeSec <= nowSec {
			inside++
		}
	}
	if inside < 2 {
		return 0, LivePaceHeld
	}

	dStart := distAt(strokes, tStart)
	dEnd := distAt(strokes, nowSec)
	covered := dEnd - dStart
	if covered <= 0 || windowSec <= 0 {
		return 0, LivePaceHeld
	}
	return int(500.0 / covered * windowSec), LivePaceValue
}

// distAt returns the (interpolated) cumulative distance at time t.
// Strokes must be sorted by TimeSec ascending and non-empty. Outside
// the stroke time range the value is clamped to the nearest endpoint.
//
// Uses the same linear arithmetic as stats/candidates.go:interpTime
// (re-implemented here to avoid an import cycle between session/ and
// stats/).
func distAt(strokes []event.StrokePayload, t float64) float64 {
	if t <= strokes[0].TimeSec {
		return float64(strokes[0].DistanceM)
	}
	last := strokes[len(strokes)-1]
	if t >= last.TimeSec {
		return float64(last.DistanceM)
	}
	// Binary-search would be tidier; sessionizer keeps the buffer tiny
	// (a few strokes' worth) so a linear scan is fine.
	for i := 0; i+1 < len(strokes); i++ {
		a, b := strokes[i], strokes[i+1]
		if t >= a.TimeSec && t <= b.TimeSec {
			return interpDist(a.TimeSec, float64(a.DistanceM), b.TimeSec, float64(b.DistanceM), t)
		}
	}
	return float64(last.DistanceM)
}

// interpDist mirrors stats/candidates.go:interpTime but interpolates
// distance against time instead of time against distance. Same
// arithmetic shape:  y0 + (y1-y0) * (x-x0) / (x1-x0).
func interpDist(t0, d0, t1, d1, t float64) float64 {
	if t1 == t0 {
		return d0
	}
	return d0 + (d1-d0)*(t-t0)/(t1-t0)
}
