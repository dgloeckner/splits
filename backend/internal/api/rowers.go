package api

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/gloeckner-daniel/home-ergo/internal/rower"
)

func RowersHandler(repo *rower.Repo) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/v1/rowers", func(w http.ResponseWriter, r *http.Request) {
		list, err := repo.List(r.Context())
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		if list == nil {
			list = []rower.Rower{}
		}
		writeJSON(w, http.StatusOK, map[string]any{"rowers": list})
	})
	mux.HandleFunc("POST /api/v1/rowers", func(w http.ResponseWriter, r *http.Request) {
		var in rower.CreateInput
		if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
			http.Error(w, "invalid json", http.StatusBadRequest)
			return
		}
		out, err := repo.Create(r.Context(), in)
		if errors.Is(err, rower.ErrNameRequired) {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		writeJSON(w, http.StatusCreated, out)
	})
	mux.HandleFunc("PATCH /api/v1/rowers/{id}", func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		var in rower.UpdateInput
		if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
			http.Error(w, "invalid json", http.StatusBadRequest)
			return
		}
		out, err := repo.Update(r.Context(), id, in)
		if errors.Is(err, rower.ErrNameRequired) {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
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

func ActiveRowerHandler(repo *rower.Repo, holder *rower.Holder) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/v1/active-rower", func(w http.ResponseWriter, r *http.Request) {
		devID := DeviceIDFromContext(r.Context())
		out, err := repo.GetActiveForDevice(r.Context(), devID)
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
	mux.HandleFunc("PUT /api/v1/active-rower", func(w http.ResponseWriter, r *http.Request) {
		devID := DeviceIDFromContext(r.Context())
		var body struct {
			RowerID string `json:"rower_id"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.RowerID == "" {
			http.Error(w, "rower_id required", http.StatusBadRequest)
			return
		}
		target, err := repo.Get(r.Context(), body.RowerID)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		if target == nil {
			http.Error(w, "rower not found", http.StatusNotFound)
			return
		}
		if err := repo.SetActiveForDevice(r.Context(), devID, body.RowerID); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		holder.Set(target.ID, target.Name)
		writeJSON(w, http.StatusOK, target)
	})
	return mux
}
