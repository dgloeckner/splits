package api

import (
	"database/sql"
	"encoding/json"
	"net/http"
)

type RaceOpponent struct {
	SourceSessionID string    `json:"source_session_id"`
	Label           string    `json:"label"`
	TSec            []float64 `json:"t_sec"`
	Split           []float64 `json:"split"`
}

type RaceOpponentsResponse struct {
	Ghost *RaceOpponent `json:"ghost"`
	PB    *RaceOpponent `json:"pb"`
}

func RaceOpponentsHandler(db *sql.DB) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(RaceOpponentsResponse{})
	})
}
