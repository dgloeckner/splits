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

	// Producer goroutine: read frames, print to stdout.
	frames := make(chan ipm.Frame, 64)
	wg.Add(1)
	var producerErr error
	go func() {
		defer wg.Done()
		producerErr = producer.Run(ctx, frames)
	}()

	// Stdout printer goroutine.
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

	// HTTP server.
	srv := &http.Server{
		Addr:              cfg.Addr,
		Handler:           api.NewRouter(),
		ReadHeaderTimeout: 10 * time.Second,
	}
	serverErrCh := make(chan error, 1)
	go func() {
		err := srv.ListenAndServe()
		if err != nil && !errors.Is(err, http.ErrServerClosed) {
			serverErrCh <- err
			return
		}
		serverErrCh <- nil
	}()

	// Wait for shutdown signal or HTTP error.
	select {
	case <-ctx.Done():
		slog.Info("homeergo.shutdown", "reason", "signal")
	case err := <-serverErrCh:
		if err != nil {
			cancel()
			wg.Wait()
			return err
		}
	}

	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), httpShutdownTimeout)
	defer shutdownCancel()
	if err := srv.Shutdown(shutdownCtx); err != nil {
		slog.Error("http.shutdown", "err", err)
	}

	wg.Wait()

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
