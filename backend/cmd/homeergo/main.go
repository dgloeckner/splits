package main

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"sync"
	"syscall"
	"time"

	"github.com/gloeckner-daniel/home-ergo/internal/api"
	"github.com/gloeckner-daniel/home-ergo/internal/config"
	"github.com/gloeckner-daniel/home-ergo/internal/ipm"
)

const httpShutdownTimeout = 30 * time.Second

func main() {
	if err := run(); err != nil {
		slog.Error("homeergo.exit", "err", err)
		os.Exit(1)
	}
}

func run() error {
	cfg, err := config.Load(os.LookupEnv)
	if err != nil {
		return err
	}
	configureLogger(cfg.LogLevel)

	slog.Info("homeergo.start",
		"addr", cfg.Addr,
		"fixture", cfg.Fixture,
		"fixture_rate", cfg.FixtureRate,
		"serial_port", cfg.SerialPort,
	)

	ctx, cancel := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer cancel()

	producer := pickProducer(cfg)

	var wg sync.WaitGroup

	// Producer goroutine: read frames from the configured source. Closes
	// the producerDone channel on return so the main select learns that
	// the input is exhausted (fixture EOF) or failed hard.
	frames := make(chan ipm.Frame, 64)
	producerDone := make(chan struct{})
	var producerErr error
	wg.Add(1)
	go func() {
		defer wg.Done()
		defer close(producerDone)
		producerErr = producer.Run(ctx, frames)
	}()

	// Stdout printer goroutine drains frames until the producer closes it.
	wg.Add(1)
	go func() {
		defer wg.Done()
		enc := json.NewEncoder(os.Stdout)
		for f := range frames {
			if err := enc.Encode(makeFrameLine(f)); err != nil {
				slog.Error("stdout.write", "err", err)
				return
			}
		}
	}()

	// HTTP server. ListenAndServe returns http.ErrServerClosed on a clean
	// Shutdown; anything else is a real listen/serve error.
	srv := &http.Server{
		Addr:              cfg.Addr,
		Handler:           api.NewRouter(),
		ReadHeaderTimeout: 10 * time.Second,
	}
	serverErrCh := make(chan error, 1)
	go func() {
		err := srv.ListenAndServe()
		if errors.Is(err, http.ErrServerClosed) {
			err = nil
		}
		serverErrCh <- err
	}()

	// Wait for the first exit signal: user-sent signal, HTTP listener
	// failure, or producer completion (fixture EOF or unrecoverable
	// producer error). Whichever arrives, we tear everything down the
	// same way: cancel the context, Shutdown the HTTP server, wait for
	// goroutines. Returning the correct error is the only path-specific
	// difference.
	var runErr error
	select {
	case <-ctx.Done():
		slog.Info("homeergo.shutdown", "reason", "signal")
	case err := <-serverErrCh:
		if err != nil {
			slog.Info("homeergo.shutdown", "reason", "http_error", "err", err)
			runErr = err
		} else {
			// ListenAndServe returned nil without a Shutdown call —
			// effectively impossible, but tolerate it.
			slog.Info("homeergo.shutdown", "reason", "http_closed")
		}
	case <-producerDone:
		slog.Info("homeergo.shutdown", "reason", "producer_done")
	}

	cancel() // unblock any stage still parked on ctx
	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), httpShutdownTimeout)
	defer shutdownCancel()
	if err := srv.Shutdown(shutdownCtx); err != nil {
		slog.Error("http.shutdown", "err", err)
	}

	// Drain any pending serverErrCh send so its goroutine can exit; we
	// have already recorded the server error if there was one.
	select {
	case <-serverErrCh:
	default:
	}

	wg.Wait()

	if runErr != nil {
		return runErr
	}
	if producerErr != nil && !errors.Is(producerErr, context.Canceled) {
		return producerErr
	}
	return nil
}

func pickProducer(cfg *config.Config) ipm.Producer {
	if cfg.Fixture != "" {
		pacing := ipm.PacingRealtime
		if cfg.FixtureRate == "fast" {
			pacing = ipm.PacingFast
		}
		return &ipm.FixtureProducer{Path: cfg.Fixture, Pacing: pacing}
	}
	return &ipm.SerialProducer{Port: cfg.SerialPort, Baud: cfg.SerialBaud}
}

// frameLine is a compact stdout representation — intentionally separate
// from event.Event so the stdout format can evolve independently.
type frameLine struct {
	TimeSec    float64 `json:"time_sec"`
	DistanceM  int     `json:"distance_m"`
	SPM        int     `json:"spm"`
	PowerW     int     `json:"power_w"`
	CalPerHr   int     `json:"cal_per_hr"`
	Level      int     `json:"level"`
	RawPayload string  `json:"raw_payload"`
}

func makeFrameLine(f ipm.Frame) frameLine {
	return frameLine{
		TimeSec: f.TimeSec, DistanceM: f.DistanceM, SPM: f.SPM,
		PowerW: f.PowerW, CalPerHr: f.CalPerHr, Level: f.Level,
		RawPayload: f.RawPayload,
	}
}

func configureLogger(level string) {
	var l slog.Level
	switch level {
	case "debug":
		l = slog.LevelDebug
	case "warn":
		l = slog.LevelWarn
	case "error":
		l = slog.LevelError
	default:
		l = slog.LevelInfo
	}
	h := slog.NewJSONHandler(os.Stderr, &slog.HandlerOptions{Level: l})
	slog.SetDefault(slog.New(h))
}
