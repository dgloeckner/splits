package rower

import (
	"context"
	"testing"
	"time"
)

func TestGenerateAndHash(t *testing.T) {
	t.Parallel()
	tok, err := GenerateToken()
	if err != nil {
		t.Fatal(err)
	}
	if len(tok) < 40 {
		t.Fatalf("token too short: %d", len(tok))
	}
	for _, r := range tok {
		ok := (r >= 'A' && r <= 'Z') || (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') || r == '-' || r == '_'
		if !ok {
			t.Fatalf("bad char in token: %q", r)
		}
	}
	h1 := HashToken(tok)
	h2 := HashToken(tok)
	if h1 != h2 {
		t.Fatal("hash not deterministic")
	}
	if h1 == tok {
		t.Fatal("hash must differ from plaintext")
	}
	if len(h1) != 64 {
		t.Fatalf("want 64 hex chars, got %d", len(h1))
	}
}

func TestMintAndConsume(t *testing.T) {
	db := openTestDB(t)
	ctx := context.Background()
	repo := NewRepo(db.Handle())
	r, err := repo.Create(ctx, CreateInput{Name: "Alice", Color: "#ff6b6b"})
	if err != nil {
		t.Fatal(err)
	}

	pt := NewPairingStore(db.Handle())
	plain, err := pt.Mint(ctx, r.ID, time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	if len(plain) < 40 {
		t.Fatalf("plain token unexpected: %q", plain)
	}

	rowerID, err := pt.Consume(ctx, plain)
	if err != nil {
		t.Fatal(err)
	}
	if rowerID != r.ID {
		t.Fatalf("want %s, got %s", r.ID, rowerID)
	}

	// Re-consume must fail.
	if _, err := pt.Consume(ctx, plain); err == nil {
		t.Fatal("expected error on second consume")
	}
}

func TestExpiredTokenRejected(t *testing.T) {
	db := openTestDB(t)
	ctx := context.Background()
	repo := NewRepo(db.Handle())
	r, err := repo.Create(ctx, CreateInput{Name: "Bob", Color: "#4ecdc4"})
	if err != nil {
		t.Fatal(err)
	}
	pt := NewPairingStore(db.Handle())
	plain, err := pt.Mint(ctx, r.ID, -time.Second)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := pt.Consume(ctx, plain); err == nil {
		t.Fatal("expected expired token to be rejected")
	}
}
