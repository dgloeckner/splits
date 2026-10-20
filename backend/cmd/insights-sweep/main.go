// Command insights-sweep runs the efficiency drift measurement
// (FEAT-0011 §Effizienzdrift) over every stored session and prints one
// row per session plus the distribution, so the v1 thresholds can be
// tuned on real data. Read-only: nothing is written.
//
// Usage: insights-sweep -db /path/to/splits.db
package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"log"
	"os"
	"sort"

	"github.com/gloeckner-daniel/splits/internal/event"
	"github.com/gloeckner-daniel/splits/internal/insights"
	"github.com/gloeckner-daniel/splits/internal/storage"
)

// row is one eligible session's measurement.
type row struct {
	ID, StartedAt, Mode string
	M                   insights.DriftMeasure
	Fade                bool
}

func main() {
	dbPath := flag.String("db", "", "Path to splits.db")
	flag.Parse()
	if *dbPath == "" {
		fmt.Fprintln(os.Stderr, "missing -db")
		os.Exit(2)
	}
	db, err := storage.Open(*dbPath)
	if err != nil {
		log.Fatal(err)
	}
	defer db.Close()

	rs, err := db.Handle().QueryContext(context.Background(), `
		SELECT s.id, s.started_at, COALESCE(w.mode, ''),
		       s.total_time_sec, s.total_distance_m, s.summary_json
		FROM sessions s
		LEFT JOIN workout w ON w.id = s.workout_id
		WHERE s.ended_at IS NOT NULL AND s.summary_json IS NOT NULL
		ORDER BY s.started_at`)
	if err != nil {
		log.Fatal(err)
	}
	defer rs.Close()

	var rows []row
	var skipped int
	for rs.Next() {
		var r row
		var dur float64
		var dist int
		var summary string
		if err := rs.Scan(&r.ID, &r.StartedAt, &r.Mode, &dur, &dist, &summary); err != nil {
			log.Fatal(err)
		}
		var parsed struct {
			Samples *event.SessionSamples `json:"samples"`
		}
		if json.Unmarshal([]byte(summary), &parsed) != nil || parsed.Samples == nil ||
			!insights.CheckEligibility(insights.SessionMeta{WorkoutMode: r.Mode, DurationSec: dur, DistanceM: dist}).OK {
			skipped++
			continue
		}
		m, ok := insights.MeasureDrift(parsed.Samples)
		if !ok {
			skipped++
			continue
		}
		r.M = m
		_, r.Fade = insights.DetectFade(parsed.Samples)
		rows = append(rows, r)
	}
	if err := rs.Err(); err != nil {
		log.Fatal(err)
	}
	report(os.Stdout, rows, skipped)
}

// report prints the per-session table and the distribution summary.
func report(w io.Writer, rows []row, skipped int) {
	fmt.Fprintf(w, "thresholds v1: dps_pct <= %.1f, spm rise >= %.1f, |split change| <= %.1f s, suppressed by fade\n\n",
		insights.DriftDPSPct, insights.DriftSPMRise, insights.PacingThresholdSec)
	fmt.Fprintf(w, "%-26s %-9s %7s %7s %8s %6s %6s %7s %5s %5s\n",
		"session", "mode", "dps1", "dps2", "dps_pct", "spm1", "spm2", "dsplit", "fade", "FIRE")
	var fired int
	var dps, spm, split []float64
	for _, r := range rows {
		fire := r.M.Fires() && !r.Fade
		if fire {
			fired++
		}
		dps = append(dps, r.M.DPSPct)
		spm = append(spm, r.M.SPM2-r.M.SPM1)
		split = append(split, r.M.Split2-r.M.Split1)
		fmt.Fprintf(w, "%-26s %-9s %7.2f %7.2f %8.1f %6.1f %6.1f %7.1f %5s %5s\n",
			r.StartedAt, r.Mode, r.M.DPS1, r.M.DPS2, r.M.DPSPct, r.M.SPM1, r.M.SPM2, r.M.Split2-r.M.Split1,
			yes(r.Fade), yes(fire))
	}
	fmt.Fprintf(w, "\n%d sessions measured, %d skipped (no samples, ineligible or window < %d buckets), %d fire\n",
		len(rows), skipped, insights.DriftMinBuckets, fired)
	for _, d := range []struct {
		name string
		xs   []float64
	}{{"dps_pct", dps}, {"spm rise", spm}, {"split change", split}} {
		fmt.Fprintf(w, "%-12s %s\n", d.name, quantiles(d.xs))
	}
}

func yes(b bool) string {
	if b {
		return "yes"
	}
	return ""
}

// quantiles renders min / p10 / p25 / median / p75 / p90 / max.
func quantiles(xs []float64) string {
	if len(xs) == 0 {
		return "—"
	}
	s := append([]float64(nil), xs...)
	sort.Float64s(s)
	at := func(q float64) float64 { return s[int(q*float64(len(s)-1)+0.5)] }
	return fmt.Sprintf("min %.1f  p10 %.1f  p25 %.1f  p50 %.1f  p75 %.1f  p90 %.1f  max %.1f",
		s[0], at(0.10), at(0.25), at(0.50), at(0.75), at(0.90), s[len(s)-1])
}
