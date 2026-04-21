package storage

import (
	"context"
	"path/filepath"
	"testing"
	"time"
)

func TestSoftDeleteSessionSetsTimestamp(t *testing.T) {
	db, _ := Open(filepath.Join(t.TempDir(), "t.db"))
	defer db.Close()
	ctx := context.Background()
	started := time.Date(2026, 4, 21, 10, 0, 0, 0, time.UTC)
	if err := InsertSession(ctx, db.Handle(), "S1", "R1", started, 3); err != nil {
		t.Fatal(err)
	}

	at := time.Date(2026, 4, 21, 12, 0, 0, 0, time.UTC)
	if err := SoftDeleteSession(ctx, db.Handle(), "S1", at); err != nil {
		t.Fatalf("soft delete: %v", err)
	}

	var stored string
	if err := db.Handle().QueryRow(`SELECT deleted_at FROM sessions WHERE id = ?`, "S1").Scan(&stored); err != nil {
		t.Fatal(err)
	}
	if stored == "" {
		t.Errorf("deleted_at empty")
	}
}

func TestSoftDeleteSessionNoopForUnknown(t *testing.T) {
	db, _ := Open(filepath.Join(t.TempDir(), "t.db"))
	defer db.Close()
	if err := SoftDeleteSession(context.Background(), db.Handle(), "nope", time.Now()); err != nil {
		t.Errorf("expected no error for unknown id, got %v", err)
	}
}
