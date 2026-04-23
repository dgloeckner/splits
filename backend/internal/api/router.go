package api

import (
	"database/sql"
	"net/http"
	"time"

	"github.com/gloeckner-daniel/home-ergo/internal/pipeline"
	"github.com/gloeckner-daniel/home-ergo/internal/rower"
	"github.com/gloeckner-daniel/home-ergo/internal/stream"
	"github.com/gloeckner-daniel/home-ergo/internal/workout"
)

type Inputs struct {
	Ring        *pipeline.Ring
	Broadcaster *stream.Broadcaster
	DB          *sql.DB
	RowerRepo   *rower.Repo
	RowerHolder *rower.Holder
	WorkoutRepo *workout.Repo
	Sessionizer SessionAttacher
	StartedAt   time.Time
}

func NewRouter(in Inputs) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/health", healthHandler)
	mux.Handle("GET /api/v1/stream", stream.NewHandler(in.Ring, in.Broadcaster))

	sessions := SessionsHandler(in.DB)
	mux.Handle("GET /api/v1/sessions", sessions)
	mux.Handle("GET /api/v1/sessions/{id}", sessions)
	mux.Handle("GET /api/v1/sessions/{id}/samples", sessions)
	mux.Handle("DELETE /api/v1/sessions/{id}", sessions)

	rowers := RowersHandler(in.RowerRepo)
	mux.Handle("GET /api/v1/rowers", rowers)
	mux.Handle("POST /api/v1/rowers", rowers)
	mux.Handle("PATCH /api/v1/rowers/{id}", rowers)

	active := ActiveRowerHandler(in.RowerRepo, in.RowerHolder)
	mux.Handle("GET /api/v1/active-rower", active)
	mux.Handle("PUT /api/v1/active-rower", active)

	workouts := WorkoutsHandler(in.WorkoutRepo)
	mux.Handle("POST /api/v1/workouts", workouts)
	mux.Handle("GET /api/v1/workouts/{id}", workouts)
	mux.Handle("GET /api/v1/workouts/last", workouts)

	favs := FavoritesHandler(in.WorkoutRepo)
	mux.Handle("POST /api/v1/favorites", favs)
	mux.Handle("GET /api/v1/favorites", favs)
	mux.Handle("DELETE /api/v1/favorites/{id}", favs)

	if in.Sessionizer != nil {
		mux.Handle("POST /api/v1/workouts/{id}/attach", WorkoutAttachHandler(in.WorkoutRepo, in.Sessionizer))
	}

	mux.Handle("GET /debug/ingest", DebugIngestHandler(DebugIngestInputs{
		Ring:        in.Ring,
		Broadcaster: in.Broadcaster,
		StartedAt:   in.StartedAt,
	}))
	return Chain(mux, Recover(), Logging(), DeviceCookie())
}
