package ipm

import (
	"context"
	"io"
)

// Parse reads raw IPM bytes from r and emits decoded Frames on out.
// It closes out when r returns io.EOF or ctx is cancelled. Malformed
// lines are skipped with a warning on the standard slog logger.
//
// Implementation lands in Task 7.
func Parse(ctx context.Context, r io.Reader, out chan<- Frame) error {
	panic("not implemented")
}
