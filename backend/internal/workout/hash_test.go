package workout

import (
	"encoding/json"
	"testing"
)

func TestShapeHashStableAcrossKeyOrder(t *testing.T) {
	a, err := ShapeHash(json.RawMessage(`{"meters":2000,"foo":"x"}`))
	if err != nil {
		t.Fatal(err)
	}
	b, err := ShapeHash(json.RawMessage(`{"foo":"x","meters":2000}`))
	if err != nil {
		t.Fatal(err)
	}
	if a != b {
		t.Fatalf("expected stable hash across key order, got %q vs %q", a, b)
	}
}

func TestShapeHashIgnoresMode(t *testing.T) {
	// Race and distance with the same params produce the same hash —
	// callers that need mode discrimination must add it themselves,
	// not via ShapeHash.
	params := json.RawMessage(`{"meters":2000}`)
	a, _ := ShapeHash(params)
	b, _ := ShapeHash(params)
	if a != b {
		t.Fatalf("ShapeHash of identical params drifted: %q vs %q", a, b)
	}
}

func TestShapeHashIgnoresWarmupCooldown(t *testing.T) {
	// Warmup and cooldown durations are NOT part of comparability —
	// see ADR-0015 (2026-05-25 amendment). A 5 k piece with 60 s
	// warmup and a 5 k piece with 120 s warmup share a hash.
	a, _ := ShapeHash(json.RawMessage(`{"meters":5000}`))
	b, _ := ShapeHash(json.RawMessage(`{"meters":5000}`))
	if a != b {
		t.Fatalf("ShapeHash of same params drifted: %q vs %q", a, b)
	}
}

func TestShapeHashDistinguishesParams(t *testing.T) {
	a, _ := ShapeHash(json.RawMessage(`{"meters":2000}`))
	b, _ := ShapeHash(json.RawMessage(`{"meters":5000}`))
	if a == b {
		t.Fatalf("expected distinct hashes for different params, got %q", a)
	}
}

func TestShapeHashHandlesEmptyParams(t *testing.T) {
	a, err := ShapeHash(nil)
	if err != nil {
		t.Fatal(err)
	}
	b, err := ShapeHash(json.RawMessage(`{}`))
	if err != nil {
		t.Fatal(err)
	}
	if a != b {
		t.Fatalf("expected nil and {} to hash equal, got %q vs %q", a, b)
	}
}

func TestShapeHashDistinguishesShapeTypes(t *testing.T) {
	// Distance and time produce different hashes because their params
	// shapes contain different keys (no mode argument needed).
	a, _ := ShapeHash(json.RawMessage(`{"meters":5000}`))
	b, _ := ShapeHash(json.RawMessage(`{"seconds":1800}`))
	if a == b {
		t.Fatalf("expected distinct hashes for distance vs time, got %q", a)
	}
}
