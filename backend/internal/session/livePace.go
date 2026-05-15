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
	// LivePaceHeld means the buffer holds fewer than two strokes; the
	// previously-displayed value should be re-emitted.
	LivePaceHeld
	// LivePaceValue means the function produced a fresh windowed pace.
	LivePaceValue
)

// DefaultLivePaceWindowStrokes is the trailing-stroke window selected
// after the 5-second time window in the original ADR-0011 design
// produced visible upward pace spikes (BUG U3 — see
// docs/distance-flow-audit.md). The device emits stroke timestamps at
// 1-second resolution, so a time-based window cuts unevenly across
// stroke boundaries and amplifies quantization noise. A stroke-based
// window samples at the device's natural unit and damps it.
//
// 5 strokes was chosen from a real-session comparison (2/3/4/5/10)
// where 5 was the smallest window whose upward-spike count
// (split > 2:00 during steady 1:50 rowing) dropped sharply — 75 at
// 4-stroke down to 23 at 5-stroke. 10-stroke was smoother still but
// noticeably laggy on cadence changes. See docs/u3-stroke-windows.png.
const DefaultLivePaceWindowStrokes = 5

// LivePaceWindowStrokes is the active window length. It is a var (not
// a const) so a build-time -ldflags '-X' override or a test can swap
// it without touching call sites. Defaults to
// DefaultLivePaceWindowStrokes.
var LivePaceWindowStrokes = DefaultLivePaceWindowStrokes

// LivePace computes the trailing N-stroke pace in seconds per 500 m.
//
// strokes must be sorted by TimeSec ascending. N is taken from
// LivePaceWindowStrokes; if the buffer holds fewer than N strokes, the
// window shrinks to whatever is available (still ≥2 needed for a
// fresh value).
//
// Algorithm:
//
//  1. If the buffer is empty → (0, LivePaceEmpty).
//  2. If fewer than 2 strokes inside the trailing-N window
//     → (0, LivePaceHeld) — caller re-emits the last value.
//  3. Let start = the oldest of the trailing N strokes, end = the
//     newest. pace = 500 / (dEnd − dStart) × (tEnd − tStart),
//     rounded to int.
//
// This is the simple stroke-anchored version: no sub-stroke
// interpolation is needed because the window endpoints coincide with
// actual stroke samples — eliminating the leading-edge interpolation
// artifacts of the previous time-window implementation.
func LivePace(strokes []event.StrokePayload, windowStrokes int, _ float64) (int, LivePaceKind) {
	if len(strokes) == 0 {
		return 0, LivePaceEmpty
	}
	if windowStrokes < 2 {
		windowStrokes = 2
	}
	// Window covers the last windowStrokes entries (or all of them if
	// the buffer is shorter).
	startIdx := len(strokes) - windowStrokes
	if startIdx < 0 {
		startIdx = 0
	}
	if len(strokes)-startIdx < 2 {
		return 0, LivePaceHeld
	}
	first := strokes[startIdx]
	last := strokes[len(strokes)-1]
	dCovered := last.DistanceM - first.DistanceM
	tElapsed := last.TimeSec - first.TimeSec
	if dCovered <= 0 || tElapsed <= 0 {
		return 0, LivePaceHeld
	}
	return int(500.0 / float64(dCovered) * tElapsed), LivePaceValue
}
