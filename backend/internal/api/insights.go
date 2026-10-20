package api

import (
	"database/sql"
	"net/http"

	"github.com/gloeckner-daniel/splits/internal/insights"
	"github.com/gloeckner-daniel/splits/internal/storage"
)

func getSessionInsights(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		row, err := storage.GetSession(r.Context(), db, id)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		if row == nil {
			http.NotFound(w, r)
			return
		}

		store := insights.NewStore(db)
		findings, err := store.ListForSession(r.Context(), id)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		if findings == nil {
			findings = []insights.Finding{}
		}
		// Rows stored before the contradiction guard existed get it on
		// read, so the cards and the synthesis agree.
		findings = insights.Reconcile(findings)

		body := map[string]any{
			"findings":     findings,
			"synthesis_de": insights.Synthesize(findings),
		}

		// Populate reason only when no findings exist AND the session is
		// ineligible. Re-derive eligibility from SessionRow so the UI can
		// show the right placeholder without needing to persist the reason.
		if len(findings) == 0 {
			var durationSec float64
			if row.TotalTimeSec != nil {
				durationSec = *row.TotalTimeSec
			}
			var distanceM int
			if row.TotalDistanceM != nil {
				distanceM = *row.TotalDistanceM
			}
			meta := insights.SessionMeta{
				WorkoutMode: row.WorkoutMode,
				DurationSec: durationSec,
				DistanceM:   distanceM,
			}
			gate := insights.CheckEligibility(meta)
			if !gate.OK {
				body["reason"] = string(gate.Reason)
			}
		}

		writeJSON(w, http.StatusOK, body)
	}
}
