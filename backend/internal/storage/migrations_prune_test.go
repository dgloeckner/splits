package storage

import (
	"context"
	"testing"
	"time"
)

const pruneEmptySessionsSQL = `
DELETE FROM sessions
WHERE ended_at IS NOT NULL
  AND total_strokes = 0
  AND total_distance_m = 0
  AND id NOT IN (SELECT DISTINCT session_id FROM strokes);`

func TestPruneEmptySessionsMigration(t *testing.T) {
	db := testDB(t)
	ctx := context.Background()
	started := time.Date(2026, 1, 1, 10, 0, 0, 0, time.UTC)
	ended := started.Add(15 * time.Minute).UTC().Format(time.RFC3339Nano)

	// Phantom: ended, zero totals, no strokes.
	if err := InsertSession(ctx, db.Handle(), "ph1", "r1", started, 3, ""); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Handle().ExecContext(ctx,
		`UPDATE sessions SET ended_at=?, total_strokes=0, total_distance_m=0 WHERE id='ph1'`,
		ended); err != nil {
		t.Fatal(err)
	}

	// Real: ended with strokes + totals (use the shared seed helper).
	seedSession(t, db, "ok1", "r1", 5)
	if _, err := db.Handle().ExecContext(ctx,
		`UPDATE sessions SET ended_at=?, total_strokes=5, total_distance_m=200 WHERE id='ok1'`,
		ended); err != nil {
		t.Fatal(err)
	}

	if _, err := db.Handle().ExecContext(ctx, pruneEmptySessionsSQL); err != nil {
		t.Fatalf("prune SQL: %v", err)
	}

	var phantom, real int
	db.Handle().QueryRowContext(ctx, `SELECT COUNT(*) FROM sessions WHERE id='ph1'`).Scan(&phantom)
	db.Handle().QueryRowContext(ctx, `SELECT COUNT(*) FROM sessions WHERE id='ok1'`).Scan(&real)
	if phantom != 0 {
		t.Errorf("phantom not pruned: %d", phantom)
	}
	if real != 1 {
		t.Errorf("real session wrongly pruned: %d", real)
	}
}
