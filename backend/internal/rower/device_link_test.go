package rower

import (
	"context"
	"testing"
)

func TestDeviceLink_PairAndCheck(t *testing.T) {
	db := openTestDB(t)
	ctx := context.Background()
	repo := NewRepo(db.Handle())
	link := NewDeviceLink(db.Handle())

	r, err := repo.Create(ctx, CreateInput{Name: "Alice", Color: "#ff6b6b"})
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	if ok, _ := link.IsPaired(ctx, "dev1", r.ID); ok {
		t.Fatal("expected unpaired initially")
	}
	if err := link.Pair(ctx, "dev1", r.ID); err != nil {
		t.Fatal(err)
	}
	if ok, err := link.IsPaired(ctx, "dev1", r.ID); err != nil || !ok {
		t.Fatalf("expected paired after Pair; ok=%v err=%v", ok, err)
	}
	if ok, _ := link.IsPaired(ctx, "dev2", r.ID); ok {
		t.Fatal("dev2 should not see dev1's pairing")
	}
	// idempotent
	if err := link.Pair(ctx, "dev1", r.ID); err != nil {
		t.Fatalf("pair idempotency: %v", err)
	}
}
