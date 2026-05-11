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
