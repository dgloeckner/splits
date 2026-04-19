package ipm

import "context"

// Producer is the source of Frames for the pipeline. SerialProducer
// reads from the FTDI port; FixtureProducer replays a recorded CSV.
// Implementations close out when exhausted or when ctx is cancelled.
type Producer interface {
	Run(ctx context.Context, out chan<- Frame) error
}
