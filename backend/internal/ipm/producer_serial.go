package ipm

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"go.bug.st/serial"
	"go.bug.st/serial/enumerator"
)

const (
	ftdiVID = "0403"
	ftdiPID = "6001"
)

// SerialProducer opens the IPM serial port and streams decoded Frames
// on out. Run loops on connection failures (no FTDI attached, port
// disappears, read I/O error) and never returns until ctx is
// cancelled — the IPM's USB cable can be unplugged and replugged at
// runtime. A DeviceMonitor (optional) records connectivity for the
// /api/v1/device endpoint.
type SerialProducer struct {
	Port    string         // empty = auto-detect FTDI FT232R (0403:6001)
	Baud    int            // e.g. 9600
	Monitor *DeviceMonitor // optional; nil = no status reporting

	// Backoff between reconnect attempts. Zero = sane defaults
	// (1 s → 30 s exponential).
	InitialBackoff time.Duration
	MaxBackoff     time.Duration
}

// Run is non-failing: even when no FTDI is attached at boot the
// process stays up and the producer keeps probing. The Frame channel
// is closed exactly once, when ctx is cancelled.
func (p *SerialProducer) Run(ctx context.Context, out chan<- Frame) error {
	defer close(out)

	initial := p.InitialBackoff
	if initial <= 0 {
		initial = time.Second
	}
	maxBackoff := p.MaxBackoff
	if maxBackoff <= 0 {
		maxBackoff = 30 * time.Second
	}
	backoff := initial

	for {
		if err := ctx.Err(); err != nil {
			return err
		}
		err := p.runOnce(ctx, out)
		if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) || ctx.Err() != nil {
			return ctx.Err()
		}
		if p.Monitor != nil {
			p.Monitor.MarkDisconnected(err)
		}
		slog.Warn("ipm.serial.disconnected", "err", err, "retry_in", backoff)
		select {
		case <-time.After(backoff):
		case <-ctx.Done():
			return ctx.Err()
		}
		// Exponential backoff capped at maxBackoff.
		if backoff < maxBackoff {
			backoff *= 2
			if backoff > maxBackoff {
				backoff = maxBackoff
			}
		}
	}
}

// runOnce attempts to open the port and parse one stream. Returns the
// reason it stopped (autodetect failed, open failed, read error, EOF).
// Never closes out — the caller's defer owns that.
func (p *SerialProducer) runOnce(ctx context.Context, out chan<- Frame) error {
	port := p.Port
	if port == "" {
		found, err := autodetectFTDI()
		if err != nil {
			return err
		}
		port = found
	}

	slog.Info("ipm.serial.open", "port", port, "baud", p.Baud)
	sp, err := serial.Open(port, &serial.Mode{BaudRate: p.Baud})
	if err != nil {
		return fmt.Errorf("serial open %s: %w", port, err)
	}
	defer sp.Close()

	if p.Monitor != nil {
		p.Monitor.MarkConnected(port)
	}

	// Unblock an in-flight Read when ctx is cancelled.
	done := make(chan struct{})
	defer close(done)
	go func() {
		select {
		case <-ctx.Done():
			_ = sp.Close()
		case <-done:
		}
	}()

	// Touch the monitor as frames flow so the UI can distinguish "port
	// alive, rower idle" from "port gone".
	relay := make(chan Frame, cap(out))
	relayDone := make(chan struct{})
	go func() {
		defer close(relayDone)
		for f := range relay {
			if p.Monitor != nil {
				p.Monitor.Touch()
			}
			select {
			case out <- f:
			case <-ctx.Done():
				return
			}
		}
	}()

	err = parseLoop(ctx, sp, relay)
	close(relay)
	<-relayDone
	if err == nil {
		err = errors.New("serial reader returned EOF")
	}
	return err
}

func autodetectFTDI() (string, error) {
	ports, err := enumerator.GetDetailedPortsList()
	if err != nil {
		return "", fmt.Errorf("enumerate serial: %w", err)
	}
	for _, p := range ports {
		if strings.EqualFold(p.VID, ftdiVID) && strings.EqualFold(p.PID, ftdiPID) {
			return p.Name, nil
		}
	}
	return "", fmt.Errorf("no FTDI FT232R (VID:PID %s:%s) attached", ftdiVID, ftdiPID)
}
