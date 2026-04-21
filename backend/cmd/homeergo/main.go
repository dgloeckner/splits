package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"golang.org/x/sync/errgroup"

	"github.com/gloeckner-daniel/home-ergo/internal/api"
	"github.com/gloeckner-daniel/home-ergo/internal/config"
	"github.com/gloeckner-daniel/home-ergo/internal/event"
	"github.com/gloeckner-daniel/home-ergo/internal/ipm"
	"github.com/gloeckner-daniel/home-ergo/internal/pipeline"
	"github.com/gloeckner-daniel/home-ergo/internal/session"
	"github.com/gloeckner-daniel/home-ergo/internal/storage"
	"github.com/gloeckner-daniel/home-ergo/internal/stream"
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
		"addr", cfg.Addr, "fixture", cfg.Fixture, "fixture_rate", cfg.FixtureRate,
		"serial_port", cfg.SerialPort, "db_path", cfg.DBPath, "idle_timeout", cfg.IdleTimeout,
	)

	ctx, cancel := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer cancel()

	db, err := storage.Open(cfg.DBPath)
	if err != nil {
		return err
	}
	defer db.Close()

	frames := make(chan ipm.Frame, 64)
	events := make(chan event.Event, 64)
	persistCh := make(chan event.Event, 1024)
	broadcastCh := make(chan event.Event, 256)

	producer := pickProducer(cfg)
	ring := pipeline.NewRing(10000)
	bcast := stream.NewBroadcaster(broadcastCh)
	sessionizer := session.New(session.Options{
		IdleTimeout: cfg.IdleTimeout,
		RowerID:     "local-rower",
		RowerName:   "Lokal",
	})
	dispatcher := &pipeline.Dispatcher{Ring: ring, Persist: persistCh, Broadcast: broadcastCh}
	persister := &storage.Persister{DB: db.Handle()}

	g, gctx := errgroup.WithContext(ctx)
	g.Go(func() error { return producer.Run(gctx, frames) })
	g.Go(func() error { return sessionizer.Run(gctx, frames, events) })
	g.Go(func() error { return dispatcher.Run(gctx, events) })
	g.Go(func() error { return persister.Run(gctx, persistCh) })
	g.Go(func() error { return bcast.Run(gctx) })

	srv := &http.Server{
		Addr: cfg.Addr,
		Handler: api.NewRouter(api.Inputs{
			Ring:        ring,
			Broadcaster: bcast,
			StartedAt:   time.Now(),
		}),
		ReadHeaderTimeout: 10 * time.Second,
	}
	g.Go(func() error {
		err := srv.ListenAndServe()
		if errors.Is(err, http.ErrServerClosed) {
			return nil
		}
		return err
	})
	g.Go(func() error {
		<-gctx.Done()
		sctx, scancel := context.WithTimeout(context.Background(), httpShutdownTimeout)
		defer scancel()
		return srv.Shutdown(sctx)
	})

	if err := g.Wait(); err != nil && !errors.Is(err, context.Canceled) {
		return err
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
