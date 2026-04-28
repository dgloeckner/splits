package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"golang.org/x/sync/errgroup"

	"github.com/gloeckner-daniel/home-ergo/internal/api"
	"github.com/gloeckner-daniel/home-ergo/internal/config"
	"github.com/gloeckner-daniel/home-ergo/internal/event"
	"github.com/gloeckner-daniel/home-ergo/internal/ipm"
	"github.com/gloeckner-daniel/home-ergo/internal/pipeline"
	"github.com/gloeckner-daniel/home-ergo/internal/rower"
	"github.com/gloeckner-daniel/home-ergo/internal/session"
	"github.com/gloeckner-daniel/home-ergo/internal/stats"
	"github.com/gloeckner-daniel/home-ergo/internal/storage"
	"github.com/gloeckner-daniel/home-ergo/internal/stream"
	"github.com/gloeckner-daniel/home-ergo/internal/workout"
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
	if err := enforceTLSPolicy(cfg.Addr, cfg.DevMode, os.Getenv); err != nil {
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

	startID, err := storage.MaxStrokeGlobalID(ctx, db.Handle())
	if err != nil {
		return err
	}
	slog.Info("homeergo.resume", "start_id", startID)

	rowerRepo := rower.NewRepo(db.Handle())
	rowerHolder := rower.NewHolder()
	deviceLink := rower.NewDeviceLink(db.Handle())
	// Backfill device_rowers from existing per-device active selections
	// so households who already paired before T4 keep working without
	// re-pairing.
	if _, err := db.Handle().ExecContext(ctx, `
		INSERT OR IGNORE INTO device_rowers(device_id, rower_id)
		SELECT device_id, rower_id FROM device_active_rower`); err != nil {
		return err
	}
	workoutRepo := workout.NewRepo(db.Handle())
	if n, err := workoutRepo.CleanupOrphans(ctx); err != nil {
		slog.Error("workout.cleanup", "err", err)
	} else if n > 0 {
		slog.Info("workout.cleanup", "deleted", n)
	}
	if last, err := rowerRepo.LastActive(ctx); err == nil && last != nil {
		rowerHolder.Set(last.ID, last.Name)
	}

	frames := make(chan ipm.Frame, 64)
	events := make(chan event.Event, 64)
	persistCh := make(chan event.Event, 1024)
	broadcastCh := make(chan event.Event, 256)

	producer := pickProducer(cfg)
	ring := pipeline.NewRing(10000)
	bcast := stream.NewBroadcaster(broadcastCh)
	sessionizer := session.New(session.Options{
		IdleTimeout: cfg.IdleTimeout,
		// Close sessions where frames keep arriving but distance is
		// not advancing (idle ergo broadcast or fixture replay with
		// the user not actually rowing).
		InactivityTimeout: 60 * time.Second,
		ResolveRower: func() (string, string) {
			id, name := rowerHolder.Resolve()
			if id == "" {
				return "local-rower", "Lokal"
			}
			return id, name
		},
		StartID: startID,
		LoadWorkout: func(id string) (*workout.Workout, error) {
			return workoutRepo.GetWorkout(ctx, id)
		},
	})
	dispatcher := &pipeline.Dispatcher{Ring: ring, Persist: persistCh, Broadcast: broadcastCh}
	scheduler := stats.NewRecomputeScheduler(db.Handle())
	persister := &storage.Persister{DB: db.Handle(), Scheduler: scheduler}

	(&storage.BootJanitor{DB: db.Handle(), Scheduler: scheduler}).Run(ctx)

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
			DB:          db.Handle(),
			RowerRepo:   rowerRepo,
			RowerHolder: rowerHolder,
			DeviceLink:  deviceLink,
			WorkoutRepo: workoutRepo,
			Sessionizer:     sessionizer,
			SessionSnapshot: sessionizer,
			Scheduler:       scheduler,
			StartedAt:       time.Now(),
			DeviceCookieSecure: !cfg.DevMode,
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
		// Unblock SSE handlers parked on <-ch so Shutdown can complete
		// fast. Otherwise http.Server.Shutdown waits the full timeout
		// for long-lived SSE connections it cannot terminate itself.
		bcast.CloseAllClients()
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

// enforceTLSPolicy refuses to start in production-like configurations
// when no TLS termination is in evidence. Plain HTTP on a non-localhost
// bind without an explicit proxy hint is almost always a misconfiguration
// that would expose device-pairing cookies and session data in the clear.
func enforceTLSPolicy(addr string, devMode bool, getenv func(string) string) error {
	if devMode {
		return nil
	}
	if isLocalhost(addr) {
		return nil
	}
	if strings.EqualFold(getenv("SPLITS_TLS_TERMINATED_BY"), "proxy") {
		return nil
	}
	return fmt.Errorf("refusing to start: cfg.Addr=%q without TLS. Set SPLITS_DEV_MODE=1 for local dev or SPLITS_TLS_TERMINATED_BY=proxy when behind Caddy/nginx", addr)
}

// isLocalhost reports whether addr binds only the loopback interface.
// A bare ":8080" binds all interfaces and is intentionally NOT considered
// localhost-only.
func isLocalhost(addr string) bool {
	a := strings.ToLower(addr)
	return strings.HasPrefix(a, "127.0.0.1") ||
		strings.HasPrefix(a, "localhost") ||
		strings.HasPrefix(a, "[::1]")
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
