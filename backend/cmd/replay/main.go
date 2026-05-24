// Command replay re-feeds a persisted session's strokes through the
// live Sessionizer and emits CSV with the same per-stroke values the
// live screen sees (paceSecPer500m, dps, spm, etc.).
//
// Manual debugging tool and the validation substrate called out in
// ADR-0011 / FEAT-0015 Slice 6. Strokes survive session-end (Slice 4),
// so any past session is replayable.
//
// Usage:
//
//	cmd/replay <session_id>
//	cmd/replay --session-id=<session_id>
//
// The live-pace window is controlled by session.LivePaceWindowSec,
// settable via `-ldflags` for replay experiments per ADR-0011.
package main

import (
	"context"
	"database/sql"
	"encoding/csv"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"strconv"
	"sync"
	"time"

	"github.com/gloeckner-daniel/splits/internal/config"
	"github.com/gloeckner-daniel/splits/internal/event"
	"github.com/gloeckner-daniel/splits/internal/ipm"
	"github.com/gloeckner-daniel/splits/internal/session"
	"github.com/gloeckner-daniel/splits/internal/storage"
)

func main() {
	cfg, err := config.Load(os.LookupEnv)
	if err != nil {
		fmt.Fprintln(os.Stderr, "config:", err)
		os.Exit(1)
	}
	sessionID, err := parseArgs(os.Args[1:])
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		fmt.Fprintln(os.Stderr, "usage: replay <session_id> | --session-id=<id>")
		os.Exit(2)
	}
	db, err := storage.Open(cfg.DBPath)
	if err != nil {
		fmt.Fprintln(os.Stderr, "open db:", err)
		os.Exit(1)
	}
	defer db.Close()

	if err := Replay(context.Background(), db.Handle(), sessionID, os.Stdout); err != nil {
		fmt.Fprintln(os.Stderr, "replay:", err)
		os.Exit(1)
	}
}

// parseArgs accepts either a bare session id positional or --session-id=<id>.
func parseArgs(args []string) (string, error) {
	if len(args) == 1 && len(args[0]) > 0 && args[0][0] != '-' {
		return args[0], nil
	}
	fs := flag.NewFlagSet("replay", flag.ContinueOnError)
	fs.SetOutput(io.Discard)
	sessionID := fs.String("session-id", "", "session id to replay")
	if err := fs.Parse(args); err != nil {
		return "", err
	}
	if *sessionID == "" {
		return "", errors.New("session id required")
	}
	return *sessionID, nil
}

// csvHeader is exported so tests can pin the header contract.
var csvHeader = []string{
	"stroke_no",
	"time_sec",
	"distance_m",
	"spm",
	"power_w",
	"cal_per_hr",
	"level",
	"dps",
	"stroke_cycle_sec",
	"pace_sec_per_500m",
	"energy_joules",
	"phase",
}

// Replay loads strokes for sessionID, steps them through a fresh
// Sessionizer, and writes one CSV row per stroke to w. Exposed for the
// smoke test.
func Replay(ctx context.Context, db *sql.DB, sessionID string, w io.Writer) error {
	strokes, err := storage.LoadSessionStrokes(ctx, db, sessionID)
	if err != nil {
		return fmt.Errorf("load strokes: %w", err)
	}
	if len(strokes) == 0 {
		return fmt.Errorf("no strokes for session %q", sessionID)
	}

	rctx, cancel := context.WithCancel(ctx)
	defer cancel()

	in := make(chan ipm.Frame, 1)
	out := make(chan event.Event, 64)
	// Now() advances with each stroke's TimeSec so the sessionizer's
	// idle/inactivity guards never fire during replay (they compare
	// wall-clock deltas, not in-frame deltas). The clock is read by the
	// sessionizer goroutine and advanced by feedStrokes, so go through
	// a mutex.
	base := time.Unix(0, 0).UTC()
	clock := &replayClock{now: base}
	s := session.New(session.Options{
		IdleTimeout:       1 * time.Hour,
		InactivityTimeout: 0,
		RowerID:           "replay",
		RowerName:         "Replay",
		Now:               clock.Now,
	})

	done := make(chan error, 1)
	go func() { done <- s.Run(rctx, in, out) }()

	w2 := csv.NewWriter(w)
	if err := w2.Write(csvHeader); err != nil {
		return err
	}

	// Open a session explicitly so the first frame doesn't get dropped
	// by the "no active session" guard in onFrame.
	s.StartSession("")

	emitErrCh := make(chan error, 1)
	go func() {
		emitErrCh <- feedStrokes(rctx, strokes, in, clock, base)
	}()

	rowsWritten := 0
	expected := len(strokes)
	for rowsWritten < expected {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case ev, ok := <-out:
			if !ok {
				return fmt.Errorf("event stream closed after %d/%d strokes", rowsWritten, expected)
			}
			if ev.Kind != event.KindStroke || ev.Stroke == nil {
				continue
			}
			if err := w2.Write(strokeRow(ev.Stroke)); err != nil {
				return err
			}
			rowsWritten++
		}
	}

	// Stop the sessionizer and drain its goroutine.
	cancel()
	<-done
	if err := <-emitErrCh; err != nil && !errors.Is(err, context.Canceled) {
		return err
	}
	w2.Flush()
	return w2.Error()
}

// replayClock is a mutex-guarded time source shared between the
// sessionizer goroutine (reader, via Now) and the stroke feeder
// (writer). Without the mutex, the race detector flags the read/write
// pair as concurrent — see -race on cmd/replay tests.
type replayClock struct {
	mu  sync.Mutex
	now time.Time
}

func (c *replayClock) Now() time.Time {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.now
}

func (c *replayClock) Set(t time.Time) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.now = t
}

// feedStrokes turns each persisted stroke into an ipm.Frame and pushes
// it onto the sessionizer's input channel, advancing the injected clock
// in lockstep with TimeSec.
func feedStrokes(ctx context.Context, strokes []event.StrokePayload, in chan<- ipm.Frame, clock *replayClock, base time.Time) error {
	defer close(in)
	for _, p := range strokes {
		next := base.Add(time.Duration(p.TimeSec * float64(time.Second)))
		clock.Set(next)
		f := ipm.Frame{
			ReceivedAt: next,
			TimeSec:    p.TimeSec,
			DistanceM:  p.DistanceM,
			// Replay strokes don't preserve the original
			// DeviceSplitPaceSec separately from PaceSecPer500m
			// (the persisted value is the chosen output). Feed it
			// back as the device value so the sessionizer reproduces
			// the same split per stroke instead of falling back to
			// LivePace on every replayed frame.
			DeviceSplitPaceSec: p.PaceSecPer500m,
			SPM:                p.SPM,
			PowerW:             p.PowerW,
			CalPerHr:           p.CalPerHr,
			Level:              p.Level,
			RawPayload:         p.RawPayload,
		}
		select {
		case in <- f:
		case <-ctx.Done():
			return ctx.Err()
		}
	}
	return nil
}

func strokeRow(p *event.StrokePayload) []string {
	return []string{
		strconv.Itoa(p.StrokeNo),
		strconv.FormatFloat(p.TimeSec, 'f', -1, 64),
		strconv.Itoa(p.DistanceM),
		strconv.Itoa(p.SPM),
		strconv.Itoa(p.PowerW),
		strconv.Itoa(p.CalPerHr),
		strconv.Itoa(p.Level),
		strconv.FormatFloat(p.DPS, 'f', -1, 64),
		strconv.FormatFloat(p.StrokeCycleSec, 'f', -1, 64),
		strconv.Itoa(p.PaceSecPer500m),
		strconv.Itoa(p.EnergyJoules),
		p.Phase,
	}
}
