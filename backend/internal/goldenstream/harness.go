// Package goldenstream is the ADR-0017 deterministic replay harness:
// it replays captured IPM fixtures through the production Sessionizer
// with an injected clock and pins the emitted SSE event stream as
// golden JSONL files committed under specs/int/fixtures/golden/.
// The TS suite (web/src/live/goldenReplay.test.ts) consumes the same
// files — the JSONL is the contract between the two suites.
package goldenstream

import (
	"context"
	"encoding/csv"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"strconv"
	"time"

	"github.com/gloeckner-daniel/splits/internal/event"
	"github.com/gloeckner-daniel/splits/internal/ipm"
	"github.com/gloeckner-daniel/splits/internal/session"
)

// timedFrame pairs a frame with its capture offset from stream start.
type timedFrame struct {
	Offset time.Duration
	Frame  ipm.Frame
}

// timedEvent is one golden JSONL line.
type timedEvent struct {
	AtMs  int64           `json:"at_ms"`
	Event string          `json:"event"`
	ID    uint64          `json:"id"`
	Data  json.RawMessage `json:"data"`
}

// loadFixtureFrames parses a specs/int/fixtures/ipm CSV into frames by
// decoding the raw_payload column (last) through the PRODUCTION A8
// decoder. Offsets are normalised to the first row's capture_ts.
func loadFixtureFrames(path string) ([]timedFrame, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	r := csv.NewReader(f)
	if _, err := r.Read(); err != nil { // skip header
		return nil, err
	}
	var out []timedFrame
	first := -1.0
	for {
		rec, err := r.Read()
		if err == io.EOF {
			break
		}
		if err != nil {
			return nil, err
		}
		atF, _ := strconv.ParseFloat(rec[0], 64)
		if first < 0 {
			first = atF
		}
		frame, err := ipm.DecodeA8(rec[len(rec)-1]) // raw_payload column
		if err != nil {
			return nil, fmt.Errorf("row at %s: %w", rec[0], err)
		}
		out = append(out, timedFrame{
			Offset: time.Duration((atF - first) * float64(time.Second)),
			Frame:  frame,
		})
	}
	return out, nil
}

// synthPauseFrames models the CONTEXT.md §Pause scenario:
// 20 strokes @ 2 s / 10 m, then 45 idle broadcasts every 2 s
// (90 s, distance frozen), then 20 more strokes.
func synthPauseFrames() []timedFrame {
	var out []timedFrame
	at := 0.0
	dist := 0
	devT := 0.0
	stroke := func() {
		at += 2; devT += 2; dist += 10
		out = append(out, timedFrame{
			Offset: time.Duration(at * float64(time.Second)),
			Frame:  ipm.Frame{TimeSec: devT, DistanceM: dist, SPM: 24, PowerW: 150, CalPerHr: 800, Level: 3},
		})
	}
	idle := func() {
		at += 2; devT += 2
		out = append(out, timedFrame{
			Offset: time.Duration(at * float64(time.Second)),
			Frame:  ipm.Frame{TimeSec: devT, DistanceM: dist, SPM: 0, PowerW: 0, CalPerHr: 0, Level: 3},
		})
	}
	for i := 0; i < 20; i++ {
		stroke()
	}
	for i := 0; i < 45; i++ {
		idle()
	}
	for i := 0; i < 20; i++ {
		stroke()
	}
	return out
}

// run replays frames through a fresh Sessionizer via the synchronous
// step seam (C0): no goroutines, no channels, no handshakes.
func run(frames []timedFrame, opts session.Options, workoutID string) ([]timedEvent, error) {
	base := time.Unix(1_700_000_000, 0).UTC()
	cur := base
	opts.Now = func() time.Time { return cur }
	seq := 0
	opts.NewSessionID = func() string { seq++; return fmt.Sprintf("GOLDEN-%04d", seq) }

	sz := session.New(opts)
	var evs []timedEvent
	add := func(at time.Duration, es []event.Event) error {
		for _, e := range es {
			data, err := event.Marshal(e)
			if err != nil {
				return err
			}
			evs = append(evs, timedEvent{
				AtMs: at.Milliseconds(), Event: event.EventName(e.Kind),
				ID: e.ID, Data: data,
			})
		}
		return nil
	}

	if err := add(0, sz.OpenSession(workoutID)); err != nil {
		return nil, err
	}
	for _, tf := range frames {
		cur = base.Add(tf.Offset)
		f := tf.Frame
		f.ReceivedAt = cur
		es, err := sz.ProcessFrame(context.Background(), f)
		if err != nil {
			return nil, err
		}
		if err := add(tf.Offset, es); err != nil {
			return nil, err
		}
	}
	last := frames[len(frames)-1].Offset
	if err := add(last, sz.CloseOpenSession()); err != nil {
		return nil, err
	}
	return evs, nil
}
