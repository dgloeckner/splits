package main

import (
	"bytes"
	"context"
	"encoding/csv"
	"reflect"
	"testing"
	"time"

	"github.com/gloeckner-daniel/splits/internal/event"
	"github.com/gloeckner-daniel/splits/internal/storage"
)

// Smoke test: seed a session with N strokes, replay it, assert CSV
// header matches and one data row was emitted per stroke.
func TestReplay_EmitsHeaderAndOneRowPerStroke(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	db, err := storage.Open(":memory:")
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })

	const sessionID = "S-replay"
	started := time.Unix(1700000000, 0).UTC()
	if err := storage.InsertSession(ctx, db.Handle(), sessionID, "R1", started, 3, ""); err != nil {
		t.Fatalf("insert session: %v", err)
	}

	const nStrokes = 6
	for i := 1; i <= nStrokes; i++ {
		at := started.Add(time.Duration(i) * 2 * time.Second)
		p := event.StrokePayload{
			StrokeNo:        i,
			TimeSec:         float64(i) * 2.0,
			DistanceM:       i * 8,
			SPM:             24,
			PowerW:          180,
			CalPerHr:        7200,
			Level:           3,
			DPS:             8,
			StrokeCycleSec:  2.0,
			PaceSecPer500m:  140,
			EnergyJoules:    360,
			Phase:           "work",
		}
		if err := storage.InsertStroke(ctx, db.Handle(), uint64(i), sessionID, at, p); err != nil {
			t.Fatalf("insert stroke %d: %v", i, err)
		}
	}

	var buf bytes.Buffer
	if err := Replay(ctx, db.Handle(), sessionID, &buf); err != nil {
		t.Fatalf("replay: %v", err)
	}

	r := csv.NewReader(&buf)
	rows, err := r.ReadAll()
	if err != nil {
		t.Fatalf("parse csv: %v", err)
	}
	if len(rows) == 0 {
		t.Fatalf("empty CSV output")
	}
	if !reflect.DeepEqual(rows[0], csvHeader) {
		t.Errorf("CSV header = %v, want %v", rows[0], csvHeader)
	}
	if got, want := len(rows)-1, nStrokes; got != want {
		t.Fatalf("data rows = %d, want %d (one per stroke)", got, want)
	}

	// Spot-check the first data row: stroke_no="1", phase="work", and
	// pace_sec_per_500m is the windowed live value (non-zero by stroke
	// 6 even if the first stroke is the empty/seed case).
	first := rows[1]
	if first[0] != "1" {
		t.Errorf("first row stroke_no = %q, want %q", first[0], "1")
	}
	if first[len(first)-1] != "work" {
		t.Errorf("first row phase = %q, want %q", first[len(first)-1], "work")
	}
	// Last stroke: windowed pace should be a value (not zero/held-from-empty).
	last := rows[nStrokes]
	if last[9] == "0" {
		t.Errorf("last row pace_sec_per_500m = 0; expected windowed value by stroke %d", nStrokes)
	}
}

func TestParseArgs(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name    string
		args    []string
		want    string
		wantErr bool
	}{
		{"positional", []string{"S-abc"}, "S-abc", false},
		{"flag", []string{"--session-id=S-abc"}, "S-abc", false},
		{"flag-space", []string{"--session-id", "S-abc"}, "S-abc", false},
		{"missing", []string{}, "", true},
		{"empty-flag", []string{"--session-id="}, "", true},
	}
	for _, tc := range cases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			got, err := parseArgs(tc.args)
			if (err != nil) != tc.wantErr {
				t.Fatalf("err = %v, wantErr=%v", err, tc.wantErr)
			}
			if got != tc.want {
				t.Errorf("got=%q want=%q", got, tc.want)
			}
		})
	}
}
