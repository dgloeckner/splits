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

	// INT-0001 field layout.
	minutes := mustAtoi(payload[0:3])
	seconds := mustAtoi(payload[3:5])
	tenths := mustAtoi(payload[5:6])

	return Frame{
		TimeSec:    float64(minutes)*60 + float64(seconds) + float64(tenths)/10,
		DistanceM:  mustAtoi(payload[6:10]),
		Marker:     payload[10:13],
		Unknown:    payload[13:16],
		SPM:        mustAtoi(payload[16:18]),
		PowerW:     mustAtoi(payload[18:21]),
		CalPerHr:   mustAtoi(payload[21:24]) * 10,
		Footer:     payload[24:25],
		Level:      mustAtoi(payload[25:27]),
		RawPayload: payload,
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
