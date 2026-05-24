package api

import (
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

type trendsPeriod struct {
	Label string `json:"label"`
	From  string `json:"from"`
	To    string `json:"to"`
}

type perfPoint struct {
	T                 string  `json:"t"`
	AvgPowerW         float64 `json:"avg_power_w"`
	AvgPaceSecPer500m float64 `json:"avg_pace_sec_per_500m"`
}

type effPoint struct {
	T       string  `json:"t"`
	AvgDPS  float64 `json:"avg_dps"`
	AvgSPI  float64 `json:"avg_spi"`
}

// trendsSeriesKey identifies a comparable workout shape. ShapeHash
// alone is insufficient because `race {meters:2000}` and
// `distance {meters:2000}` share a hash by design (see
// workout/hash_test.go TestShapeHashRaceEqualsDistance). ADR-0015
// requires them to be distinct series, so we key on (mode, hash).
type trendsSeriesKey struct {
	Mode      string `json:"mode"`
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
	AvgSPI            float64 `json:"avg_spi"`
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

type performanceBlock struct {
	Points            []perfPoint `json:"points"`
	AvgPowerW         float64     `json:"avg_power_w"`
	AvgPaceSecPer500m float64     `json:"avg_pace_sec_per_500m"`
}

type efficiencyBlock struct {
	Points    []effPoint `json:"points"`
	AvgDPS    float64    `json:"avg_dps"`
	AvgSPI    float64    `json:"avg_spi"`
	DeltaDPS  float64    `json:"delta_dps"`
	DeltaSPI  float64    `json:"delta_spi"`
}

type trendsResponse struct {
	Range            string           `json:"range"`
	Period           trendsPeriod     `json:"period"`
	Totals           trendsTotals     `json:"totals"`
	Prior            *trendsTotals    `json:"prior,omitempty"`
	Performance      performanceBlock `json:"performance"`
	Efficiency       efficiencyBlock  `json:"efficiency"`
	Series           []trendsSeries   `json:"series"`
	EfficiencySeries []trendsSeries   `json:"efficiency_series"`
	StatsVersion     int              `json:"stats_version"`
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
		rng := r.URL.Query().Get("range")
		if rng == "" {
			rng = "month"
		}
		switch rng {
		case "week", "month", "year", "all":
		default:
			http.Error(w, "invalid range", http.StatusBadRequest)
			return
		}

		now := time.Now().In(berlinLoc)
		periodFrom, periodTo, label := computePeriodBounds(rng, now)
		var priorFrom, priorTo time.Time
		if rng != "all" {
			priorFrom, priorTo = computePriorBounds(rng, periodFrom, periodTo)
		}
		chartFrom, chartTo := computeChartWindow(rng, now)

		// Lower bound = min of all needed windows.
		lower := periodFrom
		if rng != "all" && priorFrom.Before(lower) {
			lower = priorFrom
		}
		if chartFrom.Before(lower) {
			lower = chartFrom
		}

		var lowerArg any
		if rng == "all" {
			lowerArg = "0001-01-01T00:00:00Z"
		} else {
			lowerArg = lower.UTC().Format(time.RFC3339Nano)
		}

		rows, err := db.QueryContext(r.Context(), `
			SELECT s.id, s.started_at, s.total_distance_m, s.total_time_sec,
			       s.avg_power_w, s.avg_pace_sec_per_500m, s.avg_dps, s.avg_spi, s.avg_spm,
			       w.mode, w.params_json, w.shape_hash
			FROM sessions s
			LEFT JOIN workout w ON w.id = s.workout_id
			WHERE s.rower_id = ? AND s.deleted_at IS NULL AND s.ended_at IS NOT NULL
			  AND s.started_at >= ?
			ORDER BY s.started_at ASC`, rid, lowerArg)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		defer rows.Close()

		var totals, prior trendsTotals
		var perfPts []perfPoint
		var effPts []effPoint
		var perfPowerSum, perfPaceSum float64
		var perfPowerN, perfPaceN int
		var effDPSSum, effSPISum float64
		var effDPSN, effSPIN int

		// 14-day delta accumulators (chart window only).
		// recent = (now-14d, now]; previous = (now-28d, now-14d]
		recentCutoff := now.Add(-14 * 24 * time.Hour)
		priorCutoff := now.Add(-28 * 24 * time.Hour)
		var recentDPSSum, recentSPISum, prevDPSSum, prevSPISum float64
		var recentDPSN, recentSPIN, prevDPSN, prevSPIN int

		var seriesRows []sessionRow

		for rows.Next() {
			var (
				id                         string
				startedStr                 string
				dist                       sql.NullInt64
				timeSec                    sql.NullFloat64
				avgPower, avgPace          sql.NullFloat64
				avgDPS, avgSPI, avgSPM     sql.NullFloat64
				wMode, wParams, wShapeHash sql.NullString
			)
			if err := rows.Scan(&id, &startedStr, &dist, &timeSec, &avgPower, &avgPace, &avgDPS, &avgSPI, &avgSPM,
				&wMode, &wParams, &wShapeHash); err != nil {
				http.Error(w, err.Error(), http.StatusInternalServerError)
				return
			}
			t, err := time.Parse(time.RFC3339Nano, startedStr)
			if err != nil {
				continue
			}
			tBerlin := t.In(berlinLoc)
			distM := int(dist.Int64)
			secs := timeSec.Float64

			inPeriod := !tBerlin.Before(periodFrom) && tBerlin.Before(periodTo)
			inPrior := rng != "all" && !tBerlin.Before(priorFrom) && tBerlin.Before(priorTo)
			inChart := !tBerlin.Before(chartFrom) && tBerlin.Before(chartTo)

			if inPeriod {
				totals.DistanceM += distM
				totals.ActiveSec += secs
				totals.Sessions++
			}
			if inPrior {
				prior.DistanceM += distM
				prior.ActiveSec += secs
				prior.Sessions++
			}
			if inChart && distM > 0 {
				ts := tBerlin.Format(time.RFC3339)
				if avgPower.Valid && avgPower.Float64 > 0 {
					perfPowerSum += avgPower.Float64
					perfPowerN++
				}
				if avgPace.Valid && avgPace.Float64 > 0 {
					perfPaceSum += avgPace.Float64
					perfPaceN++
				}
				if avgDPS.Valid && avgDPS.Float64 > 0 {
					effDPSSum += avgDPS.Float64
					effDPSN++
				}
				if avgSPI.Valid && avgSPI.Float64 > 0 {
					effSPISum += avgSPI.Float64
					effSPIN++
				}
				perfPts = append(perfPts, perfPoint{
					T:                 ts,
					AvgPowerW:         avgPower.Float64,
					AvgPaceSecPer500m: avgPace.Float64,
				})
				effPts = append(effPts, effPoint{
					T:      ts,
					AvgDPS: avgDPS.Float64,
					AvgSPI: avgSPI.Float64,
				})
				if !tBerlin.Before(recentCutoff) {
					if avgDPS.Valid && avgDPS.Float64 > 0 {
						recentDPSSum += avgDPS.Float64
						recentDPSN++
					}
					if avgSPI.Valid && avgSPI.Float64 > 0 {
						recentSPISum += avgSPI.Float64
						recentSPIN++
					}
				} else if !tBerlin.Before(priorCutoff) {
					if avgDPS.Valid && avgDPS.Float64 > 0 {
						prevDPSSum += avgDPS.Float64
						prevDPSN++
					}
					if avgSPI.Valid && avgSPI.Float64 > 0 {
						prevSPISum += avgSPI.Float64
						prevSPIN++
					}
				}
			}
			if inChart && wMode.Valid && wParams.Valid && wShapeHash.Valid {
				params := json.RawMessage(wParams.String)
				if isCompletedSession(wMode.String, params, distM, secs) {
					seriesRows = append(seriesRows, sessionRow{
						ID:        id,
						StartedAt: tBerlin,
						Mode:      wMode.String,
						Params:    params,
						ShapeHash: wShapeHash.String,
						DistM:     distM,
						TimeSec:   secs,
						AvgPower:  avgPower.Float64,
						AvgPace:   avgPace.Float64,
						AvgDPS:    avgDPS.Float64,
						AvgSPI:    avgSPI.Float64,
						AvgSPM:    avgSPM.Float64,
					})
				}
			}
		}
		if err := rows.Err(); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}

		series := assembleSeries(seriesRows)
		attachPBs(r.Context(), db, rid, series)
		// Both Leistung and Effizienz currently expose the same underlying
		// series. Future ADR-0015 follow-up may split Effizienz off — but
		// that grouping happens client-side, so the response shape stays
		// symmetric.
		effSeries := series

		mean := func(sum float64, n int) float64 {
			if n == 0 {
				return 0
			}
			return sum / float64(n)
		}

		out := trendsResponse{
			Range: rng,
			Period: trendsPeriod{
				Label: label,
				From:  periodFrom.UTC().Format(time.RFC3339),
				To:    periodTo.UTC().Format(time.RFC3339),
			},
			Totals: totals,
			Performance: performanceBlock{
				Points:            perfPtsOrEmpty(perfPts),
				AvgPowerW:         mean(perfPowerSum, perfPowerN),
				AvgPaceSecPer500m: mean(perfPaceSum, perfPaceN),
			},
			Efficiency: efficiencyBlock{
				Points:   effPtsOrEmpty(effPts),
				AvgDPS:   mean(effDPSSum, effDPSN),
				AvgSPI:   mean(effSPISum, effSPIN),
				DeltaDPS: mean(recentDPSSum, recentDPSN) - mean(prevDPSSum, prevDPSN),
				DeltaSPI: mean(recentSPISum, recentSPIN) - mean(prevSPISum, prevSPIN),
			},
			Series:           series,
			EfficiencySeries: effSeries,
		}
		if rng != "all" {
			p := prior
			out.Prior = &p
		}

		// stats_version (best-effort; unset = 0).
		var sv sql.NullInt64
		_ = db.QueryRowContext(r.Context(),
			`SELECT stats_version FROM rower_lifetime_stats WHERE rower_id = ?`, rid).Scan(&sv)
		if sv.Valid {
			out.StatsVersion = int(sv.Int64)
		}

		writeJSON(w, http.StatusOK, out)
	}
}

func perfPtsOrEmpty(p []perfPoint) []perfPoint {
	if p == nil {
		return []perfPoint{}
	}
	return p
}
func effPtsOrEmpty(p []effPoint) []effPoint {
	if p == nil {
		return []effPoint{}
	}
	return p
}

// computePeriodBounds returns [from, to) for the active period plus the
// localized German label. Bounds are in Berlin local time.
func computePeriodBounds(rng string, now time.Time) (time.Time, time.Time, string) {
	switch rng {
	case "week":
		from := startOfISOWeek(now)
		return from, from.AddDate(0, 0, 7), "Diese Woche"
	case "month":
		from := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, now.Location())
		return from, from.AddDate(0, 1, 0), "Diesen Monat"
	case "year":
		from := time.Date(now.Year(), 1, 1, 0, 0, 0, 0, now.Location())
		// to = exclusive upper bound at next-day boundary so today
		// is included; spec says YTD → Jan 1 → today.
		to := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location()).AddDate(0, 0, 1)
		return from, to, "Dieses Jahr"
	default: // "all"
		from := time.Date(1, 1, 1, 0, 0, 0, 0, now.Location())
		to := now.AddDate(0, 0, 1)
		return from, to, "Insgesamt"
	}
}

// computePriorBounds returns the prior-period [from, to) used for the
// delta chip. For week/month it's the full prior period; for year it's
// "prior year same YTD slice" — Jan 1 last year through today-last-year.
func computePriorBounds(rng string, periodFrom, periodTo time.Time) (time.Time, time.Time) {
	switch rng {
	case "week":
		return periodFrom.AddDate(0, 0, -7), periodFrom
	case "month":
		return periodFrom.AddDate(0, -1, 0), periodFrom
	case "year":
		return periodFrom.AddDate(-1, 0, 0), periodTo.AddDate(-1, 0, 0)
	}
	return time.Time{}, time.Time{}
}

// computeChartWindow returns [from, to) for the chart x-axis.
func computeChartWindow(rng string, now time.Time) (time.Time, time.Time) {
	to := now.AddDate(0, 0, 1) // include today
	switch rng {
	case "week":
		// last 8 weeks ending current ISO week
		curWeekStart := startOfISOWeek(now)
		return curWeekStart.AddDate(0, 0, -7*7), curWeekStart.AddDate(0, 0, 7)
	case "month":
		// last 6 months ending current calendar month
		curMonthStart := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, now.Location())
		return curMonthStart.AddDate(0, -5, 0), curMonthStart.AddDate(0, 1, 0)
	case "year":
		// last 12 months ending now
		return now.AddDate(0, -12, 0), to
	}
	// "all"
	return time.Date(1, 1, 1, 0, 0, 0, 0, now.Location()), to
}

// startOfISOWeek returns the Monday 00:00 of the ISO week containing t,
// in t's location.
func startOfISOWeek(t time.Time) time.Time {
	// Go: Sunday=0..Saturday=6. ISO week starts Monday.
	wd := int(t.Weekday())
	if wd == 0 {
		wd = 7
	}
	dayStart := time.Date(t.Year(), t.Month(), t.Day(), 0, 0, 0, 0, t.Location())
	return dayStart.AddDate(0, 0, -(wd - 1))
}
