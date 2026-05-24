package session

import (
	"time"

	"github.com/gloeckner-daniel/splits/internal/event"
)

// LivePaceKind classifies a LivePace return: a fresh value, a held
// (sparse-window fallback) state, or empty (no strokes yet).
type LivePaceKind int

const (
	// LivePaceEmpty means the stroke buffer is empty; no value can be
	// produced and the caller should not emit a pace yet.
	LivePaceEmpty LivePaceKind = iota
	// LivePaceHeld means the trailing window holds fewer than two
	// strokes (just after a session start or right after a pause); the
	// previously-displayed value should be re-emitted.
	LivePaceHeld
	// LivePaceValue means the function produced a fresh windowed pace.
	LivePaceValue
)

// Defaults chosen against the 24-May-2026 capture (session
// 01KSD9BQZ758BQACNVG62WE6GB, see docs/livepace-host-time.md):
//
//   - 10 s host-time window keeps σ vs the rower console at ~2.3 s/500m
//     across cadences (a 5-stroke window varies from 7–15 s as SPM swings
//     and inflates after pauses).
//   - 4 s pause threshold matches the dead-reckoning hint already in use
//     for live-view smoothing (web/src/live/smoothing.ts).
var (
	LivePaceWindow         = 10 * time.Second
	LivePacePauseThreshold = 4 * time.Second
)

// LivePace computes the trailing windowed pace in seconds per 500 m
// using host wall-clock time (StrokePayload.At), not the device's
// TimeSec field. The device stamps TimeSec at integer-second
// resolution, which produces ±1 s of jitter on a ~7 s window — large
// enough to swing a 1:40 split between 1:32 and 1:51 on a single
// stroke. Host time is microsecond-precise and free of that artefact.
//
// strokes must be sorted by At ascending. The window is anchored on
// the newest stroke and extended backwards through older strokes
// until either:
//
//  1. the window duration is exceeded — older strokes ignored;
//  2. a gap larger than pauseThreshold is found between two consecutive
//     strokes — the window stops there, so a long idle period inside
//     the buffer cannot inflate the windowed split.
//
// pace = 500 / Δd × Δt over the selected sub-slice. <2 strokes after
// trimming → LivePaceHeld so the caller keeps showing the last value.
func LivePace(strokes []event.StrokePayload, window, pauseThreshold time.Duration) (int, LivePaceKind) {
	if len(strokes) == 0 {
		return 0, LivePaceEmpty
	}
	if window <= 0 {
		window = LivePaceWindow
	}
	if pauseThreshold <= 0 {
		pauseThreshold = LivePacePauseThreshold
	}
	last := strokes[len(strokes)-1]
	// Walk backwards. startIdx becomes the oldest stroke still inside
	// the window and not separated from its successor by a pause.
	startIdx := len(strokes) - 1
	for i := len(strokes) - 2; i >= 0; i-- {
		gap := strokes[i+1].At.Sub(strokes[i].At)
		if gap > pauseThreshold {
			break
		}
		if last.At.Sub(strokes[i].At) > window {
			break
		}
		startIdx = i
	}
	if startIdx == len(strokes)-1 {
		return 0, LivePaceHeld
	}
	first := strokes[startIdx]
	dCovered := last.DistanceM - first.DistanceM
	tElapsed := last.At.Sub(first.At).Seconds()
	if dCovered <= 0 || tElapsed <= 0 {
		return 0, LivePaceHeld
	}
	return int(500.0 / float64(dCovered) * tElapsed), LivePaceValue
}
