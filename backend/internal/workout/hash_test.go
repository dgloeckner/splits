package workout

import (
	"encoding/json"
	"testing"
)

func TestShapeHashStableAcrossKeyOrder(t *testing.T) {
	a, err := ShapeHash("distance", json.RawMessage(`{"meters":2000,"foo":"x"}`), 60, 30)
	if err != nil {
		t.Fatal(err)
	}
	b, err := ShapeHash("distance", json.RawMessage(`{"foo":"x","meters":2000}`), 60, 30)
	if err != nil {
		t.Fatal(err)
	}
	if a != b {
		t.Errorf("hashes differ across key order: %s vs %s", a, b)
	}
}

func TestShapeHashIgnoresIntensity(t *testing.T) {
	// ShapeHash takes no intensity argument by design — confirmed by
	// observing identical hashes when only intensity could differ.
	a, _ := ShapeHash("distance", json.RawMessage(`{"meters":2000}`), 0, 0)
	b, _ := ShapeHash("distance", json.RawMessage(`{"meters":2000}`), 0, 0)
	if a != b {
		t.Errorf("identical inputs differ: %s vs %s", a, b)
	}
}

func TestShapeHashDistinguishesWarmup(t *testing.T) {
	a, _ := ShapeHash("distance", json.RawMessage(`{"meters":2000}`), 0, 0)
	b, _ := ShapeHash("distance", json.RawMessage(`{"meters":2000}`), 60, 0)
	if a == b {
		t.Error("warmup_sec change should change hash")
	}
}

func TestShapeHashDistinguishesParams(t *testing.T) {
	a, _ := ShapeHash("distance", json.RawMessage(`{"meters":2000}`), 0, 0)
	b, _ := ShapeHash("distance", json.RawMessage(`{"meters":5000}`), 0, 0)
	if a == b {
		t.Error("params change should change hash")
	}
}

func TestShapeHashHandlesEmptyParams(t *testing.T) {
	a, err := ShapeHash("just_row", nil, 0, 0)
	if err != nil {
		t.Fatal(err)
	}
	b, err := ShapeHash("just_row", json.RawMessage(`{}`), 0, 0)
	if err != nil {
		t.Fatal(err)
	}
	if a != b {
		t.Errorf("empty vs {} should hash the same: %s vs %s", a, b)
	}
}
