package storage

import "testing"

// Migration 0018 retires spi/dps window-PBs and Konstanz achievements,
// backfills time-mode workout-PB candidates from session aggregates,
// and resets lifetime computed_at so the boot janitor's B6 pass
// rebuilds active PB rows on first boot.
func TestMigration0018RecordsRebuild(t *testing.T) {
	db := testDB(t)
	h := db.Handle()

	mustExec := func(q string, args ...any) {
		t.Helper()
		if _, err := h.Exec(q, args...); err != nil {
			t.Fatalf("%s: %v", q, err)
		}
	}

	mustExec(`INSERT INTO rowers(id, name, color, created_at) VALUES('R1','T','#fff','2026-01-01T00:00:00Z')`)
	// Time-mode workout: one completed session (backfilled), one aborted (not).
	mustExec(`INSERT INTO workout(id, mode, params_json, shape_hash, warmup_sec, cooldown_sec, created_at)
		VALUES('W20','time','{"seconds":1200}','H_20MIN',0,0,'2026-01-01T00:00:00Z')`)
	mustExec(`INSERT INTO sessions(id, rower_id, workout_id, started_at, ended_at, initial_level,
			total_distance_m, total_time_sec, total_strokes)
		VALUES('S1','R1','W20','2026-01-02T00:00:00Z','2026-01-02T00:20:00Z',5,4812,1198.5,400)`)
	mustExec(`INSERT INTO sessions(id, rower_id, workout_id, started_at, ended_at, initial_level,
			total_distance_m, total_time_sec, total_strokes)
		VALUES('S2','R1','W20','2026-01-03T00:00:00Z','2026-01-03T00:09:00Z',5,2000,480,160)`)
	// Window PBs: power survives, spi + dps are invalidated.
	for _, m := range []string{"power", "dps", "spi"} {
		mustExec(`INSERT INTO pb_window(rower_id, metric, window_kind, window_size, value,
			source_session_id, source_session_started_at, achieved_at)
			VALUES('R1', ?, 'seconds', 60, 100, 'S1', '2026-01-02T00:00:00Z', '2026-01-02T00:00:00Z')`, m)
	}
	// Konstanz achievement invalidated; volume achievement untouched.
	mustExec(`INSERT INTO achievements(rower_id, achievement_type, achievement_key, value, achieved_at)
		VALUES('R1','consistency_intra','consistency_power_cv',0.02,'2026-01-02T00:00:00Z')`)
	mustExec(`INSERT INTO achievements(rower_id, achievement_type, achievement_key, value, achieved_at)
		VALUES('R1','volume','distance_10000m',10000,'2026-01-02T00:00:00Z')`)
	mustExec(`INSERT INTO rower_lifetime_stats(rower_id, total_distance_m, total_active_sec,
			total_strokes, total_sessions, stats_version, computed_at)
		VALUES('R1', 6812, 1678, 560, 2, 3, '2026-06-01T00:00:00Z')`)

	body, err := migrations.ReadFile("migrations/0018_records_rebuild.sql")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := h.Exec(string(body)); err != nil {
		t.Fatalf("apply 0018: %v", err)
	}

	count := func(q string, args ...any) int {
		t.Helper()
		var n int
		if err := h.QueryRow(q, args...).Scan(&n); err != nil {
			t.Fatal(err)
		}
		return n
	}
	if n := count(`SELECT COUNT(*) FROM pb_window WHERE metric='power' AND invalidated_at IS NULL`); n != 1 {
		t.Fatalf("power pb_window invalidated, want kept: %d active", n)
	}
	if n := count(`SELECT COUNT(*) FROM pb_window WHERE metric IN ('spi','dps') AND invalidated_at IS NULL`); n != 0 {
		t.Fatalf("spi/dps pb_window still active: %d", n)
	}
	if n := count(`SELECT COUNT(*) FROM achievements WHERE achievement_type='consistency_intra' AND invalidated_at IS NULL`); n != 0 {
		t.Fatalf("consistency achievements still active: %d", n)
	}
	if n := count(`SELECT COUNT(*) FROM achievements WHERE achievement_type='volume' AND invalidated_at IS NULL`); n != 1 {
		t.Fatalf("volume achievement lost: %d active", n)
	}
	// Backfill: completed S1 yes, aborted S2 no.
	if n := count(`SELECT COUNT(*) FROM session_pb_workout_candidate WHERE session_id='S1'
		AND value_kind='distance_m' AND value=4812 AND shape_hash='H_20MIN'`); n != 1 {
		t.Fatalf("S1 workout candidate missing: %d", n)
	}
	if n := count(`SELECT COUNT(*) FROM session_pb_workout_candidate WHERE session_id='S2'`); n != 0 {
		t.Fatalf("aborted S2 got a workout candidate")
	}
	// Idempotent re-run: NOT EXISTS guard prevents duplicates.
	if _, err := h.Exec(string(body)); err != nil {
		t.Fatalf("re-apply 0018: %v", err)
	}
	if n := count(`SELECT COUNT(*) FROM session_pb_workout_candidate WHERE session_id='S1'`); n != 1 {
		t.Fatalf("backfill duplicated on re-run: %d", n)
	}
	// computed_at reset → boot B6 recompute fires.
	var computedAt string
	if err := h.QueryRow(`SELECT computed_at FROM rower_lifetime_stats WHERE rower_id='R1'`).Scan(&computedAt); err != nil {
		t.Fatal(err)
	}
	if computedAt != "0001-01-01T00:00:00Z" {
		t.Fatalf("computed_at not reset: %q", computedAt)
	}
}
