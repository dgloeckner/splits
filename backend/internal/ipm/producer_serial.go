package ipm

import (
	"context"
	"fmt"
	"log/slog"
	"strings"

	"go.bug.st/serial"
	"go.bug.st/serial/enumerator"
)

const (
	ftdiVID = "0403"
	ftdiPID = "6001"
)

// SerialProducer opens the IPM serial port and streams decoded Frames
// on out. On read error, Run returns — main is responsible for the
// reconnect backoff loop.
type SerialProducer struct {
	Port string // empty = auto-detect FTDI FT232R (0403:6001)
	Baud int    // e.g. 9600
}

// Run opens the port, spawns Parse on the resulting reader, and
// forwards Frames to out.
func (p *SerialProducer) Run(ctx context.Context, out chan<- Frame) error {
	port := p.Port
	if port == "" {
		found, err := autodetectFTDI()
		if err != nil {
			close(out)
			return err
		}
		port = found
	}

	slog.Info("ipm.serial.open", "port", port, "baud", p.Baud)
	sp, err := serial.Open(port, &serial.Mode{BaudRate: p.Baud})
	if err != nil {
		close(out)
		return fmt.Errorf("serial open %s: %w", port, err)
	}
	defer sp.Close()

	// Make reads unblock when ctx is cancelled.
	go func() {
		<-ctx.Done()
		_ = sp.Close()
	}()

	// Parse takes ownership of closing out.
	return Parse(ctx, sp, out)
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
