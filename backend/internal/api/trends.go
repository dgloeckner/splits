package api

import (
	"context"
	"database/sql"
	"encoding/json"
	"net/http"
	"time"

	"github.com/gloeckner-daniel/splits/internal/rower"
)

// TrendsHandler exposes per-rower aggregate trends for a configurable
// range. Sub-project B in the 2026-04-26 history-trends spec.
func TrendsHandler(db *sql.DB, repo *rower.Repo) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/v1/rowers/{id}/trends", requireRower(repo, getTrends(db)))
	return mux
}

type trendsTotals struct {
	DistanceM int     `json:"distance_m"`
	ActiveSec float64 `json:"active_sec"`
	Sessions  int     `json:"sessions"`
}

// trendsSeriesKey identifies a comparable workout shape. ShapeHash is
// the canonical series key: same params → same hash → same series
// (race-2k and distance-2k share a hash and collapse to one series per
// ADR-0015 2026-05-25 amendment).
type trendsSeriesKey struct {
	ShapeHash string `json:"shape_hash"`
}

// trendsSeriesPoint is one completed session within a series.
type trendsSeriesPoint struct {
	T                 string  `json:"t"`
	SessionID         string  `json:"session_id"`
	TotalDistanceM    int     `json:"total_distance_m"`
	TotalTimeSec      float64 `json:"total_time_sec"`
	AvgPowerW         float64 `json:"avg_power_w"`
	AvgPaceSecPer500m float64 `json:"avg_pace_sec_per_500m"`
	AvgDPS            float64 `json:"avg_dps"`
	AvgSPM            float64 `json:"avg_spm"`
}

// trendsSeries is one comparable-workout-shape group over time.
type trendsSeries struct {
	Key              trendsSeriesKey     `json:"key"`
	ParamsJSON       json.RawMessage     `json:"params"`
	DisplayName      string              `json:"display_name"`
	PBPaceSecPer500m float64             `json:"pb_pace_sec_per_500m,omitempty"`
	Points           []trendsSeriesPoint `json:"points"`
}

type trendsPoint struct {
	T                 string  `json:"t"`
	SessionID         string  `json:"session_id"`
	Mode              string  `json:"mode"`
	ShapeHash         string  `json:"shape_hash,omitempty"`
	DistanceM         int     `json:"distance_m"`
	TimeSec           float64 `json:"time_sec"`
	AvgPaceSecPer500m float64 `json:"avg_pace_sec_per_500m"`
	AvgPowerW         float64 `json:"avg_power_w"`
	AvgSPM            float64 `json:"avg_spm"`
	AvgDPS            float64 `json:"avg_dps"`
	Completed         bool    `json:"completed"`
	DistancePB        bool    `json:"distance_pb"`
}

type trendsResponse struct {
	Window       string         `json:"window"`
	From         string         `json:"from"`
	To           string         `json:"to"`
	Points       []trendsPoint  `json:"points"`
	Series       []trendsSeries `json:"series"`
	Totals       trendsTotals   `json:"totals"`
	Prior        *trendsTotals  `json:"prior,omitempty"`
	StatsVersion int            `json:"stats_version"`
	// LatestSession is the rower's newest session with work, regardless
	// of window, so an empty window can point at it (#50).
	LatestSession *trendsLatest `json:"latest_session,omitempty"`
}

type trendsLatest struct {
	SessionID string `json:"session_id"`
	T         string `json:"t"` // RFC3339, Berlin, like points[].t
}

// berlinLoc is the timezone period bounds operate in. session display
// elsewhere already assumes Berlin local time.
var berlinLoc = mustLoadBerlin()

func mustLoadBerlin() *time.Location {
	loc, err := time.LoadLocation("Europe/Berlin")
	if err != nil {
		return time.UTC
	}
	return loc
}

func getTrends(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		rid := r.PathValue("id")
		key := r.URL.Query().Get("window")
		if key == "" {
			key = "30d"
		}
		now := time.Now().In(berlinLoc)
		win, ok := computeTrendsWindow(key, now)
		if !ok {
			http.Error(w, "invalid window", http.StatusBadRequest)
			return
		}

		lower := win.From
		if win.HasPrior() {
			lower = win.PriorFrom
		}
		var lowerArg any = lower.UTC().Format(time.RFC3339Nano)
		if win.Key == "all" {
			lowerArg = "0001-01-01T00:00:00Z"
		}

		pbSources := map[string]bool{}
		if pbRows, err := db.QueryContext(r.Context(),
			`SELECT DISTINCT source_session_id FROM pb_distance
			 WHERE rower_id = ? AND invalidated_at IS NULL`, rid); err == nil {
			for pbRows.Next() {
				var sid string
				if pbRows.Scan(&sid) == nil {
					pbSources[sid] = true
				}
			}
			pbRows.Close()
		}

		rows, err := db.QueryContext(r.Context(), `
			SELECT s.id, s.started_at, s.total_distance_m, s.total_time_sec,
			       s.avg_power_w, s.avg_pace_sec_per_500m, s.avg_dps, s.avg_spm,
			       w.mode, w.params_json, w.shape_hash
			FROM sessions s
			LEFT JOIN workout w ON w.id = s.workout_id
			WHERE s.rower_id = ? AND s.deleted_at IS NULL AND s.ended_at IS NOT NULL
			  AND COALESCE(s.total_distance_m, 0) > 0
			  AND s.started_at >= ?
			ORDER BY s.started_at ASC`, rid, lowerArg)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		defer rows.Close()

		var totals, prior trendsTotals
		var points []trendsPoint
		var seriesRows []sessionRow
		var latest *trendsLatest

		for rows.Next() {
			var (
				id, startedStr             string
				dist                       sql.NullInt64
				timeSec                    sql.NullFloat64
				avgPower, avgPace          sql.NullFloat64
				avgDPS, avgSPM             sql.NullFloat64
				wMode, wParams, wShapeHash sql.NullString
			)
			if err := rows.Scan(&id, &startedStr, &dist, &timeSec, &avgPower, &avgPace,
				&avgDPS, &avgSPM, &wMode, &wParams, &wShapeHash); err != nil {
				http.Error(w, err.Error(), http.StatusInternalServerError)
				return
			}
			t, err := time.Parse(time.RFC3339Nano, startedStr)
			if err != nil {
				continue
			}
			tBerlin := t.In(berlinLoc)
			// Ascending scan: the last row is the newest session with work.
			latest = &trendsLatest{SessionID: id, T: tBerlin.Format(time.RFC3339)}
			distM := int(dist.Int64)
			secs := timeSec.Float64

			inWindow := !tBerlin.Before(win.From) && !tBerlin.After(win.To)
			if win.Key == "all" {
				inWindow = !tBerlin.After(win.To)
			}
			inPrior := win.HasPrior() && !tBerlin.Before(win.PriorFrom) && tBerlin.Before(win.PriorTo)

			if inPrior {
				prior.DistanceM += distM
				prior.ActiveSec += secs
				prior.Sessions++
				continue
			}
			if !inWindow {
				continue
			}
			totals.DistanceM += distM
			totals.ActiveSec += secs
			totals.Sessions++

			mode := ""
			if wMode.Valid {
				mode = wMode.String
			}
			completed := false
			if wMode.Valid && wParams.Valid {
				completed = isCompletedSession(wMode.String, json.RawMessage(wParams.String), distM, secs)
			}
			points = append(points, trendsPoint{
				T:                 tBerlin.Format(time.RFC3339),
				SessionID:         id,
				Mode:              mode,
				ShapeHash:         wShapeHash.String,
				DistanceM:         distM,
				TimeSec:           secs,
				AvgPaceSecPer500m: avgPace.Float64,
				AvgPowerW:         avgPower.Float64,
				AvgSPM:            avgSPM.Float64,
				AvgDPS:            avgDPS.Float64,
				Completed:         completed,
				DistancePB:        pbSources[id],
			})
			if completed && wShapeHash.Valid {
				seriesRows = append(seriesRows, sessionRow{
					ID:        id,
					StartedAt: tBerlin,
					Mode:      wMode.String,
					Params:    json.RawMessage(wParams.String),
					ShapeHash: wShapeHash.String,
					DistM:     distM,
					TimeSec:   secs,
					AvgPower:  avgPower.Float64,
					AvgPace:   avgPace.Float64,
					AvgDPS:    avgDPS.Float64,
					AvgSPM:    avgSPM.Float64,
				})
			}
		}
		if err := rows.Err(); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}

		// The scan starts at the prior window, so a rower whose newest
		// session is older than that needs one more lookup.
		if latest == nil && win.Key != "all" {
			latest = latestSessionWithWork(r.Context(), db, rid)
		}

		series := assembleSeries(seriesRows)
		attachPBs(r.Context(), db, rid, series)

		if points == nil {
			points = []trendsPoint{}
		}
		out := trendsResponse{
			Window: win.Key,
			From:   win.From.UTC().Format(time.RFC3339),
			To:     win.To.UTC().Format(time.RFC3339),
			Points: points,
			Series: series,
			Totals: totals,
		}
		if win.HasPrior() {
			p := prior
			out.Prior = &p
		}
		out.LatestSession = latest
		var sv sql.NullInt64
		_ = db.QueryRowContext(r.Context(),
			`SELECT stats_version FROM rower_lifetime_stats WHERE rower_id = ?`, rid).Scan(&sv)
		if sv.Valid {
			out.StatsVersion = int(sv.Int64)
		}
		writeJSON(w, http.StatusOK, out)
	}
}

// latestSessionWithWork returns the rower's newest session that the
// trends scan would count (ended, not deleted, distance > 0), or nil.
func latestSessionWithWork(ctx context.Context, db *sql.DB, rid string) *trendsLatest {
	var id, startedStr string
	if err := db.QueryRowContext(ctx, `
		SELECT id, started_at FROM sessions
		WHERE rower_id = ? AND deleted_at IS NULL AND ended_at IS NOT NULL
		  AND COALESCE(total_distance_m, 0) > 0
		ORDER BY started_at DESC LIMIT 1`, rid).Scan(&id, &startedStr); err != nil {
		return nil
	}
	t, err := time.Parse(time.RFC3339Nano, startedStr)
	if err != nil {
		return nil
	}
	return &trendsLatest{SessionID: id, T: t.In(berlinLoc).Format(time.RFC3339)}
}
