package rower

import (
	"context"
	"testing"

	"github.com/gloeckner-daniel/home-ergo/internal/storage"
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

func TestCreate_AssignsIDAndCreatedAt(t *testing.T) {
	ctx := context.Background()
	db := openTestDB(t)
	repo := NewRepo(db.Handle())
	r, err := repo.Create(ctx, CreateInput{Name: "Alice", WeightKg: ptrFloat(70), HeightCm: ptrFloat(172), Color: "#ff6b6b"})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if r.ID == "" {
		t.Fatalf("empty id")
	}
	if r.CreatedAt.IsZero() {
		t.Fatalf("zero created_at")
	}
	if r.Name != "Alice" || r.Color != "#ff6b6b" {
		t.Fatalf("unexpected fields: %+v", r)
	}
	if r.WeightKg == nil || *r.WeightKg != 70 {
		t.Fatalf("weight: %+v", r.WeightKg)
	}
}

func ptrFloat(v float64) *float64 { return &v }
