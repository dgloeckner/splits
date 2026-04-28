package api

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/gloeckner-daniel/splits/internal/workout"
)

// SessionAttacher tags the next session with a workout ID and can
// start / end the currently open session on demand. Satisfied by
// *session.Sessionizer in production code.
type SessionAttacher interface {
	AttachWorkout(id string)
	StartSession(workoutID string)
	EndSession()
}

func WorkoutAttachHandler(repo *workout.Repo, att SessionAttacher) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		wk, err := repo.GetWorkout(r.Context(), id)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		if wk == nil {
			http.NotFound(w, r)
			return
		}
		att.AttachWorkout(id)
		w.WriteHeader(http.StatusNoContent)
	})
}

func WorkoutsHandler(repo *workout.Repo) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("POST /api/v1/workouts", func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Mode        workout.Mode      `json:"mode"`
			Params      json.RawMessage   `json:"params"`
			Intensity   workout.Intensity `json:"intensity"`
			WarmupSec   int               `json:"warmup_sec"`
			CooldownSec int               `json:"cooldown_sec"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			http.Error(w, "invalid json", http.StatusBadRequest)
			return
		}
		out, err := repo.CreateWorkout(r.Context(), workout.CreateWorkoutInput{
			Mode: body.Mode, ParamsJSON: body.Params, Intensity: body.Intensity,
			WarmupSec: body.WarmupSec, CooldownSec: body.CooldownSec,
		})
		if errors.Is(err, workout.ErrInvalidParams) {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		writeJSON(w, http.StatusCreated, out)
	})
	mux.HandleFunc("GET /api/v1/workouts/{id}", func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		out, err := repo.GetWorkout(r.Context(), id)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		if out == nil {
			http.NotFound(w, r)
			return
		}
		writeJSON(w, http.StatusOK, out)
	})
	mux.HandleFunc("GET /api/v1/workouts/last", func(w http.ResponseWriter, r *http.Request) {
		rowerID := r.URL.Query().Get("rower_id")
		if rowerID == "" {
			http.Error(w, "rower_id required", http.StatusBadRequest)
			return
		}
		out, err := repo.LastWorkoutForRower(r.Context(), rowerID)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		if out == nil {
			http.NotFound(w, r)
			return
		}
		writeJSON(w, http.StatusOK, out)
	})
	return mux
}

func FavoritesHandler(repo *workout.Repo) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("POST /api/v1/favorites", func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			RowerID     string            `json:"rower_id"`
			Name        string            `json:"name"`
			Mode        workout.Mode      `json:"mode"`
			Params      json.RawMessage   `json:"params"`
			Intensity   workout.Intensity `json:"intensity"`
			WarmupSec   int               `json:"warmup_sec"`
			CooldownSec int               `json:"cooldown_sec"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			http.Error(w, "invalid json", http.StatusBadRequest)
			return
		}
		out, err := repo.CreateFavorite(r.Context(), workout.CreateFavoriteInput{
			RowerID: body.RowerID, Name: body.Name, Mode: body.Mode,
			ParamsJSON: body.Params, Intensity: body.Intensity,
			WarmupSec: body.WarmupSec, CooldownSec: body.CooldownSec,
		})
		if errors.Is(err, workout.ErrNameRequired) || errors.Is(err, workout.ErrInvalidParams) {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		writeJSON(w, http.StatusCreated, out)
	})
	mux.HandleFunc("GET /api/v1/favorites", func(w http.ResponseWriter, r *http.Request) {
		rowerID := r.URL.Query().Get("rower_id")
		if rowerID == "" {
			http.Error(w, "rower_id required", http.StatusBadRequest)
			return
		}
		list, err := repo.ListFavorites(r.Context(), rowerID)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"favorites": list})
	})
	mux.HandleFunc("DELETE /api/v1/favorites/{id}", func(w http.ResponseWriter, r *http.Request) {
		if err := repo.DeleteFavorite(r.Context(), r.PathValue("id")); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	})
	return mux
}
