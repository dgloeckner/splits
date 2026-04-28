package storage_test

import (
	"context"
	"testing"
	"time"

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
