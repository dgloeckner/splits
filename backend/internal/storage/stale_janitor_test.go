package storage_test

import (
	"context"
	"testing"
	"time"

	"github.com/gloeckner-daniel/splits/internal/event"
	"github.com/gloeckner-daniel/splits/internal/storage"
)

// insertStaleSession writes a sessions row with ended_at NULL and a single
// strokes row at `lastStrokeAt`. Used by the janitor + API smoke tests.
var strokeGlobalIDCounter uint64

func insertStaleSession(t *testing.T, db *storage.DB, id, rowerID string, startedAt, lastStrokeAt time.Time) {
	t.Helper()
	ctx := context.Background()
	if err := storage.InsertSession(ctx, db.Handle(), id, rowerID, startedAt, 3, ""); err != nil {
		t.Fatalf("InsertSession: %v", err)
	}
	strokeGlobalIDCounter++
	if err := storage.InsertStroke(ctx, db.Handle(), strokeGlobalIDCounter, id, lastStrokeAt, event.StrokePayload{
		StrokeNo: 1, TimeSec: 1.0, DistanceM: 5, SPM: 20, PowerW: 100, CalPerHr: 600,
		Level: 3, DPS: 5, StrokeCycleSec: 3, PaceSecPer500m: 130, EnergyJoules: 100,
		Phase: "work",
	}); err != nil {
		t.Fatalf("InsertStroke: %v", err)
	}
}

func TestSweepStaleOpen_MarksIdleSessions(t *testing.T) {
	t.Parallel()
	db := openTestDB(t)
	ctx := context.Background()
	now := time.Now().UTC()

	// Stale: last stroke 10 min ago, no ended_at.
	insertStaleSession(t, db, "S-stale", "R1", now.Add(-30*time.Minute), now.Add(-10*time.Minute))
	// Fresh: last stroke 1 min ago, no ended_at — must not be flagged.
	insertStaleSession(t, db, "S-fresh", "R1", now.Add(-2*time.Minute), now.Add(-1*time.Minute))
	// Already ended: must not be flagged.
	insertStaleSession(t, db, "S-done", "R1", now.Add(-60*time.Minute), now.Add(-40*time.Minute))
	if _, err := db.Handle().ExecContext(ctx,
		`UPDATE sessions SET ended_at = ? WHERE id = 'S-done'`,
		now.Add(-39*time.Minute).Format(time.RFC3339Nano)); err != nil {
		t.Fatal(err)
	}

	n, err := storage.SweepStaleOpen(ctx, db.Handle(), 5*time.Minute)
	if err != nil {
		t.Fatalf("SweepStaleOpen: %v", err)
	}
	if n != 1 {
		t.Errorf("swept = %d, want 1", n)
	}

	statusOf := func(id string) string {
		var s string
		if err := db.Handle().QueryRowContext(ctx,
			`SELECT status FROM sessions WHERE id = ?`, id).Scan(&s); err != nil {
			t.Fatal(err)
		}
		return s
	}
	if got := statusOf("S-stale"); got != "stale-open" {
		t.Errorf("S-stale status = %q, want stale-open", got)
	}
	if got := statusOf("S-fresh"); got != "open" {
		t.Errorf("S-fresh status = %q, want open", got)
	}
	if got := statusOf("S-done"); got != "open" {
		t.Errorf("S-done status = %q, want open (ended)", got)
	}
}

func TestSweepStaleOpen_NoStrokes_NotFlagged(t *testing.T) {
	t.Parallel()
	db := openTestDB(t)
	ctx := context.Background()
	now := time.Now().UTC()

	// Session with no strokes at all — MAX is NULL, must not flag.
	if err := storage.InsertSession(ctx, db.Handle(), "S-empty", "R1", now.Add(-30*time.Minute), 3, ""); err != nil {
		t.Fatal(err)
	}
	n, err := storage.SweepStaleOpen(ctx, db.Handle(), 5*time.Minute)
	if err != nil {
		t.Fatalf("SweepStaleOpen: %v", err)
	}
	if n != 0 {
		t.Errorf("swept = %d, want 0 (no strokes -> no last_stroke_at)", n)
	}
}

func TestListStaleOpenSessions(t *testing.T) {
	t.Parallel()
	db := openTestDB(t)
	ctx := context.Background()
	now := time.Now().UTC()

	insertStaleSession(t, db, "S-stale-1", "R1", now.Add(-30*time.Minute), now.Add(-10*time.Minute))
	insertStaleSession(t, db, "S-stale-2", "R2", now.Add(-30*time.Minute), now.Add(-10*time.Minute))
	if _, err := storage.SweepStaleOpen(ctx, db.Handle(), 5*time.Minute); err != nil {
		t.Fatal(err)
	}

	rows, err := storage.ListStaleOpenSessions(ctx, db.Handle(), "R1")
	if err != nil {
		t.Fatalf("ListStaleOpenSessions: %v", err)
	}
	if len(rows) != 1 {
		t.Fatalf("len = %d, want 1", len(rows))
	}
	r := rows[0]
	if r.ID != "S-stale-1" {
		t.Errorf("id = %q", r.ID)
	}
	if r.TotalDistanceM != 5 {
		t.Errorf("total_distance_m = %d, want 5 (from the single stroke)", r.TotalDistanceM)
	}
	if r.LastStrokeAt.IsZero() {
		t.Errorf("last_stroke_at zero")
	}
}
