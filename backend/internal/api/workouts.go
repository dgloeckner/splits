package api

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/gloeckner-daniel/home-ergo/internal/workout"
)

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
	return mux
}
