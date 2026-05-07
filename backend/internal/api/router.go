package api

import (
	"database/sql"
	"net/http"
	"time"

	"github.com/gloeckner-daniel/splits/internal/ipm"
	"github.com/gloeckner-daniel/splits/internal/pipeline"
	"github.com/gloeckner-daniel/splits/internal/rower"
	"github.com/gloeckner-daniel/splits/internal/stats"
	"github.com/gloeckner-daniel/splits/internal/stream"
	"github.com/gloeckner-daniel/splits/internal/workout"
)

type Inputs struct {
	Ring            *pipeline.Ring
	Broadcaster     *stream.Broadcaster
	DB              *sql.DB
	RowerRepo       *rower.Repo
	RowerHolder     *rower.Holder
	DeviceLink      *rower.DeviceLink
	WorkoutRepo     *workout.Repo
	Sessionizer     SessionAttacher
	SessionSnapshot stream.Snapshotter
	Scheduler       *stats.RecomputeScheduler
	StartedAt       time.Time
	// DeviceCookieSecure is forwarded to the DeviceCookie middleware as
	// the Secure flag. Set true in production, false in dev (plain HTTP).
	DeviceCookieSecure bool
	// PublicURL is the externally-reachable base URL used to build
	// absolute pairing URLs encoded into QR codes. Empty falls back to
	// "https://" + request Host.
	PublicURL string
	// DeviceMonitor exposes IPM serial connectivity state to the
	// frontend via /api/v1/device. Optional — nil → endpoint omitted
	// (e.g. fixture-only test runs).
	DeviceMonitor *ipm.DeviceMonitor
}

func NewRouter(in Inputs) http.Handler {
	mux := http.NewServeMux()

	// gate wraps a handler with RequireRower — 401 when the calling
	// device has no paired rower. Bypass routes (health, pair
	// exchange, active-rower probe, POST /rowers under bootstrap)
	// are registered without it. See ADR-0005.
	gate := RequireRower(in.DeviceLink)

	mux.HandleFunc("GET /api/health", healthHandler)
	mux.Handle("GET /api/v1/stream",
		gate(stream.NewHandler(in.Ring, in.Broadcaster, in.SessionSnapshot, in.DeviceMonitor)))
	if in.DeviceMonitor != nil {
		mux.Handle("GET /api/v1/device", gate(DeviceStatusHandler(in.DeviceMonitor)))
	}

	var activeIDer ActiveSessionIDer
	if in.SessionSnapshot != nil {
		if a, ok := in.SessionSnapshot.(ActiveSessionIDer); ok {
			activeIDer = a
		}
	}
	sessions := SessionsHandler(in.DB, in.Scheduler, activeIDer)
	mux.Handle("GET /api/v1/sessions", gate(sessions))
	mux.Handle("GET /api/v1/sessions/{id}", gate(sessions))
	mux.Handle("GET /api/v1/sessions/{id}/samples", gate(sessions))
	mux.Handle("GET /api/v1/sessions/{id}/insights", gate(sessions))
	mux.Handle("DELETE /api/v1/sessions/{id}", gate(sessions))

	rowers := RowersHandler(in.RowerRepo, in.DeviceLink)
	// GET /rowers is hit by RowerGate before any pairing exists.
	// The handler itself returns an empty list for unpaired devices
	// so we don't leak household membership; paired devices get the
	// full list.
	mux.Handle("GET /api/v1/rowers", rowers)
	// POST /api/v1/rowers gates itself: bootstrap-when-empty, paired-otherwise.
	mux.Handle("POST /api/v1/rowers", rowers)
	mux.Handle("PATCH /api/v1/rowers/{id}", gate(rowers))

	pairingStore := rower.NewPairingStore(in.DB)
	mux.Handle("POST /api/v1/rowers/{id}/pairing-tokens",
		gate(MintTokenHandler(in.RowerRepo, in.DeviceLink, pairingStore, in.PublicURL)))
	// /pair is the entry-point for unpaired devices joining via QR;
	// the handler enforces token validity itself.
	mux.Handle("POST /api/v1/pair",
		PairExchangeHandler(in.RowerRepo, in.RowerHolder, in.DeviceLink, pairingStore))

	active := ActiveRowerHandler(in.RowerRepo, in.RowerHolder, in.DeviceLink)
	// GET active-rower is the onboarding probe — must respond
	// (404/null) for unpaired devices so RowerGate can route.
	mux.Handle("GET /api/v1/active-rower", active)
	mux.Handle("PUT /api/v1/active-rower", gate(active))

	workouts := WorkoutsHandler(in.WorkoutRepo)
	mux.Handle("POST /api/v1/workouts", gate(workouts))
	mux.Handle("GET /api/v1/workouts/{id}", gate(workouts))
	mux.Handle("GET /api/v1/workouts/last", gate(workouts))

	favs := FavoritesHandler(in.WorkoutRepo)
	mux.Handle("POST /api/v1/favorites", gate(favs))
	mux.Handle("GET /api/v1/favorites", gate(favs))
	mux.Handle("DELETE /api/v1/favorites/{id}", gate(favs))

	trends := TrendsHandler(in.DB, in.RowerRepo)
	mux.Handle("GET /api/v1/rowers/{id}/trends", gate(trends))

	pbs := PBsHandler(in.DB, in.RowerRepo)
	mux.Handle("GET /api/v1/rowers/{id}/pbs", gate(pbs))
	mux.Handle("GET /api/v1/rowers/{id}/pbs/history", gate(pbs))
	mux.Handle("GET /api/v1/rowers/{id}/lifetime", gate(pbs))
	mux.Handle("GET /api/v1/rowers/{id}/achievements", gate(pbs))
	mux.Handle("GET /api/v1/sessions/{id}/pb-banners", gate(pbs))

	mux.Handle("GET /api/v1/workouts/{id}/opponents", gate(WorkoutOpponentsHandler(in.DB)))

	if in.Sessionizer != nil {
		mux.Handle("POST /api/v1/workouts/{id}/attach",
			gate(WorkoutAttachHandler(in.WorkoutRepo, in.Sessionizer)))
		mux.Handle("POST /api/v1/session/start", gate(SessionStartHandler(in.Sessionizer)))
		mux.Handle("POST /api/v1/session/end", gate(SessionEndHandler(in.Sessionizer)))
	}
	if in.SessionSnapshot != nil {
		if p, ok := in.SessionSnapshot.(SessionActiveProvider); ok {
			mux.Handle("GET /api/v1/session/active", gate(SessionActiveHandler(p)))
		}
	}

	mux.Handle("GET /debug/ingest", gate(DebugIngestHandler(DebugIngestInputs{
		Ring:        in.Ring,
		Broadcaster: in.Broadcaster,
		StartedAt:   in.StartedAt,
	})))
	mws := []Middleware{
		Recover(),
		Logging(),
		SecurityHeaders(),
		CORSGuard(allowedHostFromPublicURL(in.PublicURL)),
		BodyLimit(0),
		DeviceCookie(DeviceCookieOptions{Secure: in.DeviceCookieSecure}),
		RateLimit(RateLimitOptions{}),
	}
	if in.RowerHolder != nil {
		mws = append(mws, StatsVersionHeader(in.DB, in.RowerHolder))
	}
	return Chain(mux, mws...)
}
