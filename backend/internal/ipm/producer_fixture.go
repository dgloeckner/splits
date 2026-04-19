package ipm

import (
	"context"
	"errors"
)

// Pacing controls how fast a FixtureProducer replays a captured CSV.
type Pacing int

const (
	PacingFast Pacing = iota // emit frames as fast as the channel accepts them (for tests)
	PacingRealtime           // honour the inter-frame capture_ts deltas (for dev)
)

// FixtureProducer replays a CSV fixture from specs/int/fixtures/ipm/.
// The CSV format is exactly what traces/ipm_parser.py produces.
type FixtureProducer struct {
	Path   string
	Pacing Pacing
}

// Run is implemented in Task 10.
func (p *FixtureProducer) Run(ctx context.Context, out chan<- Frame) error {
	close(out)
	return errors.New("not implemented")
}
