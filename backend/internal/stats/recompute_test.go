package stats_test

import (
	"context"
	"database/sql"
	"path/filepath"
	"testing"
	"time"

	"github.com/gloeckner-daniel/home-ergo/internal/stats"
	storage "github.com/gloeckner-daniel/home-ergo/internal/storage"
)

// Local aliases so tests read tightly without re-typing the package
// prefix everywhere.
type PBCandidates = stats.PBCandidates
type DistanceCandidate = stats.DistanceCandidate

func Recompute(ctx context.Context, db *sql.DB, rowerID string) error {
	return stats.Recompute(ctx, db, rowerID)
}

// seedSession inserts a fully-ended session row plus its native
// candidate rows. Mirrors what the persister would have written at
// session_end + Mode 0 compaction post-refactor.
func seedSession(t *testing.T, db *sql.DB, id, rowerID string, started time.Time,
	dist, strokes int, timeSec float64, candidates *PBCandidates) {
	t.Helper()
	startedStr := started.UTC().Format(time.RFC3339Nano)
	if _, err := db.Exec(`INSERT INTO sessions(id, rower_id, started_at, ended_at,
		initial_level, total_distance_m, total_time_sec, total_strokes)
		VALUES(?,?,?,?,?,?,?,?)`,
		id, rowerID, startedStr,
		started.Add(time.Minute).UTC().Format(time.RFC3339Nano),
		3, dist, timeSec, strokes); err != nil {
		t.Fatal(err)
	}
	if candidates == nil {
		return
	}
	for _, c := range candidates.Distance {
		if _, err := db.Exec(`
			INSERT INTO session_pb_distance_candidates(session_id, rower_id, started_at,
				distance_m, time_sec, window_start_stroke, window_end_stroke)
			VALUES(?,?,?,?,?,?,?)`,
			id, rowerID, startedStr, c.DistanceM, c.TimeSec,
			c.WindowStartStroke, c.WindowEndStroke); err != nil {
			t.Fatal(err)
		}
	}
	for _, c := range candidates.Window {
		if _, err := db.Exec(`
			INSERT INTO session_pb_window_candidates(session_id, rower_id, started_at,
				metric, window_kind, window_size, value)
			VALUES(?,?,?,?,?,?,?)`,
			id, rowerID, startedStr, c.Metric, c.Kind, c.Size, c.Value); err != nil {
			t.Fatal(err)
		}
	}
	if w := candidates.Workout; w != nil {
		if _, err := db.Exec(`
			INSERT INTO session_pb_workout_candidate(session_id, rower_id, started_at,
				shape_hash, mode, value_kind, value)
			VALUES(?,?,?,?,?,?,?)`,
			id, rowerID, startedStr, w.ShapeHash, w.Mode, w.ValueKind, w.Value); err != nil {
			t.Fatal(err)
		}
	}
	if c := candidates.Consistency; c != nil {
		if _, err := db.Exec(`
			INSERT INTO session_consistency(session_id, rower_id, started_at,
				power_cv, pace_split_cv, spm_cv)
			VALUES(?,?,?,?,?,?)`,
			id, rowerID, startedStr, c.PowerCV, c.PaceSplitCV, c.SPMCV); err != nil {
			t.Fatal(err)
		}
	}
}

func openDB(t *testing.T) *sql.DB {
	t.Helper()
	db, err := storage.Open(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	if _, err := db.Handle().Exec(
		`INSERT INTO rowers(id, name, color, created_at) VALUES('R1','Daniel','#0f0',?)`,
		time.Now().UTC().Format(time.RFC3339Nano)); err != nil {
		t.Fatal(err)
	}
	return db.Handle()
}

func TestRecomputeWritesActiveDistancePB(t *testing.T) {
	db := openDB(t)
	ctx := context.Background()
	t0 := time.Date(2026, 4, 1, 8, 0, 0, 0, time.UTC)

	seedSession(t, db, "S1", "R1", t0, 5000, 500, 1500, &PBCandidates{
		Distance: []DistanceCandidate{{DistanceM: 2000, TimeSec: 480, WindowStartStroke: 100, WindowEndStroke: 300}},
	})
	seedSession(t, db, "S2", "R1", t0.Add(24*time.Hour), 5000, 500, 1500, &PBCandidates{
		Distance: []DistanceCandidate{{DistanceM: 2000, TimeSec: 470, WindowStartStroke: 90, WindowEndStroke: 290}},
	})

	if err := Recompute(ctx, db, "R1"); err != nil {
		t.Fatal(err)
	}

	var time2k float64
	var sourceID string
	if err := db.QueryRow(
		`SELECT time_sec, source_session_id FROM pb_distance
		 WHERE rower_id='R1' AND distance_m=2000 AND invalidated_at IS NULL`).Scan(&time2k, &sourceID); err != nil {
		t.Fatal(err)
	}
	if time2k != 470 || sourceID != "S2" {
		t.Errorf("active 2k = (%.0f, %s), want (470, S2)", time2k, sourceID)
	}

	var version int
	if err := db.QueryRow(
		`SELECT stats_version FROM rower_lifetime_stats WHERE rower_id='R1'`).Scan(&version); err != nil {
		t.Fatal(err)
	}
	if version != 1 {
		t.Errorf("stats_version = %d, want 1", version)
	}

	// Second call bumps version.
	if err := Recompute(ctx, db, "R1"); err != nil {
		t.Fatal(err)
	}
	_ = db.QueryRow(`SELECT stats_version FROM rower_lifetime_stats WHERE rower_id='R1'`).Scan(&version)
	if version != 2 {
		t.Errorf("stats_version after second recompute = %d, want 2", version)
	}
}

func TestRecomputeInvalidatesOnDeletedSource(t *testing.T) {
	db := openDB(t)
	ctx := context.Background()
	t0 := time.Date(2026, 4, 1, 8, 0, 0, 0, time.UTC)

	seedSession(t, db, "S1", "R1", t0, 5000, 500, 1500, &PBCandidates{
		Distance: []DistanceCandidate{{DistanceM: 2000, TimeSec: 480}},
	})
	seedSession(t, db, "S2", "R1", t0.Add(24*time.Hour), 5000, 500, 1500, &PBCandidates{
		Distance: []DistanceCandidate{{DistanceM: 2000, TimeSec: 470}},
	})
	if err := Recompute(ctx, db, "R1"); err != nil {
		t.Fatal(err)
	}

	// Mirror the hard-delete handler: drop pb rows tied to the
	// session before the row itself, since FK has no CASCADE there.
	for _, q := range []string{
		`DELETE FROM pb_distance WHERE source_session_id = 'S2'`,
		`DELETE FROM pb_window WHERE source_session_id = 'S2'`,
		`DELETE FROM pb_workout WHERE source_session_id = 'S2'`,
		`DELETE FROM achievements WHERE source_session_id = 'S2'`,
		`DELETE FROM sessions WHERE id = 'S2'`,
	} {
		if _, err := db.Exec(q); err != nil {
			t.Fatal(err)
		}
	}
	if err := Recompute(ctx, db, "R1"); err != nil {
		t.Fatal(err)
	}

	var time2k float64
	var sourceID string
	if err := db.QueryRow(
		`SELECT time_sec, source_session_id FROM pb_distance
		 WHERE rower_id='R1' AND distance_m=2000 AND invalidated_at IS NULL`).Scan(&time2k, &sourceID); err != nil {
		t.Fatal(err)
	}
	if time2k != 480 || sourceID != "S1" {
		t.Errorf("after deleting S2, active = (%.0f, %s), want (480, S1)", time2k, sourceID)
	}
}

func TestRecomputeVolumeMilestones(t *testing.T) {
	db := openDB(t)
	ctx := context.Background()
	seedSession(t, db, "S1", "R1", time.Now(), 50_000, 5_000, 9_000, nil)
	if err := Recompute(ctx, db, "R1"); err != nil {
		t.Fatal(err)
	}

	rows, err := db.QueryContext(ctx,
		`SELECT achievement_key FROM achievements
		 WHERE rower_id='R1' AND achievement_type='volume' AND invalidated_at IS NULL
		 ORDER BY achievement_key`)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	got := map[string]bool{}
	for rows.Next() {
		var k string
		_ = rows.Scan(&k)
		got[k] = true
	}
	for _, want := range []string{"distance_10000m", "distance_25000m", "distance_50000m"} {
		if !got[want] {
			t.Errorf("missing milestone %q (got %v)", want, got)
		}
	}
	if got["distance_100000m"] {
		t.Error("100km should not be unlocked at 50km")
	}
}

func TestRecomputeDistancePBPreviousValue(t *testing.T) {
	db := openDB(t)
	ctx := context.Background()
	t0 := time.Date(2026, 4, 1, 8, 0, 0, 0, time.UTC)

	seedSession(t, db, "S1", "R1", t0, 2000, 200, 480, &PBCandidates{
		Distance: []DistanceCandidate{{DistanceM: 2000, TimeSec: 480}},
	})
	if err := Recompute(ctx, db, "R1"); err != nil {
		t.Fatal(err)
	}
	var prev sql.NullFloat64
	_ = db.QueryRow(`SELECT previous_time_sec FROM pb_distance
		WHERE rower_id='R1' AND distance_m=2000 AND invalidated_at IS NULL`).Scan(&prev)
	if prev.Valid {
		t.Errorf("first PB previous_time_sec = %v, want NULL", prev.Float64)
	}

	// Improvement: previous_time_sec captures the prior active value.
	seedSession(t, db, "S2", "R1", t0.Add(24*time.Hour), 2000, 200, 470, &PBCandidates{
		Distance: []DistanceCandidate{{DistanceM: 2000, TimeSec: 470}},
	})
	if err := Recompute(ctx, db, "R1"); err != nil {
		t.Fatal(err)
	}
	var cur float64
	if err := db.QueryRow(`SELECT time_sec, previous_time_sec FROM pb_distance
		WHERE rower_id='R1' AND distance_m=2000 AND invalidated_at IS NULL`).Scan(&cur, &prev); err != nil {
		t.Fatal(err)
	}
	if cur != 470 || !prev.Valid || prev.Float64 != 480 {
		t.Errorf("after improvement: cur=%.0f prev=%v, want 470 / 480", cur, prev)
	}

	// Idempotent recompute: chain preserves previous_time_sec=480.
	if err := Recompute(ctx, db, "R1"); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRow(`SELECT time_sec, previous_time_sec FROM pb_distance
		WHERE rower_id='R1' AND distance_m=2000 AND invalidated_at IS NULL`).Scan(&cur, &prev); err != nil {
		t.Fatal(err)
	}
	if cur != 470 || !prev.Valid || prev.Float64 != 480 {
		t.Errorf("after idempotent recompute: cur=%.0f prev=%v, want 470 / 480", cur, prev)
	}
}

func TestRecomputeVolumeMilestonesRealAchievedAt(t *testing.T) {
	db := openDB(t)
	ctx := context.Background()
	t0 := time.Date(2026, 4, 1, 8, 0, 0, 0, time.UTC)
	t1 := t0.Add(24 * time.Hour)

	// S1 reaches 5k cumulative — no milestone crossed.
	seedSession(t, db, "S1", "R1", t0, 5_000, 500, 1500, nil)
	// S2 brings cumulative to 12k — crosses 10k threshold.
	seedSession(t, db, "S2", "R1", t1, 7_000, 700, 2100, nil)
	if err := Recompute(ctx, db, "R1"); err != nil {
		t.Fatal(err)
	}

	var achievedAt, srcID string
	if err := db.QueryRow(`SELECT achieved_at, source_session_id FROM achievements
		WHERE rower_id='R1' AND achievement_key='distance_10000m' AND invalidated_at IS NULL`).
		Scan(&achievedAt, &srcID); err != nil {
		t.Fatal(err)
	}
	wantAt := t1.UTC().Format(time.RFC3339Nano)
	if achievedAt != wantAt || srcID != "S2" {
		t.Errorf("10k milestone: achieved_at=%q src=%q, want (%q, S2)", achievedAt, srcID, wantAt)
	}

	// Idempotent recompute preserves real achieved_at.
	if err := Recompute(ctx, db, "R1"); err != nil {
		t.Fatal(err)
	}
	var achievedAt2 string
	_ = db.QueryRow(`SELECT achieved_at FROM achievements
		WHERE rower_id='R1' AND achievement_key='distance_10000m' AND invalidated_at IS NULL`).
		Scan(&achievedAt2)
	if achievedAt2 != wantAt {
		t.Errorf("after second recompute: achieved_at=%q, want %q", achievedAt2, wantAt)
	}
}

func TestRecomputeConsistencyRealAchievedAt(t *testing.T) {
	db := openDB(t)
	ctx := context.Background()
	t0 := time.Date(2026, 4, 1, 8, 0, 0, 0, time.UTC)

	seedSession(t, db, "S1", "R1", t0, 5000, 500, 1500, &PBCandidates{
		Consistency: &stats.ConsistencyCandidates{PowerCV: 0.05, PaceSplitCV: 0.04, SPMCV: 0.03},
	})
	if err := Recompute(ctx, db, "R1"); err != nil {
		t.Fatal(err)
	}
	var achievedAt string
	if err := db.QueryRow(`SELECT achieved_at FROM achievements
		WHERE rower_id='R1' AND achievement_key='consistency_power_cv' AND invalidated_at IS NULL`).
		Scan(&achievedAt); err != nil {
		t.Fatal(err)
	}
	want := t0.UTC().Format(time.RFC3339Nano)
	if achievedAt != want {
		t.Errorf("consistency achieved_at=%q, want %q (session start)", achievedAt, want)
	}
}
