package ipm

import (
	"bufio"
	"context"
	"errors"
	"io"
	"log/slog"
	"strconv"
	"strings"
	"time"
)

// Parse reads raw IPM bytes from r and emits decoded Frames on out.
// It closes out when r returns io.EOF or ctx is cancelled. Malformed
// lines are skipped with a warn log; the loop does not abort on
// individual decode errors (the IPM occasionally emits junk on cold
// boot per INT-0001).
func Parse(ctx context.Context, r io.Reader, out chan<- Frame) error {
	defer close(out)
	return parseLoop(ctx, r, out)
}

// parseLoop is Parse without the close(out). The reconnecting serial
// producer drives this directly so the outer Frame channel survives
// across reader rebinds (re-opens after the IPM USB cable is
// re-plugged).
func parseLoop(ctx context.Context, r io.Reader, out chan<- Frame) error {
	// The IPM is line-oriented with CRLF. bufio.Scanner with the default
	// ScanLines split function strips both \r and \n, which is what we
	// want. The default 64 KiB buffer is ample for 30-byte frames.
	sc := bufio.NewScanner(r)
	sc.Buffer(make([]byte, 0, 4096), 64*1024)

	for sc.Scan() {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}

		line := sc.Text()
		f, ok := decodeA8Line(line)
		if !ok {
			if strings.TrimSpace(line) != "" {
				slog.Warn("ipm.parse.skip", "line", line)
			}
			continue
		}
		f.ReceivedAt = time.Now()

		select {
		case out <- f:
		case <-ctx.Done():
			return ctx.Err()
		}
	}

	if err := sc.Err(); err != nil && !errors.Is(err, io.EOF) {
		return err
	}
	return nil
}

// decodeA8Line decodes one line into a Frame. Returns (zero, false) if
// the line is not a well-formed A8 message. Pure — no time source, no
// side effects — so the caller stamps ReceivedAt.
func decodeA8Line(line string) (Frame, bool) {
	const prefix = "A8"
	if !strings.HasPrefix(line, prefix) {
		return Frame{}, false
	}
	payload := line[len(prefix):]
	if len(payload) != 27 {
		return Frame{}, false
	}
	for i := 0; i < len(payload); i++ {
		if payload[i] < '0' || payload[i] > '9' {
			return Frame{}, false
		}
	}

	// INT-0001 field layout (revised May 2026 — see Frame doc comment).
	// payload[0] is a high-order overflow nibble for elapsed time; in
	// practice always '0' and not surfaced. Reading min from [1:3] and
	// sec from [3:5] (no sub-second component on the wire).
	minutes := mustAtoi(payload[1:3])
	seconds := mustAtoi(payload[3:5])
	splitMin := mustAtoi(payload[11:13])
	splitSec := mustAtoi(payload[13:15])

	return Frame{
		TimeSec:            float64(minutes)*60 + float64(seconds),
		DistanceM:          mustAtoi(payload[5:10]),
		DeviceClass:        payload[10:11],
		DeviceSplitPaceSec: splitMin*60 + splitSec,
		SPM:                mustAtoi(payload[15:18]),
		PowerW:             mustAtoi(payload[18:21]),
		CalPerHr:           mustAtoi(payload[21:25]),
		Level:              mustAtoi(payload[25:27]),
		RawPayload:         payload,
	}, true
}

// mustAtoi assumes the caller validated the input is all ASCII digits.
func mustAtoi(s string) int {
	n, err := strconv.Atoi(s)
	if err != nil {
		panic("ipm: mustAtoi called with non-digits: " + s)
	}
	return n
}
