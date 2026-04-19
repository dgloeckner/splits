package ipm

import (
	"context"
	"encoding/csv"
	"fmt"
	"io"
	"os"
	"strconv"
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
type FixtureProducer struct {
	Path   string
	Pacing Pacing
}

// Run replays the CSV at the configured pacing. out is closed on
// return (normal EOF, error, or ctx cancellation).
func (p *FixtureProducer) Run(ctx context.Context, out chan<- Frame) error {
	defer close(out)

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
func parseRow(rec []string, idx csvIndex) (float64, Frame, error) {
	captureTS, err := parseFloat(rec[idx.captureTS], "capture_ts")
	if err != nil {
		return 0, Frame{}, err
	}
	timeSec, err := parseFloat(rec[idx.timeSec], "time_sec")
	if err != nil {
		return 0, Frame{}, err
	}
	distanceM, err := parseInt(rec[idx.distanceM], "distance_m")
	if err != nil {
		return 0, Frame{}, err
	}
	spm, err := parseInt(rec[idx.spm], "spm")
	if err != nil {
		return 0, Frame{}, err
	}
	powerW, err := parseInt(rec[idx.powerW], "power_w")
	if err != nil {
		return 0, Frame{}, err
	}
	calPerHr, err := parseInt(rec[idx.calPerHr], "cal_per_hr")
	if err != nil {
		return 0, Frame{}, err
	}
	level, err := parseInt(rec[idx.level], "level")
	if err != nil {
		return 0, Frame{}, err
	}
	return captureTS, Frame{
		TimeSec:    timeSec,
		DistanceM:  distanceM,
		Marker:     rec[idx.marker],
		Unknown:    rec[idx.unknown],
		SPM:        spm,
		PowerW:     powerW,
		CalPerHr:   calPerHr,
		Footer:     rec[idx.footer],
		Level:      level,
		RawPayload: rec[idx.rawPayload],
	}, nil
}

type csvIndex struct {
	captureTS, timeSec, distanceM, spm, powerW, calPerHr, level int
	marker, unknown, footer, rawPayload                         int
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
	cols := []struct {
		name string
		dst  *int
	}{
		{"capture_ts", &idx.captureTS},
		{"time_sec", &idx.timeSec},
		{"distance_m", &idx.distanceM},
		{"spm", &idx.spm},
		{"power_w", &idx.powerW},
		{"cal_per_hr", &idx.calPerHr},
		{"level", &idx.level},
		{"marker", &idx.marker},
		{"unknown_13_16", &idx.unknown},
		{"footer_24_25", &idx.footer},
		{"raw_payload", &idx.rawPayload},
	}
	for _, c := range cols {
		if *c.dst, err = find(c.name); err != nil {
			return csvIndex{}, err
		}
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

func parseInt(s, field string) (int, error) {
	v, err := strconv.Atoi(s)
	if err != nil {
		return 0, fmt.Errorf("%s %q: %w", field, s, err)
	}
	return v, nil
}
