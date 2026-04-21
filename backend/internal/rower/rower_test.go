package rower

import (
	"context"
	"testing"
	"time"

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

func TestListAndGet(t *testing.T) {
	ctx := context.Background()
	db := openTestDB(t)
	repo := NewRepo(db.Handle())
	a, _ := repo.Create(ctx, CreateInput{Name: "Alice", Color: "#ff6b6b"})
	b, _ := repo.Create(ctx, CreateInput{Name: "Bob", Color: "#4ecdc4"})

	list, err := repo.List(ctx)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(list) != 2 {
		t.Fatalf("expected 2, got %d", len(list))
	}

	got, err := repo.Get(ctx, a.ID)
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if got == nil || got.Name != "Alice" {
		t.Fatalf("got: %+v", got)
	}
	_ = b

	missing, err := repo.Get(ctx, "does-not-exist")
	if err != nil {
		t.Fatalf("get missing: %v", err)
	}
	if missing != nil {
		t.Fatalf("expected nil, got %+v", missing)
	}
}

func TestUpdate_PartialFields(t *testing.T) {
	ctx := context.Background()
	db := openTestDB(t)
	repo := NewRepo(db.Handle())
	r, _ := repo.Create(ctx, CreateInput{Name: "Alice", Color: "#ff6b6b"})

	name := "Alicia"
	w := 68.5
	updated, err := repo.Update(ctx, r.ID, UpdateInput{Name: &name, WeightKg: &w})
	if err != nil {
		t.Fatalf("update: %v", err)
	}
	if updated.Name != "Alicia" {
		t.Fatalf("name: %s", updated.Name)
	}
	if updated.WeightKg == nil || *updated.WeightKg != 68.5 {
		t.Fatalf("weight: %+v", updated.WeightKg)
	}
	if updated.Color != "#ff6b6b" {
		t.Fatalf("color should be unchanged: %s", updated.Color)
	}
}

func TestActiveRower_SetGet(t *testing.T) {
	ctx := context.Background()
	db := openTestDB(t)
	repo := NewRepo(db.Handle())
	r, _ := repo.Create(ctx, CreateInput{Name: "Alice", Color: "#ff6b6b"})

	if err := repo.SetActiveForDevice(ctx, "dev-1", r.ID); err != nil {
		t.Fatalf("set: %v", err)
	}
	got, err := repo.GetActiveForDevice(ctx, "dev-1")
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if got == nil || got.ID != r.ID {
		t.Fatalf("got: %+v", got)
	}

	missing, err := repo.GetActiveForDevice(ctx, "dev-2")
	if err != nil || missing != nil {
		t.Fatalf("missing should be nil, got %+v, err=%v", missing, err)
	}
}

func TestActiveRower_LastActive(t *testing.T) {
	ctx := context.Background()
	db := openTestDB(t)
	repo := NewRepo(db.Handle())
	a, _ := repo.Create(ctx, CreateInput{Name: "A", Color: "#ff6b6b"})
	b, _ := repo.Create(ctx, CreateInput{Name: "B", Color: "#4ecdc4"})
	_ = repo.SetActiveForDevice(ctx, "dev-1", a.ID)
	time.Sleep(2 * time.Millisecond)
	_ = repo.SetActiveForDevice(ctx, "dev-2", b.ID)

	last, err := repo.LastActive(ctx)
	if err != nil {
		t.Fatalf("last: %v", err)
	}
	if last == nil || last.ID != b.ID {
		t.Fatalf("expected B, got %+v", last)
	}
}

func TestHolder_SeedAndSet(t *testing.T) {
	h := NewHolder()
	id, name := h.Resolve()
	if id != "" || name != "" {
		t.Fatalf("empty holder should return zero values")
	}
	h.Set("rw-1", "Alice")
	id, name = h.Resolve()
	if id != "rw-1" || name != "Alice" {
		t.Fatalf("got %q %q", id, name)
	}
}
