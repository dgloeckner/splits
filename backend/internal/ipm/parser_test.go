package ipm

import (
	"bytes"
	"context"
	"encoding/csv"
	"io"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"
)

// One valid A8 record from session-m1.csv row 1. Decoded under the
// corrected May-2026 field layout:
//   - elapsed = 2 s        ([1:5])
//   - distance = 8 m       ([5:10])
//   - device-class = "1"   ([10])
//   - split = 2:38 /500m  ([11:15] = "0238" → 2 min 38 sec → 158 s)
//   - SPM = 21             ([15:18])  (3 digits, was 2)
//   - power = 77 W         ([18:21])
//   - cal/hr = 564         ([21:25])  (4 digits — old parser read 560)
//   - level = 3            ([25:27])
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
		if f.DeviceClass != "1" {
			t.Errorf("DeviceClass = %q, want \"1\"", f.DeviceClass)
		}
		if f.DeviceSplitPaceSec != 2*60+38 {
			t.Errorf("DeviceSplitPaceSec = %d, want %d", f.DeviceSplitPaceSec, 2*60+38)
		}
		if f.SPM != 21 {
			t.Errorf("SPM = %d, want 21", f.SPM)
		}
		if f.PowerW != 77 {
			t.Errorf("PowerW = %d, want 77", f.PowerW)
		}
		if f.CalPerHr != 564 {
			t.Errorf("CalPerHr = %d, want 564", f.CalPerHr)
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

func TestParse_GoldenFixtures(t *testing.T) {
	fixtures, err := filepath.Glob(filepath.Join("..", "..", "..", "specs", "int", "fixtures", "ipm", "session-*.csv"))
	if err != nil {
		t.Fatalf("glob: %v", err)
	}
	if len(fixtures) == 0 {
		t.Fatal("no fixtures found — run tests from backend/")
	}

	for _, path := range fixtures {
		t.Run(filepath.Base(path), func(t *testing.T) {
			rows := readCSV(t, path)
			var serialBytes strings.Builder
			for _, row := range rows {
				serialBytes.WriteString("A8")
				serialBytes.WriteString(row["raw_payload"])
				serialBytes.WriteString("\r\n")
			}

			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()

			out := make(chan Frame, len(rows))
			done := make(chan error, 1)
			go func() { done <- Parse(ctx, strings.NewReader(serialBytes.String()), out) }()

			var got []Frame
			for f := range out {
				got = append(got, f)
			}
			if err := <-done; err != nil {
				t.Fatalf("Parse: %v", err)
			}

			if len(got) != len(rows) {
				t.Fatalf("got %d frames, want %d", len(got), len(rows))
			}
			for i, row := range rows {
				assertFrame(t, i, got[i], row)
			}
		})
	}
}

func readCSV(t *testing.T, path string) []map[string]string {
	t.Helper()
	f, err := os.Open(path)
	if err != nil {
		t.Fatalf("open %s: %v", path, err)
	}
	defer f.Close()

	r := csv.NewReader(f)
	header, err := r.Read()
	if err != nil {
		t.Fatalf("read header: %v", err)
	}

	var rows []map[string]string
	for {
		rec, err := r.Read()
		if err == io.EOF {
			break
		}
		if err != nil {
			t.Fatalf("read row: %v", err)
		}
		m := make(map[string]string, len(header))
		for i, h := range header {
			m[h] = rec[i]
		}
		rows = append(rows, m)
	}
	return rows
}

func assertFrame(t *testing.T, i int, f Frame, row map[string]string) {
	t.Helper()
	check := func(field string, got, want any) {
		if got != want {
			t.Errorf("row %d %s: got %v, want %v", i, field, got, want)
		}
	}
	// Stable fields — unchanged by the May-2026 spec revision.
	check("time_sec", f.TimeSec, atoF(t, row["time_sec"]))
	check("distance_m", f.DistanceM, atoI(t, row["distance_m"]))
	check("spm", f.SPM, atoI(t, row["spm"]))
	check("power_w", f.PowerW, atoI(t, row["power_w"]))
	check("level", f.Level, atoI(t, row["level"]))
	check("raw_payload", f.RawPayload, row["raw_payload"])

	// cal_per_hr — the original CSV truncated the units digit
	// (only the 3-digit [21:24] field was read, then ×10). The
	// new parser reads the full 4-digit [21:25] field, so the
	// expected value is (old × 10 cap) + the old "footer_24_25"
	// digit. This is the cleanest proof that the units digit
	// belongs to cal/hr.
	oldCal := atoI(t, row["cal_per_hr"])
	footer := atoI(t, row["footer_24_25"])
	check("cal_per_hr (new = old + footer LSB)", f.CalPerHr, oldCal+footer)

	// Device-class byte sits where the original "marker" field's
	// first digit was. On firmware V115 this is constant "1".
	check("device_class (first marker digit)", f.DeviceClass, row["marker"][0:1])

	// Device split-pace: the original "marker" was 3 digits whose
	// last two are split-minutes, and the original "unknown_13_16"
	// was 3 digits whose first two are split-seconds. Reassemble
	// to verify the new decoder agrees.
	splitMin := atoI(t, row["marker"][1:3])
	splitSec := atoI(t, row["unknown_13_16"][0:2])
	check("device_split_pace_sec", f.DeviceSplitPaceSec, splitMin*60+splitSec)
}

func atoI(t *testing.T, s string) int {
	t.Helper()
	n, err := strconv.Atoi(s)
	if err != nil {
		t.Fatalf("atoi %q: %v", s, err)
	}
	return n
}

func atoF(t *testing.T, s string) float64 {
	t.Helper()
	f, err := strconv.ParseFloat(s, 64)
	if err != nil {
		t.Fatalf("parse float %q: %v", s, err)
	}
	return f
}

// FuzzDecodeA8Line ensures decodeA8Line never panics on arbitrary
// input. mustAtoi is gated by an explicit digit-only check, so any
// regression that lets non-digit bytes through would be caught here.
func FuzzDecodeA8Line(f *testing.F) {
	for _, seed := range []string{
		"",
		"A8",
		"A8" + "abc",
		"A8" + "0123456789012345678901234567",       // 28 chars (off-by-one)
		"A8" + "012345678901234567890123456",         // 27 chars valid
		"A8" + "0123456789012345!23456789012",        // 27 chars w/ symbol
		"A8" + "01234567890\u00ff45678901234567",     // non-ASCII
		"\x00\x01\x02",
	} {
		f.Add(seed)
	}
	f.Fuzz(func(t *testing.T, in string) {
		// Must not panic for any input.
		_, _ = decodeA8Line(in)
	})
}
