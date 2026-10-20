// Command insights-backfill runs the FEAT-0011 insights pipeline
// against every session that already has summary_json populated.
// Sessions finalised before the analysis window existed get one
// computed from their stroke rows first, persisted into summary_json.
// Idempotent: ReplaceForSession deletes-then-inserts.
//
// Usage: insights-backfill -db /path/to/splits.db
package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"os"

	"github.com/gloeckner-daniel/splits/internal/event"
	"github.com/gloeckner-daniel/splits/internal/insights"
	"github.com/gloeckner-daniel/splits/internal/storage"
)

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

	ctx := context.Background()
	rows, err := db.Handle().QueryContext(ctx, `
		SELECT s.id, s.rower_id, COALESCE(w.mode, ''),
		       s.total_time_sec, s.total_distance_m, s.summary_json
		FROM sessions s
		LEFT JOIN workout w ON w.id = s.workout_id
		WHERE s.ended_at IS NOT NULL AND s.summary_json IS NOT NULL`)
	if err != nil {
		log.Fatal(err)
	}
	defer rows.Close()

	store := insights.NewStore(db.Handle())
	var done, skipped, errored, windowed int
	for rows.Next() {
		var id, rowerID, mode, summary string
		var dur float64
		var dist int
		if err := rows.Scan(&id, &rowerID, &mode, &dur, &dist, &summary); err != nil {
			log.Printf("scan: %v", err)
			errored++
			continue
		}
		var parsed struct {
			Samples *event.SessionSamples `json:"samples"`
		}
		if err := json.Unmarshal([]byte(summary), &parsed); err != nil || parsed.Samples == nil {
			skipped++
			continue
		}
		if ok, err := storage.BackfillAnalysisWindow(ctx, db.Handle(), id, parsed.Samples); err != nil {
			log.Printf("window %s: %v", id, err)
		} else if ok {
			if err := storage.PersistSamplesWindow(ctx, db.Handle(), id, parsed.Samples.Window); err != nil {
				log.Printf("persist window %s: %v", id, err)
				errored++
				continue
			}
			windowed++
		}
		res := insights.Run(insights.SessionMeta{
			WorkoutMode: mode,
			DurationSec: dur,
			DistanceM:   dist,
		}, parsed.Samples)
		if err := store.ReplaceForSession(ctx, rowerID, id, res.Findings); err != nil {
			log.Printf("replace %s: %v", id, err)
			errored++
			continue
		}
		done++
	}
	log.Printf("backfill done: %d processed (%d newly windowed), %d skipped, %d errored", done, windowed, skipped, errored)
}
