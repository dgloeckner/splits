package ipm

import (
	"context"
	"encoding/csv"
	"fmt"
	"io"
	"os"
	"strconv"
	"sync"
	"time"
)

// Pacing controls how fast a FixtureProducer replays a captured CSV.
type Pacing int

const (
	PacingFast     Pacing = iota // emit frames as fast as the channel accepts them (for tests)
	PacingRealtime               // honour the inter-frame capture_ts deltas (for dev)
)

// FixtureProducer replays a CSV fixture from specs/int/fixtures/ipm/.
// The CSV format is exactly what traces/ipm_parser.py produces.
//
// Pause/Resume allows E2E tests to start the producer in a held state
// and release it at a precise moment (e.g. during the ATTENTION phase
// of race mode) so stroke arrival aligns with a deterministic UI event.
// Multiple pause/resume cycles are supported so tests can simulate a
// mid-workout phone call (pause → assert Pausiert chip → resume →
// assert chip gone + distance continues).
type FixtureProducer struct {
	Path   string
	Pacing Pacing

	// mu protects pauseCh. pauseCh is non-nil when the producer is
	// paused; Run() blocks on it until Resume() closes it.
	mu      sync.Mutex
	pauseCh chan struct{} // non-nil iff currently paused
}

// Pause flips the producer into the paused state. Safe to call before
// or during Run(). Idempotent: a second consecutive Pause() is a no-op.
func (p *FixtureProducer) Pause() {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.pauseCh == nil {
		p.pauseCh = make(chan struct{})
	}
	// else: already paused, no-op
}

// Resume releases a paused producer so Run() can begin (or continue)
// emitting frames. Safe to call multiple times and before Run().
// Returns the previous paused state so callers can detect idempotent
// re-invocations.
func (p *FixtureProducer) Resume() (wasPaused bool) {
	p.mu.Lock()
	ch := p.pauseCh
	p.pauseCh = nil
	p.mu.Unlock()
	if ch != nil {
		close(ch)
		return true
	}
	return false
}

// pauseGate returns the current pause channel under the lock. A nil
// return means the producer is not paused. Run() calls this before
// emitting each frame so the pause takes effect within one frame.
func (p *FixtureProducer) pauseGate() chan struct{} {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.pauseCh
}

// Run replays the CSV at the configured pacing. out is closed on
// return (normal EOF, error, or ctx cancellation).
func (p *FixtureProducer) Run(ctx context.Context, out chan<- Frame) error {
	defer close(out)

	// waitIfPaused blocks until Resume() is called (or ctx is done).
	// Called before the file is opened so an initial Pause() holds the
	// producer before any frame is emitted, and again before each frame
	// so a mid-stream Pause() takes effect within one frame boundary.
	waitIfPaused := func() error {
		for {
			ch := p.pauseGate()
			if ch == nil {
				return nil
			}
			select {
			case <-ch:
				// Unblocked; loop to check for a re-pause.
			case <-ctx.Done():
				return ctx.Err()
			}
		}
	}

	if err := waitIfPaused(); err != nil {
		return err
	}

	f, err := os.Open(p.Path)
	if err != nil {
		return fmt.Errorf("fixture open %s: %w", p.Path, err)
	}
	defer f.Close()

	r := csv.NewReader(f)
	header, err := r.Read()
	if err != nil {
		return fmt.Errorf("fixture header: %w", err)
	}
	idx, err := indexHeader(header)
	if err != nil {
		return fmt.Errorf("fixture %s: %w", p.Path, err)
	}

	var prevCaptureTS float64
	first := true
	rowNum := 0

	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}

		// Check for a mid-stream pause before each frame.
		if err := waitIfPaused(); err != nil {
			return err
		}

		rec, err := r.Read()
		if err == io.EOF {
			return nil
		}
		if err != nil {
			return fmt.Errorf("fixture row %d: %w", rowNum, err)
		}
		rowNum++

		captureTS, frame, err := parseRow(rec, idx)
		if err != nil {
			return fmt.Errorf("fixture row %d: %w", rowNum, err)
		}

		if p.Pacing == PacingRealtime && !first {
			delta := captureTS - prevCaptureTS
			if delta > 0 {
				timer := time.NewTimer(time.Duration(delta * float64(time.Second)))
				select {
				case <-timer.C:
				case <-ctx.Done():
					timer.Stop()
					return ctx.Err()
				}
			}
		}

		frame.ReceivedAt = time.Now()

		select {
		case out <- frame:
		case <-ctx.Done():
			return ctx.Err()
		}

		prevCaptureTS = captureTS
		first = false
	}
}

// parseRow decodes one CSV record into a Frame plus its capture_ts for
// pacing. Returns a wrapped error identifying the offending column; the
// caller adds the row number.
// parseRow only needs the capture_ts (for pacing) and the raw_payload
// (which it decodes through the live parser). Other CSV columns are
// pre-decoded values from the original Python script — kept in the
// fixtures for human readability but no longer trusted here, since
// the May-2026 spec revision changed several field boundaries.
func parseRow(rec []string, idx csvIndex) (float64, Frame, error) {
	captureTS, err := parseFloat(rec[idx.captureTS], "capture_ts")
	if err != nil {
		return 0, Frame{}, err
	}
	payload := rec[idx.rawPayload]
	frame, ok := decodeA8Line("A8" + payload)
	if !ok {
		return 0, Frame{}, fmt.Errorf("raw_payload %q: not a well-formed A8 message", payload)
	}
	return captureTS, frame, nil
}

type csvIndex struct {
	captureTS, rawPayload int
}

func indexHeader(h []string) (csvIndex, error) {
	find := func(name string) (int, error) {
		for i, col := range h {
			if col == name {
				return i, nil
			}
		}
		return -1, fmt.Errorf("missing column %q", name)
	}
	var idx csvIndex
	var err error
	if idx.captureTS, err = find("capture_ts"); err != nil {
		return csvIndex{}, err
	}
	if idx.rawPayload, err = find("raw_payload"); err != nil {
		return csvIndex{}, err
	}
	return idx, nil
}

func parseFloat(s, field string) (float64, error) {
	v, err := strconv.ParseFloat(s, 64)
	if err != nil {
		return 0, fmt.Errorf("%s %q: %w", field, s, err)
	}
	return v, nil
}

