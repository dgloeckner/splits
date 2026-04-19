package ipm

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestFixtureProducer_Fast_EmitsAllFrames(t *testing.T) {
	path := filepath.Join("..", "..", "..", "specs", "int", "fixtures", "ipm", "session-short.csv")
	p := &FixtureProducer{Path: path, Pacing: PacingFast}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	out := make(chan Frame, 256)
	done := make(chan error, 1)
	go func() { done <- p.Run(ctx, out) }()

	var got []Frame
	for f := range out {
		got = append(got, f)
	}
	if err := <-done; err != nil {
		t.Fatalf("Run: %v", err)
	}

	if len(got) < 10 {
		t.Fatalf("got %d frames, want at least 10 from session-short.csv", len(got))
	}
	// Spot-check the first row from the fixture:
	// time_sec=24.0, distance_m=25, level=3.
	if got[0].TimeSec != 24.0 || got[0].DistanceM != 25 || got[0].Level != 3 {
		t.Errorf("first frame = %+v, want TimeSec=24 DistanceM=25 Level=3", got[0])
	}
}

func TestFixtureProducer_Realtime_Paces(t *testing.T) {
	// Build a tiny synthetic CSV with two rows ~200 ms apart and verify
	// that realtime pacing takes at least that long.
	tmp := writeTempCSV(t,
		"capture_ts,time_sec,distance_m,spm,power_w,cal_per_hr,level,marker,unknown_13_16,footer_24_25,raw_payload",
		"10.000,2.0,8,21,77,560,3,102,380,4,000020000810238021077056403",
		"10.200,4.0,16,30,131,740,3,102,120,8,000040001610212030131074803",
	)
	p := &FixtureProducer{Path: tmp, Pacing: PacingRealtime}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	out := make(chan Frame, 2)
	start := time.Now()
	if err := p.Run(ctx, out); err != nil {
		t.Fatalf("Run: %v", err)
	}
	elapsed := time.Since(start)

	var got []Frame
	for f := range out {
		got = append(got, f)
	}
	if len(got) != 2 {
		t.Fatalf("got %d frames, want 2", len(got))
	}
	if elapsed < 150*time.Millisecond {
		t.Errorf("realtime pacing returned after %v; expected >= ~200ms", elapsed)
	}
	if elapsed > 500*time.Millisecond {
		t.Errorf("realtime pacing returned after %v; expected not much more than 200ms", elapsed)
	}
}

func TestFixtureProducer_ContextCancel_StopsEarly(t *testing.T) {
	tmp := writeTempCSV(t,
		"capture_ts,time_sec,distance_m,spm,power_w,cal_per_hr,level,marker,unknown_13_16,footer_24_25,raw_payload",
		"10.000,2.0,8,21,77,560,3,102,380,4,000020000810238021077056403",
		"20.000,4.0,16,30,131,740,3,102,120,8,000040001610212030131074803",
	)
	p := &FixtureProducer{Path: tmp, Pacing: PacingRealtime}

	ctx, cancel := context.WithCancel(context.Background())
	out := make(chan Frame, 2)
	done := make(chan error, 1)
	go func() { done <- p.Run(ctx, out) }()

	// Receive the first frame, then cancel; the second would take ~10s
	// under realtime pacing but cancellation should unblock Run quickly.
	<-out
	cancel()

	select {
	case err := <-done:
		if err != nil && err != context.Canceled {
			t.Errorf("Run returned %v, want nil or context.Canceled", err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("Run did not return within 2s of cancel")
	}
}

func writeTempCSV(t *testing.T, lines ...string) string {
	t.Helper()
	dir := t.TempDir()
	path := filepath.Join(dir, "fixture.csv")
	f, err := os.Create(path)
	if err != nil {
		t.Fatal(err)
	}
	for _, line := range lines {
		if _, err := f.WriteString(line + "\n"); err != nil {
			t.Fatal(err)
		}
	}
	if err := f.Close(); err != nil {
		t.Fatal(err)
	}
	return path
}
