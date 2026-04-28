package main

import (
	"bytes"
	"context"
	"database/sql"
	"strings"
	"testing"
	"time"

	"github.com/gloeckner-daniel/splits/internal/rower"
	"github.com/gloeckner-daniel/splits/internal/storage"
)

func openTestDB(t *testing.T) *sql.DB {
	t.Helper()
	dir := t.TempDir()
	db, err := storage.Open(dir + "/test.db")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	return db.Handle()
}

func mustCreateRower(t *testing.T, db *sql.DB, name string) *rower.Rower {
	t.Helper()
	r, err := rower.NewRepo(db).Create(context.Background(), rower.CreateInput{Name: name})
	if err != nil {
		t.Fatal(err)
	}
	return r
}

func TestCLI_Invite_PrintsURL(t *testing.T) {
	db := openTestDB(t)
	r := mustCreateRower(t, db, "Alice")
	out := &bytes.Buffer{}
	err := runCLI(context.Background(), db, "https://splits.example", []string{"invite", r.ID}, out)
	if err != nil {
		t.Fatal(err)
	}
	got := out.String()
	if !strings.Contains(got, "https://splits.example/pair#t=") {
		t.Fatalf("want pairing URL, got %q", got)
	}
	var n int
	if err := db.QueryRow(`SELECT COUNT(*) FROM pairing_tokens WHERE rower_id = ?`, r.ID).Scan(&n); err != nil {
		t.Fatal(err)
	}
	if n != 1 {
		t.Fatalf("want 1 token, got %d", n)
	}
}

func TestCLI_Invite_UnknownRower_Errors(t *testing.T) {
	db := openTestDB(t)
	out := &bytes.Buffer{}
	err := runCLI(context.Background(), db, "https://splits.example", []string{"invite", "missing"}, out)
	if err == nil {
		t.Fatal("expected error")
	}
	if !strings.Contains(err.Error(), "rower not found") {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestCLI_Revoke_RemovesPairingsAndTokens(t *testing.T) {
	db := openTestDB(t)
	ctx := context.Background()
	r := mustCreateRower(t, db, "Alice")
	link := rower.NewDeviceLink(db)
	if err := link.Pair(ctx, "dev1", r.ID); err != nil {
		t.Fatal(err)
	}
	if err := link.Pair(ctx, "dev2", r.ID); err != nil {
		t.Fatal(err)
	}
	store := rower.NewPairingStore(db)
	if _, err := store.Mint(ctx, r.ID, time.Hour); err != nil {
		t.Fatal(err)
	}

	out := &bytes.Buffer{}
	if err := runCLI(ctx, db, "", []string{"revoke", r.ID}, out); err != nil {
		t.Fatal(err)
	}

	var pairs, tokens int
	db.QueryRow(`SELECT COUNT(*) FROM device_rowers WHERE rower_id = ?`, r.ID).Scan(&pairs)
	db.QueryRow(`SELECT COUNT(*) FROM pairing_tokens WHERE rower_id = ?`, r.ID).Scan(&tokens)
	if pairs != 0 || tokens != 0 {
		t.Fatalf("want 0/0, got %d pairings, %d tokens", pairs, tokens)
	}
}

func TestCLI_DeleteRower_SoftDeletesAndCascades(t *testing.T) {
	db := openTestDB(t)
	ctx := context.Background()
	r := mustCreateRower(t, db, "Alice")
	link := rower.NewDeviceLink(db)
	if err := link.Pair(ctx, "dev1", r.ID); err != nil {
		t.Fatal(err)
	}
	out := &bytes.Buffer{}
	if err := runCLI(ctx, db, "", []string{"delete-rower", r.ID}, out); err != nil {
		t.Fatal(err)
	}
	// Soft-deleted rowers must NOT appear in Repo.List.
	repo := rower.NewRepo(db)
	list, err := repo.List(ctx)
	if err != nil {
		t.Fatal(err)
	}
	for _, x := range list {
		if x.ID == r.ID {
			t.Fatal("rower should not appear in active list")
		}
	}
	// Pairings cascaded.
	var n int
	db.QueryRow(`SELECT COUNT(*) FROM device_rowers WHERE rower_id = ?`, r.ID).Scan(&n)
	if n != 0 {
		t.Fatalf("device_rowers not cleaned: %d", n)
	}
}
