package main

import (
	"context"
	"database/sql"
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

	"github.com/gloeckner-daniel/splits/internal/api"
	"github.com/gloeckner-daniel/splits/internal/config"
	"github.com/gloeckner-daniel/splits/internal/event"
	"github.com/gloeckner-daniel/splits/internal/ipm"
	"github.com/gloeckner-daniel/splits/internal/pipeline"
	"github.com/gloeckner-daniel/splits/internal/rower"
	"github.com/gloeckner-daniel/splits/internal/session"
	"github.com/gloeckner-daniel/splits/internal/stats"
	"github.com/gloeckner-daniel/splits/internal/storage"
	"github.com/gloeckner-daniel/splits/internal/stream"
	"github.com/gloeckner-daniel/splits/internal/workout"
)

const httpShutdownTimeout = 30 * time.Second

func main() {
	if err := run(); err != nil {
		slog.Error("splits.exit", "err", err)
		os.Exit(1)
	}
}

func run() error {
	cfg, err := config.Load(os.LookupEnv)
	if err != nil {
		return err
	}
	if len(os.Args) >= 2 {
		switch os.Args[1] {
		case "invite", "revoke", "delete-rower", "ls-rowers", "ls-pairings", "ls-tokens":
			cliDB, err := storage.Open(cfg.DBPath)
			if err != nil {
				return err
			}
			defer cliDB.Close()
			baseURL := cfg.PublicURL
			if baseURL == "" {
				baseURL = "https://" + cfg.Addr
			}
			if err := runCLI(context.Background(), cliDB.Handle(), baseURL, os.Args[1:], os.Stdout); err != nil {
				fmt.Fprintln(os.Stderr, err)
				os.Exit(1)
			}
			return nil
		}
	}
	if err := enforceTLSPolicy(cfg.Addr, cfg.DevMode, os.Getenv); err != nil {
		return err
	}
	configureLogger(cfg.LogLevel)
	slog.Info("splits.start",
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
	slog.Info("splits.resume", "start_id", startID)

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

	deviceMonitor := ipm.NewDeviceMonitor()
	producer := pickProducer(cfg, deviceMonitor)
	// fixtureCtl is the resume-control surface exposed to the API
	// layer for POST /test/fixture/resume. nil when no fixture is
	// configured; the handler then returns reason="no_fixture".
	var fixtureCtl api.FixtureResumer
	if fp, ok := unwrapFixture(producer); ok {
		fixtureCtl = &fixtureResumeAdapter{fp: fp}
	}
	ring := pipeline.NewRing(10000)
	bcast := stream.NewBroadcaster(broadcastCh)
	sessionizer := session.New(session.Options{
		IdleTimeout: cfg.IdleTimeout,
		// PauseTimeout: distance frozen for this long triggers the
		// Paused sub-state (idle ergo broadcast or user taking a break).
		PauseTimeout: 10 * time.Second,
		// ResumeWindow: a continuously paused session is closed for good
		// after this duration. Configured via SPLITS_RESUME_WINDOW.
		ResumeWindow: cfg.ResumeWindow,
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
		LivenessChecker: storageLivenessAdapter{db: db.Handle()},
	})
	dispatcher := &pipeline.Dispatcher{Ring: ring, Persist: persistCh, Broadcast: broadcastCh}
	scheduler := stats.NewRecomputeScheduler(db.Handle())
	persister := &storage.Persister{
		DB:        db.Handle(),
		Scheduler: scheduler,
		// Feed session_finalized back into the dispatcher input so the
		// ring + broadcaster + persister fan-out picks it up like any
		// sessionizer-led event. The persister's apply() ignores
		// KindSessionFinalized so the cycle terminates safely.
		Out:   events,
		Stamp: sessionizer.Stamp,
	}

	if err := storage.RecomputeShapes(ctx, db.Handle(), workout.ShapeHash); err != nil {
		slog.Error("boot.recompute_shapes", "err", err)
		// Don't fatal — API still works; affected workouts just won't
		// join trend series until the next successful boot.
	}
	(&storage.BootJanitor{DB: db.Handle(), Scheduler: scheduler}).Run(ctx)
	// FEAT-0015 Slice 3: stale-open janitor sweeps every minute.
	// Threshold is aligned to ResumeWindow so paused sessions are never
	// flagged stale-open before the resume window expires (CONTEXT.md §Stale-open).
	storage.StartStaleJanitor(ctx, db.Handle(), sessionizer, cfg.ResumeWindow)

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
			PublicURL:          cfg.PublicURL,
			DeviceMonitor:      deviceMonitor,
			DevMode:            cfg.DevMode,
			FixtureControl:     fixtureCtl,
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

func pickProducer(cfg *config.Config, monitor *ipm.DeviceMonitor) ipm.Producer {
	if cfg.Fixture != "" {
		pacing := ipm.PacingRealtime
		if cfg.FixtureRate == "fast" {
			pacing = ipm.PacingFast
		}
		fp := &ipm.FixtureProducer{Path: cfg.Fixture, Pacing: pacing}
		if cfg.FixturePaused {
			fp.Pause()
		}
		var p ipm.Producer = fp
		if cfg.FixtureDelay > 0 {
			p = &delayedProducer{inner: p, delay: cfg.FixtureDelay, fixture: fp}
		}
		// Fixture is always "connected" for the UI banner — it's the
		// dev/demo source replacing the IPM, not a real device.
		if monitor != nil {
			monitor.MarkConnected("fixture:" + cfg.Fixture)
		}
		return p
	}
	return &ipm.SerialProducer{
		Port:    cfg.SerialPort,
		Baud:    cfg.SerialBaud,
		Monitor: monitor,
	}
}

// delayedProducer wraps another producer and sleeps the configured
// duration before delegating to it. Used by e2e tests so rower
// onboarding + "Start" click finish before the fixture begins.
type delayedProducer struct {
	inner ipm.Producer
	delay time.Duration
	// fixture is the underlying FixtureProducer for pause/resume
	// control (or nil if delayedProducer wraps something else). Kept
	// alongside `inner` so unwrapFixture can return it without
	// type-introspecting the producer chain.
	fixture *ipm.FixtureProducer
}

func (d *delayedProducer) Run(ctx context.Context, out chan<- ipm.Frame) error {
	select {
	case <-time.After(d.delay):
	case <-ctx.Done():
		close(out)
		return ctx.Err()
	}
	return d.inner.Run(ctx, out)
}

// unwrapFixture returns the FixtureProducer at the heart of `p` if
// there is one. Used to expose Pause/Resume to the api layer without
// teaching every wrapper type how to forward the control surface.
func unwrapFixture(p ipm.Producer) (*ipm.FixtureProducer, bool) {
	switch v := p.(type) {
	case *ipm.FixtureProducer:
		return v, true
	case *delayedProducer:
		if v.fixture != nil {
			return v.fixture, true
		}
	}
	return nil, false
}

// fixtureResumeAdapter bridges *ipm.FixtureProducer (which returns
// only wasPaused) to api.FixtureResumer (which speaks the wire-level
// {started, reason} vocabulary). "already_running" is the only reason
// surfaced for now; future producers may add more.
// storageLivenessAdapter bridges storage.CheckSessionLiveness to
// session.SessionLivenessChecker. Owned by main so storage stays free
// of a `session` import.
type storageLivenessAdapter struct{ db *sql.DB }

func (a storageLivenessAdapter) CheckSessionLiveness(ctx context.Context, id string) session.SessionStatus {
	switch storage.CheckSessionLiveness(ctx, a.db, id) {
	case storage.LivenessLive:
		return session.SessionStatusLive
	case storage.LivenessStaleOpen:
		return session.SessionStatusStaleOpen
	case storage.LivenessEnded:
		return session.SessionStatusEnded
	case storage.LivenessMissing:
		return session.SessionStatusMissing
	default:
		return session.SessionStatusUnknown
	}
}

type fixtureResumeAdapter struct{ fp *ipm.FixtureProducer }

func (a *fixtureResumeAdapter) Resume() (bool, string) {
	if a.fp.Resume() {
		return true, ""
	}
	return false, "already_running"
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
