package storage_test

import (
	"context"
	"testing"
	"time"

	"github.com/gloeckner-daniel/splits/internal/event"
	"github.com/gloeckner-daniel/splits/internal/rower"
	"github.com/gloeckner-daniel/splits/internal/storage"
)

func openTestDB(t *testing.T) *storage.DB {
	t.Helper()
	db, err := storage.Open(":memory:")
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })
	return db
}

func TestJanitor_PurgesExpiredPairingTokens(t *testing.T) {
	t.Parallel()
	db := openTestDB(t)
	ctx := context.Background()

	repo := rower.NewRepo(db.Handle())
	r, err := repo.Create(ctx, rower.CreateInput{Name: "Alice", Color: "#ff6b6b"})
	if err != nil {
		t.Fatal(err)
	}

	store := rower.NewPairingStore(db.Handle())
	if _, err := store.Mint(ctx, r.ID, -time.Second); err != nil {
		t.Fatal(err)
	}
	if _, err := store.Mint(ctx, r.ID, time.Hour); err != nil {
		t.Fatal(err)
	}

	if err := storage.RunJanitorOnce(ctx, db.Handle()); err != nil {
		t.Fatal(err)
	}

	var n int
	if err := db.Handle().QueryRowContext(ctx, `SELECT COUNT(*) FROM pairing_tokens`).Scan(&n); err != nil {
		t.Fatal(err)
	}
	if n != 1 {
		t.Fatalf("want 1 unexpired token, got %d", n)
	}
}

// BootJanitor finalises orphan sessions (left open across a process
// restart). Per FEAT-0015 Slice 4 / ADR-0011 it must KEEP the strokes
// once it writes the summary — strokes are the replay source of truth.
func TestBootJanitor_FinaliseRetainsStrokes(t *testing.T) {
	t.Parallel()
	db := openTestDB(t)
	ctx := context.Background()
	now := time.Now().UTC()

	if err := storage.InsertSession(ctx, db.Handle(), "S-orphan", "R1", now.Add(-30*time.Minute), 3, ""); err != nil {
		t.Fatal(err)
	}
	for i := 1; i <= 4; i++ {
		if err := storage.InsertStroke(ctx, db.Handle(), uint64(i), "S-orphan", now.Add(-20*time.Minute), event.StrokePayload{
			StrokeNo: i, TimeSec: float64(i) * 2.0, DistanceM: i * 5,
			SPM: 22, PowerW: 180, DPS: 5, StrokeCycleSec: 2.0,
			PaceSecPer500m: 140, Phase: "work",
		}); err != nil {
			t.Fatal(err)
		}
	}

	(&storage.BootJanitor{DB: db.Handle()}).Run(ctx)

	var endedAt string
	if err := db.Handle().QueryRowContext(ctx,
		`SELECT COALESCE(ended_at,'') FROM sessions WHERE id = ?`, "S-orphan").Scan(&endedAt); err != nil {
		t.Fatal(err)
	}
	if endedAt == "" {
		t.Fatalf("BootJanitor did not finalise S-orphan (ended_at empty)")
	}

	var n int
	if err := db.Handle().QueryRowContext(ctx,
		`SELECT COUNT(*) FROM strokes WHERE session_id = ?`, "S-orphan").Scan(&n); err != nil {
		t.Fatal(err)
	}
	if n != 4 {
		t.Errorf("strokes after BootJanitor finalise = %d, want 4 (replay-grade persistence per ADR-0011)", n)
	}
}

// B6: BootJanitor must trigger a synchronous stats recompute for any
// rower whose latest ended session is newer than their lifetime_stats
// computed_at. This is the self-healing safety net for cases where
// the async OnSessionChange recompute fired during session-end didn't
// survive shutdown (a real-world failure mode observed 2026-05-15).
func TestBootJanitor_RecomputesStaleRowerStats(t *testing.T) {
	t.Parallel()
	db := openTestDB(t)
	ctx := context.Background()
	now := time.Now().UTC()

	// Insert the rower row (FK target for pb_distance / lifetime).
	if _, err := db.Handle().ExecContext(ctx,
		`INSERT INTO rowers(id, name, weight_kg, height_cm, dob, color, created_at)
		 VALUES(?, ?, ?, ?, ?, ?, ?)`,
		"R-stale", "Stale", 80.0, 180.0, "2000-01-01", "#abc",
		now.Format(time.RFC3339Nano)); err != nil {
		t.Fatal(err)
	}
	// Insert a finished session for the rower; intentionally do NOT
	// populate rower_lifetime_stats — simulating the case where
	// session-end committed but the async recompute never landed.
	if err := storage.InsertSession(ctx, db.Handle(), "S-recent", "R-stale",
		now.Add(-2*time.Hour), 3, ""); err != nil {
		t.Fatal(err)
	}
	endedAt := now.Add(-1 * time.Hour).Format(time.RFC3339Nano)
	if _, err := db.Handle().ExecContext(ctx,
		`UPDATE sessions SET ended_at = ?, total_distance_m = 5000,
		 total_time_sec = 1100, total_strokes = 470, summary_json = '{}'
		 WHERE id = ?`, endedAt, "S-recent"); err != nil {
		t.Fatal(err)
	}

	// Sanity: lifetime_stats row absent before janitor runs.
	var before int
	_ = db.Handle().QueryRowContext(ctx,
		`SELECT COUNT(*) FROM rower_lifetime_stats WHERE rower_id = ?`, "R-stale").Scan(&before)
	if before != 0 {
		t.Fatalf("test setup: lifetime_stats unexpectedly present (%d)", before)
	}

	(&storage.BootJanitor{DB: db.Handle()}).Run(ctx)

	// After janitor: lifetime_stats row exists with the session
	// totals reflected.
	var dist, sessions int
	if err := db.Handle().QueryRowContext(ctx,
		`SELECT total_distance_m, total_sessions FROM rower_lifetime_stats
		 WHERE rower_id = ?`, "R-stale").Scan(&dist, &sessions); err != nil {
		t.Fatalf("lifetime_stats row missing after janitor: %v", err)
	}
	if dist != 5000 {
		t.Errorf("lifetime total_distance_m = %d, want 5000", dist)
	}
	if sessions != 1 {
		t.Errorf("lifetime total_sessions = %d, want 1", sessions)
	}
}

// B4: BootJanitor must DROP zero-stroke open sessions instead of
// materialising them as "recovered" ghosts that pollute history/PB
// aggregates. Repro: user taps Start (creating the session row via
// session_start) but never rows — backend restarts → BootJanitor saw
// an open session and finalised it as zero-totals + flag=recovered.
// After the fix the row is deleted at janitor time.
func TestBootJanitor_DropsZeroStrokeGhost(t *testing.T) {
	t.Parallel()
	db := openTestDB(t)
	ctx := context.Background()
	now := time.Now().UTC()

	if err := storage.InsertSession(ctx, db.Handle(), "S-ghost", "R1", now.Add(-1*time.Hour), 3, ""); err != nil {
		t.Fatal(err)
	}
	// No strokes inserted.

	(&storage.BootJanitor{DB: db.Handle()}).Run(ctx)

	var n int
	if err := db.Handle().QueryRowContext(ctx,
		`SELECT COUNT(*) FROM sessions WHERE id = ?`, "S-ghost").Scan(&n); err != nil {
		t.Fatal(err)
	}
	if n != 0 {
		t.Fatalf("zero-stroke session not dropped: count = %d, want 0", n)
	}
}

// FinalizeStaleSession (Slice 3 entry point used by the resume-card UI)
// must also retain strokes after closing the session. ADR-0011: ended
// sessions keep their strokes, only hard-delete wipes them.
func TestFinalizeStaleSession_RetainsStrokes(t *testing.T) {
	t.Parallel()
	db := openTestDB(t)
	ctx := context.Background()
	now := time.Now().UTC()

	if err := storage.InsertSession(ctx, db.Handle(), "S-stale", "R1", now.Add(-30*time.Minute), 3, ""); err != nil {
		t.Fatal(err)
	}
	for i := 1; i <= 3; i++ {
		if err := storage.InsertStroke(ctx, db.Handle(), 1000+uint64(i), "S-stale", now.Add(-10*time.Minute), event.StrokePayload{
			StrokeNo: i, TimeSec: float64(i) * 2.0, DistanceM: i * 6,
			SPM: 24, PowerW: 200, DPS: 6, StrokeCycleSec: 2.0,
			PaceSecPer500m: 130, Phase: "work",
		}); err != nil {
			t.Fatal(err)
		}
	}

	if err := storage.FinalizeStaleSession(ctx, db.Handle(), "S-stale"); err != nil {
		t.Fatalf("FinalizeStaleSession: %v", err)
	}

	var endedAt string
	if err := db.Handle().QueryRowContext(ctx,
		`SELECT COALESCE(ended_at,'') FROM sessions WHERE id = ?`, "S-stale").Scan(&endedAt); err != nil {
		t.Fatal(err)
	}
	if endedAt == "" {
		t.Fatalf("FinalizeStaleSession did not set ended_at")
	}

	var n int
	if err := db.Handle().QueryRowContext(ctx,
		`SELECT COUNT(*) FROM strokes WHERE session_id = ?`, "S-stale").Scan(&n); err != nil {
		t.Fatal(err)
	}
	if n != 3 {
		t.Errorf("strokes after FinalizeStaleSession = %d, want 3 (replay-grade persistence per ADR-0011)", n)
	}
}
