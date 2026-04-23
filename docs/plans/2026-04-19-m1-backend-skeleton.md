# M1 Backend Skeleton Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the Go backend skeleton for the home-ergo project — a module layout, config loader, IPM A8 parser with golden tests against the captured CSV fixtures, a pluggable event producer (serial or fixture), and a minimal HTTP server with `/api/health` — such that running `go run ./cmd/homeergo` either reads the ergo over USB-serial or replays a captured session and prints one decoded stroke per line to stdout.

**Architecture:** Single Go module at `backend/`. Two test seams: the parser consumes an `io.Reader` (byte-level unit tests), and the rest of the pipeline consumes `ipm.Frame` values emitted by an `EventProducer` interface (pipeline-level tests with synthetic frames). `SerialProducer` wraps `go.bug.st/serial`; `FixtureProducer` replays a CSV fixture at realtime or fast pacing. No sessionizer, no SQLite, no SSE, no auth — those land in M2/M3.

**Tech Stack:** Go 1.22+, stdlib `net/http` (1.22 routing), `log/slog`, `go.bug.st/serial`, `testing` stdlib, `gofmt`/`go vet`/`staticcheck`.

**Spec reference:** [`specs/arch/0001-backend-pipeline.md`](../../specs/arch/0001-backend-pipeline.md) (ARCH-0001), [`specs/int/0001-ipm-serial-protocol.md`](../../specs/int/0001-ipm-serial-protocol.md) (INT-0001).

**Module path:** This plan uses `github.com/gloeckner-daniel/home-ergo`. If your GitHub handle or repo name differs, change it in `backend/go.mod` in Task 1 and update every import line that follows.

---

## File Structure

Files created in this plan (all under `backend/`):

```
backend/
├── go.mod
├── go.sum
├── Makefile
├── .gitignore
├── cmd/homeergo/
│   └── main.go
└── internal/
    ├── config/
    │   ├── config.go
    │   └── config_test.go
    ├── event/
    │   └── event.go
    ├── ipm/
    │   ├── frame.go
    │   ├── parser.go
    │   ├── parser_test.go
    │   ├── producer.go
    │   ├── producer_fixture.go
    │   ├── producer_fixture_test.go
    │   └── producer_serial.go
    └── api/
        ├── middleware.go
        ├── router.go
        ├── health.go
        └── health_test.go
```

One file, one responsibility. `producer.go` holds the interface; fixture and serial get their own files so the serial file can depend on `go.bug.st/serial` without contaminating the fixture test path.

---

## Task 1: Bootstrap the Go module

**Files:**
- Create: `backend/go.mod`
- Create: `backend/.gitignore`
- Create: `backend/Makefile`

- [ ] **Step 1: Create `backend/` directory and initialise the module**

Run from the repo root:

```bash
mkdir -p backend && cd backend && go mod init github.com/gloeckner-daniel/home-ergo
```

Expected: a `go.mod` file is created with `module github.com/gloeckner-daniel/home-ergo` and `go 1.22` (or the installed minor version ≥ 1.22).

- [ ] **Step 2: Write the `.gitignore`**

Create `backend/.gitignore`:

```
/homeergo
/homeergo.exe
/homeergo-*
/coverage.out
/coverage.html
```

- [ ] **Step 3: Write the `Makefile`**

Create `backend/Makefile`:

```makefile
.PHONY: build test vet lint run fmt clean

GO ?= go
BIN := homeergo

build:
	$(GO) build -o $(BIN) ./cmd/homeergo

test:
	$(GO) test ./...

vet:
	$(GO) vet ./...

lint: vet
	@command -v staticcheck >/dev/null || $(GO) install honnef.co/go/tools/cmd/staticcheck@latest
	staticcheck ./...

fmt:
	$(GO) fmt ./...

run:
	$(GO) run ./cmd/homeergo

clean:
	rm -f $(BIN) $(BIN).exe coverage.out coverage.html
```

- [ ] **Step 4: Verify the module compiles**

Run from `backend/`:

```bash
go build ./...
```

Expected: exits 0 with no output. `go.mod` is unchanged (no deps yet).

- [ ] **Step 5: Commit**

```bash
git add backend/go.mod backend/.gitignore backend/Makefile
git commit -m "feat(backend): bootstrap Go module and Makefile"
```

---

## Task 2: Config package — write the failing test

**Files:**
- Create: `backend/internal/config/config.go` (stub only — real impl in Task 3)
- Create: `backend/internal/config/config_test.go`

- [ ] **Step 1: Write the stub so the test file compiles**

Create `backend/internal/config/config.go`:

```go
package config

import "time"

// Config is the fully-resolved runtime configuration. See
// specs/arch/0001-backend-pipeline.md for the list of env vars.
type Config struct {
	Addr         string
	SerialPort   string
	SerialBaud   int
	DBPath       string
	Fixture      string
	FixtureRate  string
	LogLevel     string
	IdleTimeout  time.Duration
}

// Load is defined in Task 3.
func Load(env func(string) string) (*Config, error) {
	return nil, nil
}
```

- [ ] **Step 2: Write the failing test**

Create `backend/internal/config/config_test.go`:

```go
package config

import (
	"testing"
	"time"
)

func TestLoad_AllDefaults(t *testing.T) {
	env := func(string) string { return "" }

	got, err := Load(env)
	if err != nil {
		t.Fatalf("Load() unexpected error: %v", err)
	}
	want := &Config{
		Addr:        ":8080",
		SerialPort:  "",
		SerialBaud:  9600,
		DBPath:      "./homeergo.db",
		Fixture:     "",
		FixtureRate: "realtime",
		LogLevel:    "info",
		IdleTimeout: 60 * time.Second,
	}
	if *got != *want {
		t.Errorf("Load() = %+v, want %+v", got, want)
	}
}

func TestLoad_EnvOverrides(t *testing.T) {
	env := map[string]string{
		"HOMEERGO_ADDR":         ":9090",
		"HOMEERGO_SERIAL_PORT":  "/dev/cu.usbserial-AB0JKG07",
		"HOMEERGO_SERIAL_BAUD":  "19200",
		"HOMEERGO_DB_PATH":      "/var/lib/homeergo.db",
		"HOMEERGO_FIXTURE":      "./session-m1.csv",
		"HOMEERGO_FIXTURE_RATE": "fast",
		"HOMEERGO_LOG_LEVEL":    "debug",
		"HOMEERGO_IDLE_TIMEOUT": "30s",
	}
	lookup := func(k string) string { return env[k] }

	got, err := Load(lookup)
	if err != nil {
		t.Fatalf("Load() unexpected error: %v", err)
	}
	want := &Config{
		Addr:        ":9090",
		SerialPort:  "/dev/cu.usbserial-AB0JKG07",
		SerialBaud:  19200,
		DBPath:      "/var/lib/homeergo.db",
		Fixture:     "./session-m1.csv",
		FixtureRate: "fast",
		LogLevel:    "debug",
		IdleTimeout: 30 * time.Second,
	}
	if *got != *want {
		t.Errorf("Load() = %+v, want %+v", got, want)
	}
}

func TestLoad_InvalidBaud(t *testing.T) {
	env := func(k string) string {
		if k == "HOMEERGO_SERIAL_BAUD" {
			return "not-a-number"
		}
		return ""
	}
	if _, err := Load(env); err == nil {
		t.Fatal("Load() expected error for bad baud, got nil")
	}
}

func TestLoad_InvalidIdleTimeout(t *testing.T) {
	env := func(k string) string {
		if k == "HOMEERGO_IDLE_TIMEOUT" {
			return "not-a-duration"
		}
		return ""
	}
	if _, err := Load(env); err == nil {
		t.Fatal("Load() expected error for bad idle timeout, got nil")
	}
}

func TestLoad_InvalidFixtureRate(t *testing.T) {
	env := func(k string) string {
		if k == "HOMEERGO_FIXTURE_RATE" {
			return "hyperspeed"
		}
		return ""
	}
	if _, err := Load(env); err == nil {
		t.Fatal("Load() expected error for unknown fixture rate, got nil")
	}
}
```

- [ ] **Step 3: Run the tests — they must fail**

```bash
cd backend && go test ./internal/config/
```

Expected: all tests fail. `TestLoad_AllDefaults` fails with a nil-pointer dereference on `*got`; `TestLoad_EnvOverrides` same; the "invalid" tests fail because `Load` returns `nil, nil`.

---

## Task 3: Config package — implement

**Files:**
- Modify: `backend/internal/config/config.go`

- [ ] **Step 1: Replace the stub with the real implementation**

Overwrite `backend/internal/config/config.go`:

```go
package config

import (
	"fmt"
	"strconv"
	"time"
)

// Config is the fully-resolved runtime configuration. See
// specs/arch/0001-backend-pipeline.md for the list of env vars.
type Config struct {
	Addr         string
	SerialPort   string
	SerialBaud   int
	DBPath       string
	Fixture      string
	FixtureRate  string
	LogLevel     string
	IdleTimeout  time.Duration
}

// Load resolves a Config from environment variables via the supplied
// lookup function. Passing os.Getenv in main and a map-backed closure
// in tests keeps Load pure and deterministic.
func Load(env func(string) string) (*Config, error) {
	c := &Config{
		Addr:        getenv(env, "HOMEERGO_ADDR", ":8080"),
		SerialPort:  getenv(env, "HOMEERGO_SERIAL_PORT", ""),
		DBPath:      getenv(env, "HOMEERGO_DB_PATH", "./homeergo.db"),
		Fixture:     getenv(env, "HOMEERGO_FIXTURE", ""),
		FixtureRate: getenv(env, "HOMEERGO_FIXTURE_RATE", "realtime"),
		LogLevel:    getenv(env, "HOMEERGO_LOG_LEVEL", "info"),
	}

	baudStr := getenv(env, "HOMEERGO_SERIAL_BAUD", "9600")
	baud, err := strconv.Atoi(baudStr)
	if err != nil {
		return nil, fmt.Errorf("HOMEERGO_SERIAL_BAUD %q: %w", baudStr, err)
	}
	c.SerialBaud = baud

	idleStr := getenv(env, "HOMEERGO_IDLE_TIMEOUT", "60s")
	idle, err := time.ParseDuration(idleStr)
	if err != nil {
		return nil, fmt.Errorf("HOMEERGO_IDLE_TIMEOUT %q: %w", idleStr, err)
	}
	c.IdleTimeout = idle

	switch c.FixtureRate {
	case "realtime", "fast":
		// ok
	default:
		return nil, fmt.Errorf("HOMEERGO_FIXTURE_RATE %q: want realtime or fast", c.FixtureRate)
	}

	return c, nil
}

func getenv(env func(string) string, key, fallback string) string {
	if v := env(key); v != "" {
		return v
	}
	return fallback
}
```

- [ ] **Step 2: Run the tests — they must pass**

```bash
cd backend && go test ./internal/config/
```

Expected: `ok  github.com/gloeckner-daniel/home-ergo/internal/config`.

- [ ] **Step 3: Commit**

```bash
git add backend/internal/config/
git commit -m "feat(backend): add config package with env loader"
```

---

## Task 4: Event types

**Files:**
- Create: `backend/internal/event/event.go`

The `event` package defines the internal type that flows through the pipeline from the sessionizer (M2) onward. In M1 we only need the types to compile and marshal, because the M1 binary only prints `ipm.Frame` to stdout — not `event.Event`. Defining the type now avoids a churn commit in M2.

- [ ] **Step 1: Write the file**

Create `backend/internal/event/event.go`:

```go
// Package event defines the pipeline-internal Event type used from the
// sessionizer onward. See specs/arch/0001-backend-pipeline.md.
package event

import "time"

// Kind discriminates the Event payload variants.
type Kind uint8

const (
	KindStroke Kind = iota + 1
	KindSessionStart
	KindSessionEnd
	KindLevelChange
)

// Event is the internal envelope handed from the sessionizer to every
// downstream consumer. Exactly one of the pointer fields is non-nil,
// determined by Kind.
type Event struct {
	ID        uint64    // lifetime-monotonic, stamped by the sessionizer
	Kind      Kind
	SessionID string    // ULID; set on session_start, copied into subsequent events
	At        time.Time // server receive time

	Stroke       *StrokePayload
	SessionStart *SessionStartPayload
	SessionEnd   *SessionEndPayload
	LevelChange  *LevelChangePayload
}

// StrokePayload carries one decoded A8 message plus Tier-2 derivations.
// The Tier-2 fields (DPS, StrokeCycleSec, PaceSecPer500m, EnergyJoules)
// are zero in M1 — they are populated by the sessionizer in M2.
type StrokePayload struct {
	StrokeNo    int
	TimeSec     float64
	DistanceM   int
	SPM         int
	PowerW      int
	CalPerHr    int
	Level       int
	RawPayload  string
	UnknownJSON []byte

	DPS             float64
	StrokeCycleSec  float64
	PaceSecPer500m  int
	EnergyJoules    int
}

type SessionStartPayload struct {
	StartedAt    time.Time
	RowerID      string
	RowerName    string
	InitialLevel int
}

type SessionEndPayload struct {
	EndedAt time.Time
	Summary SessionSummary
}

type SessionSummary struct {
	TotalDistanceM    int
	TotalTimeSec      float64
	TotalStrokes      int
	AvgPowerW         int
	PeakPowerW        int
	AvgSPM            float64
	AvgDPS            float64
	AvgPaceSecPer500m int
	SessionCalories   int
}

type LevelChangePayload struct {
	From       int
	To         int
	AtStroke   int
	AtTimeSec  float64
}
```

- [ ] **Step 2: Verify it compiles**

```bash
cd backend && go build ./internal/event/
```

Expected: exits 0 with no output.

- [ ] **Step 3: Commit**

```bash
git add backend/internal/event/
git commit -m "feat(backend): add event types"
```

---

## Task 5: IPM frame type

**Files:**
- Create: `backend/internal/ipm/frame.go`

- [ ] **Step 1: Write the file**

Create `backend/internal/ipm/frame.go`:

```go
// Package ipm decodes the FDF IPM serial protocol (INT-0001). Frames
// emitted by the parser are consumed by the sessionizer in M2; in M1
// they are printed to stdout by cmd/homeergo for protocol verification.
package ipm

import "time"

// Frame is one decoded A8 live-data message. Field numbers reference
// the 27-digit payload layout in INT-0001.
type Frame struct {
	ReceivedAt time.Time // server wall-clock time the frame was parsed

	TimeSec    float64 // [0:6]  MMM SS T — elapsed rowing time
	DistanceM  int     // [6:10] cumulative distance in meters
	Marker     string  // [10:13] pass-through, unverified
	Unknown    string  // [13:16] pass-through, unverified
	SPM        int     // [16:18] strokes per minute
	PowerW     int     // [18:21] watts
	CalPerHr   int     // [21:24] × 10 — calories per hour
	Footer     string  // [24:25] single-digit pass-through, unverified
	Level      int     // [25:27] resistance level 1-16

	RawPayload string // original 27-digit ASCII payload without the "A8" prefix
}
```

- [ ] **Step 2: Verify it compiles**

```bash
cd backend && go build ./internal/ipm/
```

- [ ] **Step 3: Commit**

```bash
git add backend/internal/ipm/frame.go
git commit -m "feat(ipm): add Frame type"
```

---

## Task 6: IPM parser — failing test for the happy path

**Files:**
- Create: `backend/internal/ipm/parser.go` (stub only — real impl in Task 7)
- Create: `backend/internal/ipm/parser_test.go`

- [ ] **Step 1: Write the stub**

Create `backend/internal/ipm/parser.go`:

```go
package ipm

import (
	"context"
	"io"
)

// Parse reads raw IPM bytes from r and emits decoded Frames on out.
// It closes out when r returns io.EOF or ctx is cancelled. Malformed
// lines are skipped with a warning on the standard slog logger.
//
// Implementation lands in Task 7.
func Parse(ctx context.Context, r io.Reader, out chan<- Frame) error {
	panic("not implemented")
}
```

- [ ] **Step 2: Write the failing test**

Create `backend/internal/ipm/parser_test.go`:

```go
package ipm

import (
	"bytes"
	"context"
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
```

- [ ] **Step 3: Add the missing import to the test**

Edit `backend/internal/ipm/parser_test.go` to add `"io"` to the imports (the `chunkedReader` uses `io.EOF`):

```go
import (
	"bytes"
	"context"
	"io"
	"strings"
	"testing"
	"time"
)
```

- [ ] **Step 4: Run the tests — they must fail by panicking**

```bash
cd backend && go test ./internal/ipm/
```

Expected: all three tests fail because `Parse` panics with "not implemented". The panic recovery in `testing` reports each as failed.

---

## Task 7: IPM parser — implement

**Files:**
- Modify: `backend/internal/ipm/parser.go`

- [ ] **Step 1: Replace the stub with the real implementation**

Overwrite `backend/internal/ipm/parser.go`:

```go
package ipm

import (
	"bufio"
	"context"
	"errors"
	"io"
	"log/slog"
	"strconv"
	"strings"
	"time"
)

// Parse reads raw IPM bytes from r and emits decoded Frames on out.
// It closes out when r returns io.EOF or ctx is cancelled. Malformed
// lines are skipped with a warn log; the loop does not abort on
// individual decode errors (the IPM occasionally emits junk on cold
// boot per INT-0001).
func Parse(ctx context.Context, r io.Reader, out chan<- Frame) error {
	defer close(out)

	// The IPM is line-oriented with CRLF. bufio.Scanner with the default
	// ScanLines split function strips both \r and \n, which is what we
	// want. The default 64 KiB buffer is ample for 30-byte frames.
	sc := bufio.NewScanner(r)
	sc.Buffer(make([]byte, 0, 4096), 64*1024)

	for sc.Scan() {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}

		line := sc.Text()
		f, ok := decodeA8Line(line)
		if !ok {
			if strings.TrimSpace(line) != "" {
				slog.Warn("ipm.parse.skip", "line", line)
			}
			continue
		}

		select {
		case out <- f:
		case <-ctx.Done():
			return ctx.Err()
		}
	}

	if err := sc.Err(); err != nil && !errors.Is(err, io.EOF) {
		return err
	}
	return nil
}

// decodeA8Line decodes one line into a Frame. Returns (zero, false) if
// the line is not a well-formed A8 message.
func decodeA8Line(line string) (Frame, bool) {
	const prefix = "A8"
	if !strings.HasPrefix(line, prefix) {
		return Frame{}, false
	}
	payload := line[len(prefix):]
	if len(payload) != 27 {
		return Frame{}, false
	}
	for i := 0; i < len(payload); i++ {
		if payload[i] < '0' || payload[i] > '9' {
			return Frame{}, false
		}
	}

	// INT-0001 field layout.
	minutes := mustAtoi(payload[0:3])
	seconds := mustAtoi(payload[3:5])
	tenths := mustAtoi(payload[5:6])

	return Frame{
		ReceivedAt: time.Now(),
		TimeSec:    float64(minutes)*60 + float64(seconds) + float64(tenths)/10,
		DistanceM:  mustAtoi(payload[6:10]),
		Marker:     payload[10:13],
		Unknown:    payload[13:16],
		SPM:        mustAtoi(payload[16:18]),
		PowerW:     mustAtoi(payload[18:21]),
		CalPerHr:   mustAtoi(payload[21:24]) * 10,
		Footer:     payload[24:25],
		Level:      mustAtoi(payload[25:27]),
		RawPayload: payload,
	}, true
}

// mustAtoi assumes the caller validated the input is all ASCII digits.
func mustAtoi(s string) int {
	n, err := strconv.Atoi(s)
	if err != nil {
		panic("ipm: mustAtoi called with non-digits: " + s)
	}
	return n
}
```

- [ ] **Step 2: Run the tests — they must pass**

```bash
cd backend && go test ./internal/ipm/
```

Expected: `PASS` for `TestParse_SingleValidA8`, `TestParse_SkipsGarbageBetweenFrames`, `TestParse_FrameSplitAcrossReads`.

- [ ] **Step 3: Commit**

```bash
git add backend/internal/ipm/parser.go backend/internal/ipm/parser_test.go
git commit -m "feat(ipm): parse A8 live-data frames from byte stream"
```

---

## Task 8: IPM parser — golden test against all CSV fixtures

**Files:**
- Modify: `backend/internal/ipm/parser_test.go`

The CSV fixtures under `specs/int/fixtures/ipm/` already contain each row's `raw_payload` alongside the decoded columns. We reconstruct the serial byte stream as `"A8" + raw_payload + "\r\n"`, feed it to `Parse`, and assert the emitted `Frame` fields match the CSV columns row-for-row.

- [ ] **Step 1: Append the golden test**

Append to `backend/internal/ipm/parser_test.go`:

```go
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
	check("time_sec", f.TimeSec, atoF(t, row["time_sec"]))
	check("distance_m", f.DistanceM, atoI(t, row["distance_m"]))
	check("spm", f.SPM, atoI(t, row["spm"]))
	check("power_w", f.PowerW, atoI(t, row["power_w"]))
	check("cal_per_hr", f.CalPerHr, atoI(t, row["cal_per_hr"]))
	check("level", f.Level, atoI(t, row["level"]))
	check("marker", f.Marker, row["marker"])
	check("unknown_13_16", f.Unknown, row["unknown_13_16"])
	check("footer_24_25", f.Footer, row["footer_24_25"])
	check("raw_payload", f.RawPayload, row["raw_payload"])
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
```

- [ ] **Step 2: Update the test file's imports**

The top of `backend/internal/ipm/parser_test.go` must now read:

```go
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
```

- [ ] **Step 3: Run the golden test**

```bash
cd backend && go test ./internal/ipm/ -run TestParse_GoldenFixtures -v
```

Expected: each CSV fixture reports PASS. The five fixtures listed under `specs/int/fixtures/ipm/` must all match the parser output byte-for-byte.

- [ ] **Step 4: Run the whole package**

```bash
cd backend && go test ./internal/ipm/
```

Expected: `ok  github.com/gloeckner-daniel/home-ergo/internal/ipm`.

- [ ] **Step 5: Commit**

```bash
git add backend/internal/ipm/parser_test.go
git commit -m "test(ipm): golden-test parser against captured CSV fixtures"
```

---

## Task 9: Producer interface and FixtureProducer — failing test

**Files:**
- Create: `backend/internal/ipm/producer.go`
- Create: `backend/internal/ipm/producer_fixture.go` (stub only — real impl in Task 10)
- Create: `backend/internal/ipm/producer_fixture_test.go`

- [ ] **Step 1: Write the interface**

Create `backend/internal/ipm/producer.go`:

```go
package ipm

import "context"

// Producer is the source of Frames for the pipeline. SerialProducer
// reads from the FTDI port; FixtureProducer replays a recorded CSV.
// Implementations close out when exhausted or when ctx is cancelled.
type Producer interface {
	Run(ctx context.Context, out chan<- Frame) error
}
```

- [ ] **Step 2: Write the fixture-producer stub**

Create `backend/internal/ipm/producer_fixture.go`:

```go
package ipm

import (
	"context"
	"errors"
)

// Pacing controls how fast a FixtureProducer replays a captured CSV.
type Pacing int

const (
	PacingFast Pacing = iota // emit frames as fast as the channel accepts them (for tests)
	PacingRealtime           // honour the inter-frame capture_ts deltas (for dev)
)

// FixtureProducer replays a CSV fixture from specs/int/fixtures/ipm/.
// The CSV format is exactly what traces/ipm_parser.py produces.
type FixtureProducer struct {
	Path   string
	Pacing Pacing
}

// Run is implemented in Task 10.
func (p *FixtureProducer) Run(ctx context.Context, out chan<- Frame) error {
	close(out)
	return errors.New("not implemented")
}
```

- [ ] **Step 3: Write the failing test**

Create `backend/internal/ipm/producer_fixture_test.go`:

```go
package ipm

import (
	"context"
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
	// Spot-check the first row from the fixture header comment in the plan:
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
```

- [ ] **Step 4: Add the missing import to the test file**

Edit `backend/internal/ipm/producer_fixture_test.go` — imports must be:

```go
import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"
)
```

- [ ] **Step 5: Run the tests — they must fail**

```bash
cd backend && go test ./internal/ipm/ -run TestFixtureProducer
```

Expected: all three FixtureProducer tests fail. `TestFixtureProducer_Fast_EmitsAllFrames` fails because `Run` returns "not implemented" and emits zero frames.

---

## Task 10: FixtureProducer — implement

**Files:**
- Modify: `backend/internal/ipm/producer_fixture.go`

- [ ] **Step 1: Replace the stub with the real implementation**

Overwrite `backend/internal/ipm/producer_fixture.go`:

```go
package ipm

import (
	"context"
	"encoding/csv"
	"fmt"
	"io"
	"os"
	"strconv"
	"time"
)

// Pacing controls how fast a FixtureProducer replays a captured CSV.
type Pacing int

const (
	PacingFast     Pacing = iota // emit frames as fast as the channel accepts them (for tests)
	PacingRealtime               // honour the inter-frame capture_ts deltas (for dev)
)

// FixtureProducer replays a CSV fixture from specs/int/fixtures/ipm/.
// The CSV format is exactly what traces/ipm_parser.py produces.
type FixtureProducer struct {
	Path   string
	Pacing Pacing
}

// Run replays the CSV at the configured pacing. out is closed on
// return (normal EOF, error, or ctx cancellation).
func (p *FixtureProducer) Run(ctx context.Context, out chan<- Frame) error {
	defer close(out)

	f, err := os.Open(p.Path)
	if err != nil {
		return fmt.Errorf("fixture open %s: %w", p.Path, err)
	}
	defer f.Close()

	r := csv.NewReader(f)
	header, err := r.Read()
	if err != nil {
		return fmt.Errorf("fixture header: %w", err)
	}
	idx, err := indexHeader(header)
	if err != nil {
		return fmt.Errorf("fixture %s: %w", p.Path, err)
	}

	var prevCaptureTS float64
	first := true

	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}

		rec, err := r.Read()
		if err == io.EOF {
			return nil
		}
		if err != nil {
			return fmt.Errorf("fixture row: %w", err)
		}

		captureTS, err := strconv.ParseFloat(rec[idx.captureTS], 64)
		if err != nil {
			return fmt.Errorf("fixture row: capture_ts %q: %w", rec[idx.captureTS], err)
		}

		if p.Pacing == PacingRealtime && !first {
			delta := captureTS - prevCaptureTS
			if delta > 0 {
				timer := time.NewTimer(time.Duration(delta * float64(time.Second)))
				select {
				case <-timer.C:
				case <-ctx.Done():
					timer.Stop()
					return ctx.Err()
				}
			}
		}

		frame := Frame{
			ReceivedAt: time.Now(),
			TimeSec:    mustParseFloat(rec[idx.timeSec]),
			DistanceM:  mustParseInt(rec[idx.distanceM]),
			Marker:     rec[idx.marker],
			Unknown:    rec[idx.unknown],
			SPM:        mustParseInt(rec[idx.spm]),
			PowerW:     mustParseInt(rec[idx.powerW]),
			CalPerHr:   mustParseInt(rec[idx.calPerHr]),
			Footer:     rec[idx.footer],
			Level:      mustParseInt(rec[idx.level]),
			RawPayload: rec[idx.rawPayload],
		}

		select {
		case out <- frame:
		case <-ctx.Done():
			return ctx.Err()
		}

		prevCaptureTS = captureTS
		first = false
	}
}

type csvIndex struct {
	captureTS, timeSec, distanceM, spm, powerW, calPerHr, level int
	marker, unknown, footer, rawPayload                         int
}

func indexHeader(h []string) (csvIndex, error) {
	find := func(name string) (int, error) {
		for i, col := range h {
			if col == name {
				return i, nil
			}
		}
		return -1, fmt.Errorf("missing column %q", name)
	}
	var idx csvIndex
	var err error
	cols := []struct {
		name string
		dst  *int
	}{
		{"capture_ts", &idx.captureTS},
		{"time_sec", &idx.timeSec},
		{"distance_m", &idx.distanceM},
		{"spm", &idx.spm},
		{"power_w", &idx.powerW},
		{"cal_per_hr", &idx.calPerHr},
		{"level", &idx.level},
		{"marker", &idx.marker},
		{"unknown_13_16", &idx.unknown},
		{"footer_24_25", &idx.footer},
		{"raw_payload", &idx.rawPayload},
	}
	for _, c := range cols {
		if *c.dst, err = find(c.name); err != nil {
			return csvIndex{}, err
		}
	}
	return idx, nil
}

func mustParseFloat(s string) float64 {
	v, err := strconv.ParseFloat(s, 64)
	if err != nil {
		panic("fixture: ParseFloat: " + err.Error())
	}
	return v
}

func mustParseInt(s string) int {
	v, err := strconv.Atoi(s)
	if err != nil {
		panic("fixture: Atoi: " + err.Error())
	}
	return v
}
```

- [ ] **Step 2: Run the FixtureProducer tests**

```bash
cd backend && go test ./internal/ipm/ -run TestFixtureProducer -v
```

Expected: all three tests pass. The realtime-pacing test should take a little over 200 ms; the cancel test should return within a fraction of a second of `cancel()`.

- [ ] **Step 3: Run the whole package**

```bash
cd backend && go test ./internal/ipm/
```

Expected: `ok  github.com/gloeckner-daniel/home-ergo/internal/ipm`.

- [ ] **Step 4: Commit**

```bash
git add backend/internal/ipm/producer.go backend/internal/ipm/producer_fixture.go backend/internal/ipm/producer_fixture_test.go
git commit -m "feat(ipm): add Producer interface and CSV-fixture replay"
```

---

## Task 11: SerialProducer

**Files:**
- Create: `backend/internal/ipm/producer_serial.go`

The serial producer wraps `go.bug.st/serial`. It cannot be unit-tested without real hardware or a virtual serial pair — we rely on `FixtureProducer` for automated coverage and hand-test this path against the actual ergo. Per ARCH-0001, if the port is empty the producer uses the library's enumeration helper to find the FTDI FT232R by VID:PID `0403:6001`.

- [ ] **Step 1: Add the dependency**

From `backend/`:

```bash
go get go.bug.st/serial@latest && go mod tidy
```

Expected: `go.mod` gains a `require go.bug.st/serial vX.Y.Z` line; `go.sum` is populated.

- [ ] **Step 2: Write the serial producer**

Create `backend/internal/ipm/producer_serial.go`:

```go
package ipm

import (
	"context"
	"fmt"
	"log/slog"
	"strings"

	"go.bug.st/serial"
	"go.bug.st/serial/enumerator"
)

const (
	ftdiVID = "0403"
	ftdiPID = "6001"
)

// SerialProducer opens the IPM serial port and streams decoded Frames
// on out. On read error, Run returns — main is responsible for the
// reconnect backoff loop.
type SerialProducer struct {
	Port string // empty = auto-detect FTDI FT232R (0403:6001)
	Baud int    // e.g. 9600
}

// Run opens the port, spawns Parse on the resulting reader, and
// forwards Frames to out.
func (p *SerialProducer) Run(ctx context.Context, out chan<- Frame) error {
	port := p.Port
	if port == "" {
		found, err := autodetectFTDI()
		if err != nil {
			close(out)
			return err
		}
		port = found
	}

	slog.Info("ipm.serial.open", "port", port, "baud", p.Baud)
	sp, err := serial.Open(port, &serial.Mode{BaudRate: p.Baud})
	if err != nil {
		close(out)
		return fmt.Errorf("serial open %s: %w", port, err)
	}
	defer sp.Close()

	// Make reads unblock when ctx is cancelled.
	go func() {
		<-ctx.Done()
		_ = sp.Close()
	}()

	// Parse takes ownership of closing out.
	return Parse(ctx, sp, out)
}

func autodetectFTDI() (string, error) {
	ports, err := enumerator.GetDetailedPortsList()
	if err != nil {
		return "", fmt.Errorf("enumerate serial: %w", err)
	}
	for _, p := range ports {
		if strings.EqualFold(p.VID, ftdiVID) && strings.EqualFold(p.PID, ftdiPID) {
			return p.Name, nil
		}
	}
	return "", fmt.Errorf("no FTDI FT232R (VID:PID %s:%s) attached", ftdiVID, ftdiPID)
}
```

- [ ] **Step 3: Verify it compiles**

```bash
cd backend && go build ./internal/ipm/
```

Expected: exits 0. `go.sum` may have grown — that's fine, `go mod tidy` in step 1 handled it.

- [ ] **Step 4: Commit**

```bash
git add backend/go.mod backend/go.sum backend/internal/ipm/producer_serial.go
git commit -m "feat(ipm): add SerialProducer with FTDI auto-detect"
```

---

## Task 12: HTTP middleware and router

**Files:**
- Create: `backend/internal/api/middleware.go`
- Create: `backend/internal/api/router.go`

- [ ] **Step 1: Write the middleware**

Create `backend/internal/api/middleware.go`:

```go
// Package api wires the HTTP surface. See specs/arch/0001-backend-pipeline.md.
package api

import (
	"log/slog"
	"net/http"
	"runtime/debug"
	"time"
)

// Middleware is the standard "wrap a handler" function shape.
type Middleware func(http.Handler) http.Handler

// Chain composes middlewares left-to-right: Chain(h, a, b) wraps as a(b(h)).
func Chain(h http.Handler, mws ...Middleware) http.Handler {
	for i := len(mws) - 1; i >= 0; i-- {
		h = mws[i](h)
	}
	return h
}

// Recover turns a handler panic into a 500 and a structured log entry.
func Recover() Middleware {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			defer func() {
				if rec := recover(); rec != nil {
					slog.Error("http.panic",
						"err", rec,
						"path", r.URL.Path,
						"stack", string(debug.Stack()),
					)
					http.Error(w, "internal server error", http.StatusInternalServerError)
				}
			}()
			next.ServeHTTP(w, r)
		})
	}
}

// Logging records one structured log line per completed request.
func Logging() Middleware {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			start := time.Now()
			lrw := &loggingResponseWriter{ResponseWriter: w, status: http.StatusOK}
			next.ServeHTTP(lrw, r)
			slog.Info("http.request",
				"method", r.Method,
				"path", r.URL.Path,
				"status", lrw.status,
				"duration_ms", time.Since(start).Milliseconds(),
			)
		})
	}
}

type loggingResponseWriter struct {
	http.ResponseWriter
	status int
}

func (w *loggingResponseWriter) WriteHeader(code int) {
	w.status = code
	w.ResponseWriter.WriteHeader(code)
}
```

- [ ] **Step 2: Write the router**

Create `backend/internal/api/router.go`:

```go
package api

import "net/http"

// NewRouter builds the HTTP handler for the backend. In M1 it serves
// only /api/health; M2 will add /api/v1/stream and /debug/ingest.
func NewRouter() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/health", healthHandler)
	return Chain(mux, Recover(), Logging())
}
```

- [ ] **Step 3: Verify it compiles**

```bash
cd backend && go build ./internal/api/
```

Expected: fails — `healthHandler` is not yet defined. That's addressed in Task 13.

---

## Task 13: /api/health endpoint

**Files:**
- Create: `backend/internal/api/health.go`
- Create: `backend/internal/api/health_test.go`

- [ ] **Step 1: Write the failing test**

Create `backend/internal/api/health_test.go`:

```go
package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestHealth_OK(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/api/health", nil)
	rec := httptest.NewRecorder()

	NewRouter().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	if ct := rec.Header().Get("Content-Type"); ct != "application/json" {
		t.Errorf("Content-Type = %q, want application/json", ct)
	}

	var body struct {
		Status string `json:"status"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode body: %v", err)
	}
	if body.Status != "ok" {
		t.Errorf("status field = %q, want %q", body.Status, "ok")
	}
}

func TestHealth_MethodNotAllowed(t *testing.T) {
	// Go 1.22 method-specific routing: POST must not match "GET /api/health".
	req := httptest.NewRequest(http.MethodPost, "/api/health", nil)
	rec := httptest.NewRecorder()

	NewRouter().ServeHTTP(rec, req)

	if rec.Code != http.StatusMethodNotAllowed {
		t.Errorf("status = %d, want 405", rec.Code)
	}
}
```

- [ ] **Step 2: Run the test — it must fail (build error)**

```bash
cd backend && go test ./internal/api/
```

Expected: build fails because `healthHandler` is undefined.

- [ ] **Step 3: Write the handler**

Create `backend/internal/api/health.go`:

```go
package api

import (
	"encoding/json"
	"net/http"
)

func healthHandler(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
}
```

- [ ] **Step 4: Run the tests — they must pass**

```bash
cd backend && go test ./internal/api/
```

Expected: `ok  github.com/gloeckner-daniel/home-ergo/internal/api`.

- [ ] **Step 5: Commit**

```bash
git add backend/internal/api/
git commit -m "feat(api): add /api/health with method-aware routing"
```

---

## Task 14: Wire `cmd/homeergo/main.go`

**Files:**
- Create: `backend/cmd/homeergo/main.go`

The M1 binary:
1. Loads `Config` via `os.Getenv`.
2. Selects a `Producer` (fixture if `HOMEERGO_FIXTURE` is set, else serial).
3. Starts `http.Server` on `Config.Addr` serving `api.NewRouter()`.
4. Runs the producer in a goroutine. For each emitted frame, prints one JSON line to stdout.
5. On SIGINT/SIGTERM: cancels the context, calls `server.Shutdown` with a 30 s deadline, waits for the producer goroutine, exits 0.

- [ ] **Step 1: Write `main.go`**

Create `backend/cmd/homeergo/main.go`:

```go
package main

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"sync"
	"syscall"
	"time"

	"github.com/gloeckner-daniel/home-ergo/internal/api"
	"github.com/gloeckner-daniel/home-ergo/internal/config"
	"github.com/gloeckner-daniel/home-ergo/internal/ipm"
)

const httpShutdownTimeout = 30 * time.Second

func main() {
	if err := run(); err != nil {
		slog.Error("homeergo.exit", "err", err)
		os.Exit(1)
	}
}

func run() error {
	cfg, err := config.Load(os.Getenv)
	if err != nil {
		return err
	}
	configureLogger(cfg.LogLevel)

	slog.Info("homeergo.start",
		"addr", cfg.Addr,
		"fixture", cfg.Fixture,
		"fixture_rate", cfg.FixtureRate,
		"serial_port", cfg.SerialPort,
	)

	ctx, cancel := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer cancel()

	producer := pickProducer(cfg)

	var wg sync.WaitGroup

	// Producer goroutine: read frames, print to stdout.
	frames := make(chan ipm.Frame, 64)
	wg.Add(1)
	var producerErr error
	go func() {
		defer wg.Done()
		producerErr = producer.Run(ctx, frames)
	}()

	// Stdout printer goroutine.
	wg.Add(1)
	go func() {
		defer wg.Done()
		enc := json.NewEncoder(os.Stdout)
		for f := range frames {
			if err := enc.Encode(makeFrameLine(f)); err != nil {
				slog.Error("stdout.write", "err", err)
				return
			}
		}
	}()

	// HTTP server.
	srv := &http.Server{
		Addr:              cfg.Addr,
		Handler:           api.NewRouter(),
		ReadHeaderTimeout: 10 * time.Second,
	}
	serverErrCh := make(chan error, 1)
	go func() {
		err := srv.ListenAndServe()
		if err != nil && !errors.Is(err, http.ErrServerClosed) {
			serverErrCh <- err
			return
		}
		serverErrCh <- nil
	}()

	// Wait for shutdown signal or HTTP error.
	select {
	case <-ctx.Done():
		slog.Info("homeergo.shutdown", "reason", "signal")
	case err := <-serverErrCh:
		if err != nil {
			cancel()
			wg.Wait()
			return err
		}
	}

	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), httpShutdownTimeout)
	defer shutdownCancel()
	if err := srv.Shutdown(shutdownCtx); err != nil {
		slog.Error("http.shutdown", "err", err)
	}

	wg.Wait()

	if producerErr != nil && !errors.Is(producerErr, context.Canceled) {
		return producerErr
	}
	return nil
}

func pickProducer(cfg *config.Config) ipm.Producer {
	if cfg.Fixture != "" {
		pacing := ipm.PacingRealtime
		if cfg.FixtureRate == "fast" {
			pacing = ipm.PacingFast
		}
		return &ipm.FixtureProducer{Path: cfg.Fixture, Pacing: pacing}
	}
	return &ipm.SerialProducer{Port: cfg.SerialPort, Baud: cfg.SerialBaud}
}

// frameLine is a compact stdout representation — intentionally separate
// from event.Event so the stdout format can evolve independently.
type frameLine struct {
	TimeSec    float64 `json:"time_sec"`
	DistanceM  int     `json:"distance_m"`
	SPM        int     `json:"spm"`
	PowerW     int     `json:"power_w"`
	CalPerHr   int     `json:"cal_per_hr"`
	Level      int     `json:"level"`
	RawPayload string  `json:"raw_payload"`
}

func makeFrameLine(f ipm.Frame) frameLine {
	return frameLine{
		TimeSec: f.TimeSec, DistanceM: f.DistanceM, SPM: f.SPM,
		PowerW: f.PowerW, CalPerHr: f.CalPerHr, Level: f.Level,
		RawPayload: f.RawPayload,
	}
}

func configureLogger(level string) {
	var l slog.Level
	switch level {
	case "debug":
		l = slog.LevelDebug
	case "warn":
		l = slog.LevelWarn
	case "error":
		l = slog.LevelError
	default:
		l = slog.LevelInfo
	}
	h := slog.NewJSONHandler(os.Stderr, &slog.HandlerOptions{Level: l})
	slog.SetDefault(slog.New(h))
}
```

- [ ] **Step 2: Verify it builds**

```bash
cd backend && go build ./...
```

Expected: exits 0.

- [ ] **Step 3: Hand-test with a fixture**

```bash
cd backend && HOMEERGO_FIXTURE=../specs/int/fixtures/ipm/session-short.csv HOMEERGO_FIXTURE_RATE=fast go run ./cmd/homeergo
```

Expected on stdout: a JSON object per stroke, e.g.:

```
{"time_sec":24,"distance_m":25,"spm":3,"power_w":41,"cal_per_hr":430,"level":3,"raw_payload":"000240002511045003041043803"}
{"time_sec":27,"distance_m":33,"spm":19,"power_w":57,"cal_per_hr":490,"level":3,"raw_payload":"000270003310320019057049303"}
…
```

On stderr: `homeergo.start` and per-request logs if you curl the health endpoint.

The process should exit cleanly when the fixture runs out (`PacingFast` means "as fast as possible" — expect the whole session-short fixture in well under a second).

- [ ] **Step 4: Hand-test `/api/health` with a longer fixture so the process stays alive**

In one terminal:

```bash
cd backend && HOMEERGO_FIXTURE=../specs/int/fixtures/ipm/session-m3-long.csv go run ./cmd/homeergo
```

In another:

```bash
curl -sS http://localhost:8080/api/health
```

Expected: `{"status":"ok"}`. In the server terminal you should see an `http.request` log line with `status=200`.

Send `Ctrl-C`: the process should log `homeergo.shutdown reason=signal` and exit with code 0 within a second or two.

- [ ] **Step 5: Run all tests, vet, and build one more time**

```bash
cd backend && go test ./... && go vet ./... && go build ./...
```

Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add backend/cmd/homeergo/main.go
git commit -m "feat(cmd/homeergo): wire config, producer, and /api/health server"
```

---

## Self-Review Notes

Checks performed before publishing this plan:

- **Spec coverage:** Every M1 line item in `ROADMAP.md` is covered — repo layout (Task 1), Go port of the IPM parser with table-driven tests against the CSV fixtures (Tasks 5–8), backend reads serial and prints parsed strokes to stdout (Tasks 9–11, 14), minimal `/api/health` (Tasks 12–13). The Vite+React PWA scaffold from M1 is explicitly out of scope per the plan scope decomposition — it belongs in its own frontend-scaffold plan.
- **Placeholder scan:** No `TBD`/`TODO`/"similar to" references in the task bodies. Every code block is complete. Module path `github.com/gloeckner-daniel/home-ergo` appears in every import line.
- **Type consistency:** `ipm.Frame` fields used consistently across Tasks 5, 7, 8, 10, 11, 14. `config.Config` fields used consistently across Tasks 2, 3, 14. `Producer` interface matches between Tasks 9, 10, 11, 14.
- **One gap found and fixed inline:** an earlier draft of Task 14 used an illegal `frameLine(f)` cast and carried an unused `marshal()` method as a linter hedge; corrected to call `makeFrameLine(f)` directly in the stdout goroutine.
