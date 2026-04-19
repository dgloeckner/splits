package ipm

import (
	"bytes"
	"context"
	"io"
	"strings"
	"testing"
	"time"
)

// One valid A8 record from session-m1.csv row 1:
//   time_sec=2.0, distance_m=8, spm=21, power_w=77, cal_per_hr=560,
//   level=3, raw_payload=000020000810238021077056403
const validA8Line = "A8000020000810238021077056403\r\n"

func TestParse_SingleValidA8(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()

	out := make(chan Frame, 1)
	done := make(chan error, 1)
	go func() { done <- Parse(ctx, strings.NewReader(validA8Line), out) }()

	select {
	case f := <-out:
		if f.TimeSec != 2.0 {
			t.Errorf("TimeSec = %v, want 2.0", f.TimeSec)
		}
		if f.DistanceM != 8 {
			t.Errorf("DistanceM = %d, want 8", f.DistanceM)
		}
		if f.SPM != 21 {
			t.Errorf("SPM = %d, want 21", f.SPM)
		}
		if f.PowerW != 77 {
			t.Errorf("PowerW = %d, want 77", f.PowerW)
		}
		if f.CalPerHr != 560 {
			t.Errorf("CalPerHr = %d, want 560", f.CalPerHr)
		}
		if f.Level != 3 {
			t.Errorf("Level = %d, want 3", f.Level)
		}
		if f.RawPayload != "000020000810238021077056403" {
			t.Errorf("RawPayload = %q, want the 27-digit payload", f.RawPayload)
		}
	case <-ctx.Done():
		t.Fatal("timed out waiting for frame")
	}

	if err := <-done; err != nil {
		t.Errorf("Parse returned %v, want nil (EOF is clean)", err)
	}
}

func TestParse_SkipsGarbageBetweenFrames(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()

	input := bytes.NewBufferString(
		"garbage nonsense\r\n" +
			"A8short\r\n" + // too short, not digits
			"A8000020000810238021077056403\r\n" + // valid
			"A8000040001610212030131074803\r\n", // valid
	)

	out := make(chan Frame, 4)
	done := make(chan error, 1)
	go func() { done <- Parse(ctx, input, out) }()

	var got []Frame
	for i := 0; i < 2; i++ {
		select {
		case f := <-out:
			got = append(got, f)
		case <-ctx.Done():
			t.Fatalf("timed out after %d frames", len(got))
		}
	}
	if err := <-done; err != nil {
		t.Errorf("Parse returned %v, want nil", err)
	}

	if len(got) != 2 {
		t.Fatalf("got %d frames, want 2", len(got))
	}
	if got[0].DistanceM != 8 || got[1].DistanceM != 16 {
		t.Errorf("DistanceM sequence = [%d, %d], want [8, 16]", got[0].DistanceM, got[1].DistanceM)
	}
}

func TestParse_FrameSplitAcrossReads(t *testing.T) {
	// Simulate a serial read that delivers a frame in two chunks.
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()

	input := &chunkedReader{chunks: [][]byte{
		[]byte("A80000200008102"),
		[]byte("38021077056403\r\n"),
	}}

	out := make(chan Frame, 1)
	done := make(chan error, 1)
	go func() { done <- Parse(ctx, input, out) }()

	select {
	case f := <-out:
		if f.RawPayload != "000020000810238021077056403" {
			t.Errorf("RawPayload = %q, want reassembled payload", f.RawPayload)
		}
	case <-ctx.Done():
		t.Fatal("timed out")
	}

	if err := <-done; err != nil {
		t.Errorf("Parse returned %v, want nil", err)
	}
}

// chunkedReader hands out its chunks one Read() at a time, then EOF.
type chunkedReader struct {
	chunks [][]byte
	i      int
}

func (r *chunkedReader) Read(p []byte) (int, error) {
	if r.i >= len(r.chunks) {
		return 0, io.EOF
	}
	n := copy(p, r.chunks[r.i])
	r.i++
	return n, nil
}
