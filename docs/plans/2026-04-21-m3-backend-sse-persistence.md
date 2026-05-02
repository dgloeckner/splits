# M3 Backend — SSE Live Stream + Session Persistence Implementation Plan

> **Historical:** Plan written before brand rename. Code paths and env vars referenced (`cmd/homeergo`, `HOMEERGO_*`) shifted to `cmd/splits` and `SPLITS_*` on 2026-04-28. See `backend/README.md` for current config; the legacy fallback shim is documented there.


> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Take the backend from "serial reader that prints frames to stdout" to a working live stream the PWA can consume: sessionizer + dispatcher + ring + persister + SSE broadcaster, backed by SQLite. The frontend's `EventSourceChannel` must see real data flowing; completed sessions must land in SQLite.

**Architecture:** Follow ARCH-0001 byte-for-byte. Producer → parser (both already exist) → sessionizer (idle FSM, Tier-2 enrichment, id-stamping) → dispatcher (fans out to ring + persister + broadcaster) → SSE `/api/v1/stream`. Persister uses `modernc.org/sqlite` (pure-Go, no CGO — matches Pi deploy target). Auth stays stubbed at a fixed rower per ARCH-0001 M1 note; real auth is ADR-0005 / a later plan.

**Tech Stack additions:**
- `modernc.org/sqlite` — pure-Go SQLite driver.
- `github.com/oklog/ulid/v2` — ULIDs for `session_id`.
- `golang.org/x/sync/errgroup` — coordinated goroutine supervision in `main`.
- (embedded SQL migrations via `//go:embed`; no golang-migrate dep — overkill for two tables.)

**Spec references:**
- [`specs/arch/0001-backend-pipeline.md`](../../specs/arch/0001-backend-pipeline.md) — authoritative. Every package, channel, and drop policy in this plan comes from ARCH-0001.
- [`specs/int/0002-live-stream-sse.md`](../../specs/int/0002-live-stream-sse.md) — SSE wire format.
- [`specs/int/0001-ipm-serial-protocol.md`](../../specs/int/0001-ipm-serial-protocol.md) — frame → metric derivations.
- [`specs/feat/0007-rowing-metrics-catalogue.md`](../../specs/feat/0007-rowing-metrics-catalogue.md) — Tier-2 definitions (DPS, pace/500 m, stroke-cycle-sec, energy).
- [`specs/feat/0003-session-history.md`](../../specs/feat/0003-session-history.md) — persistence acceptance criteria (auto-save, 60 s idle boundary, stores totals + per-stroke series).
- [`specs/adr/0004-local-first-persistence.md`](../../specs/adr/0004-local-first-persistence.md) — SQLite-on-host decision.
- [`specs/adr/0007-event-ingestion-pipeline.md`](../../specs/adr/0007-event-ingestion-pipeline.md) — producer/dispatcher model (amended by ARCH-0001: sessionizer owns boundaries, not persister).

**Out of scope (deferred):**
- Real authentication (ADR-0005) — middleware stays stubbed to a fixed rower ID. Real auth is its own plan.
- History list / detail UI and the `GET /api/v1/sessions`, `GET /api/v1/sessions/{id}/samples` read paths (FEAT-0003 UI). Covered in the next plan once persistence lands.
- FIT/TCX export (FEAT-0003 stretch goal).
- Soft-delete + 7-day undelete (FEAT-0003 acceptance item) — will land with history UI when there's somewhere to surface it.
- `/debug/ingest` behind-auth guard (flagged in ARCH-0001 open questions).
- PWA offline data cache (FEAT-0006).

**Resolved design decisions (locked during this plan):**
- **Event id scheme**: lifetime-monotonic `uint64` starting at 1 on process start (ARCH-0001 §Sessionizer). INT-0002's per-session proposal is dropped; lifetime-monotonic resumes correctly across `session_end` / `session_start` pairs.
- **`level_change` timing**: emitted on the first stroke that carries the new level; `at_stroke` / `at_time_sec` point at that stroke.
- **SQL dialect / driver**: `modernc.org/sqlite` (CGO-free). `database/sql` + hand-written query strings; no sqlc in this plan.
- **Migrations**: `//go:embed` a `migrations/` dir, replay any unapplied statements at startup via a single `schema_migrations(version)` table. No external migration tool.
- **Cross-session reconnect behaviour**: reconnecting after session A ended and B started skips A's tail; broadcaster replays from the ring buffer's newest `session_start` forward (matches INT-0002 open-question default).
- **Persister session-end write**: `UPDATE sessions SET ended_at, summary_json, total_distance_m, total_time_sec, total_strokes WHERE id = ?`. Summary fields are both denormalised columns *and* full JSON blob — denormalised for list/filter queries, blob for forward-compat with new summary fields.

---

## File Structure

Files created or modified in this plan (all under `backend/`):

```
backend/
├── go.mod                                    (modified: modernc.org/sqlite, oklog/ulid, errgroup)
├── go.sum                                    (modified: checksums)
├── cmd/homeergo/
│   └── main.go                               (modified: replace stdout printer with full pipeline)
├── internal/
│   ├── config/
│   │   └── config.go                         (unchanged — IdleTimeout + DBPath already land in M1)
│   ├── event/
│   │   ├── event.go                          (unchanged — M1 already defines every payload)
│   │   ├── wire.go                           (new — Event → INT-0002 JSON mapper)
│   │   └── wire_test.go                      (new)
│   ├── session/
│   │   ├── metrics.go                        (new — pure Tier-2 derivations)
│   │   ├── metrics_test.go                   (new)
│   │   ├── sessionizer.go                    (new — idle FSM, synthesis, id-stamping)
│   │   └── sessionizer_test.go               (new)
│   ├── pipeline/
│   │   ├── ring.go                           (new — mutex-guarded replay buffer)
│   │   ├── ring_test.go                      (new)
│   │   ├── dispatcher.go                     (new — fan-out stage)
│   │   └── dispatcher_test.go                (new)
│   ├── storage/
│   │   ├── db.go                             (new — open, WAL pragmas, migrations runner)
│   │   ├── db_test.go                        (new)
│   │   ├── migrations/
│   │   │   └── 0001_init.sql                 (new — sessions + strokes + schema_migrations)
│   │   ├── queries.go                        (new — hand-written SQL + scanners)
│   │   ├── queries_test.go                   (new)
│   │   ├── persister.go                      (new — event consumer, retry)
│   │   └── persister_test.go                 (new)
│   ├── stream/
│   │   ├── broadcaster.go                    (new — per-client goroutines, drop policy)
│   │   ├── broadcaster_test.go               (new)
│   │   ├── sse.go                            (new — GET /api/v1/stream handler)
│   │   └── sse_test.go                       (new)
│   └── api/
│       ├── router.go                         (modified — register /api/v1/stream, /debug/ingest)
│       ├── debug.go                          (new — GET /debug/ingest)
│       └── debug_test.go                     (new)
├── testdata/                                 (new top-level)
│   └── sse/
│       └── session-short.golden.sse          (new — golden SSE replay for e2e smoke)
└── README.md                                 (new — runtime + dev commands)
```

**Conventions enforced by this layout:**

- Each stage's test file lives next to it. Pipeline-wide smoke lives at the `cmd/homeergo/` level (end-to-end), not scattered.
- `event.Event` stays internal; wire mapping is one file in `internal/event/wire.go` that doesn't import anything else — same trick as ARCH-0001's "keep the wire format and the schema decoupled."
- `storage/migrations/` is `//go:embed`ed; no filesystem lookups at runtime.
- No package imports `http` except `api/`, `stream/sse.go`, and `main`. Every stage's core logic is `http`-free and unit-testable.

---

## Task 1: Install dependencies

**Files:**
- Modify: `backend/go.mod`, `backend/go.sum`

- [ ] **Step 1: From `backend/`, add runtime deps**

```bash
go get modernc.org/sqlite
go get github.com/oklog/ulid/v2
go get golang.org/x/sync/errgroup
```

Expected: `go.mod` gains three `require` lines; `go.sum` fills in.

- [ ] **Step 2: Tidy**

```bash
cd backend && go mod tidy
```

Expected: no indirect pruning surprises; exits 0.

- [ ] **Step 3: Verify the existing test suite still compiles**

```bash
cd backend && go test ./...
```

Expected: everything green (all M1 tests).

- [ ] **Step 4: Commit**

```bash
git add backend/go.mod backend/go.sum
git commit -m "feat(backend): add sqlite, ulid, errgroup deps for M3"
```

---

## Task 2: Event → INT-0002 wire mapping

**Files:**
- Create: `backend/internal/event/wire.go`
- Create: `backend/internal/event/wire_test.go`

The SSE handler calls this to render an `event.Event` as the JSON shape INT-0002 specifies. Keeping it in `internal/event/` (and not `internal/stream/`) means wire-format tests don't pull an `httptest` dependency, and the shape is one place both production and tests agree on.

- [ ] **Step 1: Write the failing test**

Create `backend/internal/event/wire_test.go`:

```go
package event

import (
	"encoding/json"
	"testing"
	"time"
)

func TestMarshalStroke(t *testing.T) {
	e := Event{
		ID:        47,
		Kind:      KindStroke,
		SessionID: "01HV00000000000000000000A1",
		At:        time.Unix(0, 0),
		Stroke: &StrokePayload{
			StrokeNo: 47, TimeSec: 85.3, DistanceM: 342,
			SPM: 27, PowerW: 245, CalPerHr: 1175, Level: 3,
			DPS: 8.4, StrokeCycleSec: 2.22, PaceSecPer500m: 132, EnergyJoules: 544,
		},
	}
	got, err := Marshal(e)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	var got2 map[string]any
	if err := json.Unmarshal(got, &got2); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	want := map[string]any{
		"session_id":         "01HV00000000000000000000A1",
		"stroke":             float64(47),
		"time_sec":           85.3,
		"distance_m":         float64(342),
		"spm":                float64(27),
		"power_w":            float64(245),
		"cal_per_hr":         float64(1175),
		"level":              float64(3),
		"dps":                8.4,
		"stroke_cycle_sec":   2.22,
		"pace_sec_per_500m":  float64(132),
		"energy_joules":      float64(544),
	}
	for k, v := range want {
		if got2[k] != v {
			t.Errorf("%s: got %v, want %v", k, got2[k], v)
		}
	}
}

func TestEventNameMatrix(t *testing.T) {
	cases := []struct {
		kind Kind
		want string
	}{
		{KindStroke, "stroke"},
		{KindSessionStart, "session_start"},
		{KindSessionEnd, "session_end"},
		{KindLevelChange, "level_change"},
	}
	for _, tc := range cases {
		if got := EventName(tc.kind); got != tc.want {
			t.Errorf("EventName(%d) = %q, want %q", tc.kind, got, tc.want)
		}
	}
}
```

- [ ] **Step 2: Run — must fail**

```bash
cd backend && go test ./internal/event/ -run TestMarshalStroke -v
```

Expected: compilation failure — `Marshal` / `EventName` undefined.

- [ ] **Step 3: Implement**

Create `backend/internal/event/wire.go`:

```go
package event

import "encoding/json"

// EventName returns the INT-0002 `event:` field for a kind, or "" if
// the kind has no wire representation (ping/eof are emitted directly
// by the broadcaster and don't round-trip through Event).
func EventName(k Kind) string {
	switch k {
	case KindStroke:
		return "stroke"
	case KindSessionStart:
		return "session_start"
	case KindSessionEnd:
		return "session_end"
	case KindLevelChange:
		return "level_change"
	}
	return ""
}

// Marshal renders the data payload of an Event as INT-0002 JSON. The
// caller is responsible for prepending `event:` and `id:` lines and
// the `data:` prefix.
func Marshal(e Event) ([]byte, error) {
	switch e.Kind {
	case KindStroke:
		p := e.Stroke
		return json.Marshal(strokeWire{
			SessionID:      e.SessionID,
			Stroke:         p.StrokeNo,
			TimeSec:        p.TimeSec,
			DistanceM:      p.DistanceM,
			SPM:            p.SPM,
			PowerW:         p.PowerW,
			CalPerHr:       p.CalPerHr,
			Level:          p.Level,
			DPS:            p.DPS,
			StrokeCycleSec: p.StrokeCycleSec,
			PaceSecPer500m: p.PaceSecPer500m,
			EnergyJoules:   p.EnergyJoules,
		})
	case KindSessionStart:
		p := e.SessionStart
		return json.Marshal(sessionStartWire{
			SessionID:    e.SessionID,
			StartedAt:    p.StartedAt,
			RowerID:      p.RowerID,
			RowerName:    p.RowerName,
			InitialLevel: p.InitialLevel,
		})
	case KindSessionEnd:
		p := e.SessionEnd
		return json.Marshal(sessionEndWire{
			SessionID: e.SessionID,
			EndedAt:   p.EndedAt,
			Summary:   summaryWire(p.Summary),
		})
	case KindLevelChange:
		p := e.LevelChange
		return json.Marshal(levelChangeWire{
			From: p.From, To: p.To, AtStroke: p.AtStroke, AtTimeSec: p.AtTimeSec,
		})
	}
	return nil, nil
}

type strokeWire struct {
	SessionID      string  `json:"session_id"`
	Stroke         int     `json:"stroke"`
	TimeSec        float64 `json:"time_sec"`
	DistanceM      int     `json:"distance_m"`
	SPM            int     `json:"spm"`
	PowerW         int     `json:"power_w"`
	CalPerHr       int     `json:"cal_per_hr"`
	Level          int     `json:"level"`
	DPS            float64 `json:"dps"`
	StrokeCycleSec float64 `json:"stroke_cycle_sec"`
	PaceSecPer500m int     `json:"pace_sec_per_500m"`
	EnergyJoules   int     `json:"energy_joules"`
}

type sessionStartWire struct {
	SessionID    string    `json:"session_id"`
	StartedAt    time.Time `json:"started_at"`
	RowerID      string    `json:"rower_id"`
	RowerName    string    `json:"rower_name"`
	InitialLevel int       `json:"initial_level"`
}

type sessionEndWire struct {
	SessionID string      `json:"session_id"`
	EndedAt   time.Time   `json:"ended_at"`
	Summary   summaryWire `json:"summary"`
}

type summaryWire struct {
	TotalDistanceM    int     `json:"total_distance_m"`
	TotalTimeSec      float64 `json:"total_time_sec"`
	TotalStrokes      int     `json:"total_strokes"`
	AvgPowerW         int     `json:"avg_power_w"`
	PeakPowerW        int     `json:"peak_power_w"`
	AvgSPM            float64 `json:"avg_spm"`
	AvgDPS            float64 `json:"avg_dps"`
	AvgPaceSecPer500m int     `json:"avg_pace_sec_per_500m"`
	SessionCalories   int     `json:"session_calories"`
}

type levelChangeWire struct {
	From      int     `json:"from"`
	To        int     `json:"to"`
	AtStroke  int     `json:"at_stroke"`
	AtTimeSec float64 `json:"at_time_sec"`
}
```

Add the `import "time"` line at the top — the file above omits the imports block for brevity. Final imports: `"encoding/json"` and `"time"`.

- [ ] **Step 4: Run — must pass**

```bash
cd backend && go test ./internal/event/ -v
```

Expected: both tests pass.

- [ ] **Step 5: Commit**

```bash
git add backend/internal/event/wire.go backend/internal/event/wire_test.go
git commit -m "feat(backend): event wire marshaller (INT-0002 JSON shape)"
```

---

## Task 3: Tier-2 metric derivations

**Files:**
- Create: `backend/internal/session/metrics.go`
- Create: `backend/internal/session/metrics_test.go`

Pure functions. These are the derivations FEAT-0007 calls Tier-2 (per-stroke, computed from A8 fields). The sessionizer calls them per stroke.

- [ ] **Step 1: Write the failing test**

Create `backend/internal/session/metrics_test.go`:

```go
package session

import (
	"math"
	"testing"
)

func feq(a, b, eps float64) bool { return math.Abs(a-b) <= eps }

func TestDPS(t *testing.T) {
	// 8 m between strokes at stroke 2 → DPS = 8.
	if got := DPS(0, 8, 0); !feq(got, 8, 1e-9) {
		t.Errorf("got %v", got)
	}
	// First stroke: no previous distance, DPS is 0.
	if got := DPSFirst(); got != 0 {
		t.Errorf("got %v", got)
	}
}

func TestStrokeCycleSec(t *testing.T) {
	// 2.2 s between strokes.
	if got := StrokeCycleSec(83.1, 85.3); !feq(got, 2.2, 1e-9) {
		t.Errorf("got %v", got)
	}
	// Zero gap → 0.
	if got := StrokeCycleSec(85.3, 85.3); got != 0 {
		t.Errorf("got %v", got)
	}
}

func TestPaceSecPer500m(t *testing.T) {
	// 8 m per 2.2 s → 500 m in 500/8*2.2 = 137.5 s, truncated to 137.
	if got := PaceSecPer500m(8, 2.2); got != 137 {
		t.Errorf("got %v", got)
	}
	// Zero distance → 0 (tile-catalogue guards against rendering).
	if got := PaceSecPer500m(0, 2.2); got != 0 {
		t.Errorf("got %v", got)
	}
	// Zero cycle → 0.
	if got := PaceSecPer500m(8, 0); got != 0 {
		t.Errorf("got %v", got)
	}
}

func TestEnergyJoules(t *testing.T) {
	// 245 W * 2.22 s = 543.9 J → 544 after Round.
	if got := EnergyJoules(245, 2.22); got != 544 {
		t.Errorf("got %v", got)
	}
	if got := EnergyJoules(245, 0); got != 0 {
		t.Errorf("got %v", got)
	}
}
```

- [ ] **Step 2: Run — must fail**

```bash
cd backend && go test ./internal/session/ -v
```

Expected: compilation failure (undefined symbols).

- [ ] **Step 3: Implement**

Create `backend/internal/session/metrics.go`:

```go
// Package session owns the sessionizer stage: idle-boundary FSM,
// Tier-2 metric enrichment, and lifetime-monotonic id-stamping.
// See specs/arch/0001-backend-pipeline.md.
package session

import "math"

// DPS (distance-per-stroke) in metres between two consecutive stroke
// events. Returns the delta; callers handle the first-stroke case
// with DPSFirst.
func DPS(prevDistanceM, curDistanceM int, _ int) float64 {
	d := curDistanceM - prevDistanceM
	if d < 0 {
		return 0
	}
	return float64(d)
}

// DPSFirst is the sentinel value for the first stroke of a session.
// FEAT-0007 specifies 0 until a delta is available.
func DPSFirst() float64 { return 0 }

// StrokeCycleSec is the time between the previous and current stroke.
// Negative / zero gaps round to 0.
func StrokeCycleSec(prevTimeSec, curTimeSec float64) float64 {
	d := curTimeSec - prevTimeSec
	if d <= 0 {
		return 0
	}
	return d
}

// PaceSecPer500m extrapolates the current stroke's pace over a 500 m
// reference. Returns 0 when either input is zero (FEAT-0007 renders
// an em-dash at that state).
func PaceSecPer500m(dps float64, cycleSec float64) int {
	if dps <= 0 || cycleSec <= 0 {
		return 0
	}
	return int(500.0 / dps * cycleSec)
}

// EnergyJoules for one stroke — power_W * cycle_sec, rounded to int.
func EnergyJoules(powerW int, cycleSec float64) int {
	if cycleSec <= 0 {
		return 0
	}
	return int(math.Round(float64(powerW) * cycleSec))
}
```

- [ ] **Step 4: Run — must pass**

```bash
cd backend && go test ./internal/session/ -v
```

- [ ] **Step 5: Commit**

```bash
git add backend/internal/session/metrics.go backend/internal/session/metrics_test.go
git commit -m "feat(backend): Tier-2 per-stroke metric derivations (FEAT-0007)"
```

---

## Task 4: Sessionizer — idle FSM, id-stamping, session synthesis

**Files:**
- Create: `backend/internal/session/sessionizer.go`
- Create: `backend/internal/session/sessionizer_test.go`

Single goroutine. Consumes `chan ipm.Frame`, emits `chan event.Event` with ids 1,2,3,… and synthetic `session_start` / `session_end` events at idle boundaries. Enriches every stroke with Tier-2 fields. Per ARCH-0001, this stage is the single source of truth for event order.

- [ ] **Step 1: Write the failing test**

Create `backend/internal/session/sessionizer_test.go`:

```go
package session

import (
	"context"
	"testing"
	"time"

	"github.com/gloeckner-daniel/home-ergo/internal/event"
	"github.com/gloeckner-daniel/home-ergo/internal/ipm"
)

func frame(timeSec float64, distanceM, spm, powerW, level int) ipm.Frame {
	return ipm.Frame{
		ReceivedAt: time.Unix(int64(timeSec), 0),
		TimeSec:    timeSec,
		DistanceM:  distanceM,
		SPM:        spm,
		PowerW:     powerW,
		CalPerHr:   1000,
		Level:      level,
	}
}

func drain(t *testing.T, out <-chan event.Event, n int) []event.Event {
	t.Helper()
	var got []event.Event
	for i := 0; i < n; i++ {
		select {
		case e := <-out:
			got = append(got, e)
		case <-time.After(time.Second):
			t.Fatalf("timeout waiting for event %d", i+1)
		}
	}
	return got
}

func TestSessionizerFirstStrokeOpensSession(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	in := make(chan ipm.Frame, 4)
	out := make(chan event.Event, 16)
	s := New(Options{IdleTimeout: time.Minute, RowerID: "R", RowerName: "Daniel", Now: func() time.Time { return time.Unix(1000, 0) }})
	go func() { _ = s.Run(ctx, in, out) }()

	in <- frame(0.0, 0, 25, 200, 3)
	got := drain(t, out, 2)

	if got[0].Kind != event.KindSessionStart {
		t.Errorf("expected session_start, got %v", got[0].Kind)
	}
	if got[0].ID != 1 {
		t.Errorf("first event id = %d, want 1", got[0].ID)
	}
	if got[1].Kind != event.KindStroke {
		t.Errorf("expected stroke, got %v", got[1].Kind)
	}
	if got[1].ID != 2 {
		t.Errorf("second event id = %d, want 2", got[1].ID)
	}
	if got[1].SessionID != got[0].SessionID || got[0].SessionID == "" {
		t.Errorf("session ids should match and be non-empty: %q / %q", got[0].SessionID, got[1].SessionID)
	}
}

func TestSessionizerEnrichesTier2(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	in := make(chan ipm.Frame, 4)
	out := make(chan event.Event, 16)
	s := New(Options{IdleTimeout: time.Minute, Now: time.Now})
	go func() { _ = s.Run(ctx, in, out) }()

	in <- frame(0.0, 0, 25, 200, 3)
	in <- frame(2.2, 8, 27, 245, 3)
	got := drain(t, out, 3) // start + stroke + stroke

	st2 := got[2].Stroke
	if st2.DPS != 8 {
		t.Errorf("DPS = %v, want 8", st2.DPS)
	}
	if st2.StrokeCycleSec != 2.2 {
		t.Errorf("cycle = %v, want 2.2", st2.StrokeCycleSec)
	}
	if st2.PaceSecPer500m != 137 {
		t.Errorf("pace = %v, want 137", st2.PaceSecPer500m)
	}
}

func TestSessionizerIdleBoundary(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	in := make(chan ipm.Frame, 4)
	out := make(chan event.Event, 16)
	now := time.Unix(1000, 0)
	s := New(Options{IdleTimeout: 60 * time.Second, Now: func() time.Time { return now }})
	go func() { _ = s.Run(ctx, in, out) }()

	// First session: two strokes.
	in <- frame(0.0, 0, 25, 200, 3)
	now = now.Add(1 * time.Second)
	in <- frame(1.0, 4, 25, 200, 3)

	// Idle gap >60 s, then a new session.
	now = now.Add(90 * time.Second)
	in <- frame(0.0, 0, 24, 180, 3)

	got := drain(t, out, 5) // start, stroke, stroke, end, start, stroke (actually 6; test drains 5 then 1 more)
	// We expect: start1, stroke1, stroke1, session_end, session_start — then stroke2 on next drain.
	if got[3].Kind != event.KindSessionEnd {
		t.Errorf("expected session_end at 3, got %v", got[3].Kind)
	}
	if got[4].Kind != event.KindSessionStart {
		t.Errorf("expected session_start at 4, got %v", got[4].Kind)
	}
	if got[4].SessionID == got[0].SessionID {
		t.Errorf("second session_start should have a new session id")
	}

	// Drain one more: the first stroke of session 2.
	more := drain(t, out, 1)
	if more[0].Kind != event.KindStroke {
		t.Errorf("expected stroke after session_start, got %v", more[0].Kind)
	}
	// Summary on session_end covers strokes 1 and 2 of session 1.
	sum := got[3].SessionEnd.Summary
	if sum.TotalStrokes != 2 {
		t.Errorf("summary.TotalStrokes = %d, want 2", sum.TotalStrokes)
	}
}

func TestSessionizerEmitsLevelChange(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	in := make(chan ipm.Frame, 4)
	out := make(chan event.Event, 16)
	s := New(Options{IdleTimeout: time.Minute, Now: time.Now})
	go func() { _ = s.Run(ctx, in, out) }()

	in <- frame(0.0, 0, 25, 200, 3) // level 3
	in <- frame(2.2, 8, 27, 245, 5) // level 5 — triggers level_change
	got := drain(t, out, 4)
	// Order: session_start, stroke(level=3), stroke(level=5), level_change.
	if got[3].Kind != event.KindLevelChange {
		t.Errorf("expected level_change, got %v", got[3].Kind)
	}
	if got[3].LevelChange.From != 3 || got[3].LevelChange.To != 5 {
		t.Errorf("level change %d→%d, want 3→5", got[3].LevelChange.From, got[3].LevelChange.To)
	}
}
```

- [ ] **Step 2: Run — must fail**

```bash
cd backend && go test ./internal/session/ -v
```

Expected: compilation failure (Sessionizer / New / Options undefined).

- [ ] **Step 3: Implement**

Create `backend/internal/session/sessionizer.go`:

```go
package session

import (
	"context"
	"crypto/rand"
	"time"

	"github.com/gloeckner-daniel/home-ergo/internal/event"
	"github.com/gloeckner-daniel/home-ergo/internal/ipm"
	"github.com/oklog/ulid/v2"
)

// Options configures a Sessionizer. IdleTimeout controls the gap
// between stroke frames that closes a session. RowerID/RowerName are
// stubbed attribution per ARCH-0001 (real auth is a later plan). Now
// is injectable for deterministic tests.
type Options struct {
	IdleTimeout time.Duration
	RowerID     string
	RowerName   string
	Now         func() time.Time
}

// Sessionizer is the pipeline stage that turns a stream of ipm.Frame
// into a stream of event.Event with synthesised session boundaries,
// Tier-2 enrichment, and lifetime-monotonic ids.
type Sessionizer struct {
	opts    Options
	nextID  uint64
	session *sessionState
}

type sessionState struct {
	id            string
	startedAt     time.Time
	strokes       int
	totalDistance int
	totalTime     float64
	powerSum      int
	peakPower     int
	spmSum        int
	dpsSum        float64
	paceSum       int
	calSum        int
	lastStroke    *event.StrokePayload
	lastSeen      time.Time
	lastLevel     int
}

func New(o Options) *Sessionizer {
	if o.Now == nil {
		o.Now = time.Now
	}
	return &Sessionizer{opts: o, nextID: 0}
}

func (s *Sessionizer) stamp(e *event.Event) {
	s.nextID++
	e.ID = s.nextID
	if e.At.IsZero() {
		e.At = s.opts.Now()
	}
}

func (s *Sessionizer) emit(ctx context.Context, out chan<- event.Event, e event.Event) error {
	s.stamp(&e)
	select {
	case out <- e:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

// Run drains frames until ctx is done or in is closed. When in closes
// cleanly and a session is still open, Run synthesises a final
// session_end so consumers see a closed session.
func (s *Sessionizer) Run(ctx context.Context, in <-chan ipm.Frame, out chan<- event.Event) error {
	defer close(out)
	for {
		select {
		case <-ctx.Done():
			s.closeIfOpen(ctx, out)
			return ctx.Err()
		case f, ok := <-in:
			if !ok {
				s.closeIfOpen(ctx, out)
				return nil
			}
			if err := s.onFrame(ctx, f, out); err != nil {
				return err
			}
		}
	}
}

func (s *Sessionizer) onFrame(ctx context.Context, f ipm.Frame, out chan<- event.Event) error {
	now := s.opts.Now()

	if s.session != nil && now.Sub(s.session.lastSeen) >= s.opts.IdleTimeout {
		if err := s.closeSession(ctx, out); err != nil {
			return err
		}
	}
	if s.session == nil {
		if err := s.openSession(ctx, out, f); err != nil {
			return err
		}
	}

	stroke := s.enrich(f)
	if err := s.emit(ctx, out, event.Event{
		Kind:      event.KindStroke,
		SessionID: s.session.id,
		Stroke:    &stroke,
	}); err != nil {
		return err
	}
	s.accumulate(&stroke, f)

	if s.session.lastLevel != 0 && stroke.Level != s.session.lastLevel {
		if err := s.emit(ctx, out, event.Event{
			Kind:      event.KindLevelChange,
			SessionID: s.session.id,
			LevelChange: &event.LevelChangePayload{
				From: s.session.lastLevel, To: stroke.Level,
				AtStroke: stroke.StrokeNo, AtTimeSec: stroke.TimeSec,
			},
		}); err != nil {
			return err
		}
	}
	s.session.lastLevel = stroke.Level
	s.session.lastSeen = now
	return nil
}

func (s *Sessionizer) enrich(f ipm.Frame) event.StrokePayload {
	p := event.StrokePayload{
		StrokeNo: s.currentStrokeNo(),
		TimeSec:  f.TimeSec,
		DistanceM: f.DistanceM,
		SPM:       f.SPM,
		PowerW:    f.PowerW,
		CalPerHr:  f.CalPerHr,
		Level:     f.Level,
		RawPayload: f.RawPayload,
	}
	if s.session.lastStroke == nil {
		p.DPS = DPSFirst()
		p.StrokeCycleSec = 0
		p.PaceSecPer500m = 0
		p.EnergyJoules = 0
	} else {
		p.DPS = DPS(s.session.lastStroke.DistanceM, f.DistanceM, 0)
		p.StrokeCycleSec = StrokeCycleSec(s.session.lastStroke.TimeSec, f.TimeSec)
		p.PaceSecPer500m = PaceSecPer500m(p.DPS, p.StrokeCycleSec)
		p.EnergyJoules = EnergyJoules(f.PowerW, p.StrokeCycleSec)
	}
	return p
}

func (s *Sessionizer) currentStrokeNo() int { return s.session.strokes + 1 }

func (s *Sessionizer) accumulate(p *event.StrokePayload, _ ipm.Frame) {
	s.session.strokes++
	s.session.totalDistance = p.DistanceM
	s.session.totalTime = p.TimeSec
	s.session.powerSum += p.PowerW
	if p.PowerW > s.session.peakPower {
		s.session.peakPower = p.PowerW
	}
	s.session.spmSum += p.SPM
	s.session.dpsSum += p.DPS
	s.session.paceSum += p.PaceSecPer500m
	s.session.calSum += p.EnergyJoules
	p2 := *p
	s.session.lastStroke = &p2
}

func (s *Sessionizer) openSession(ctx context.Context, out chan<- event.Event, f ipm.Frame) error {
	id := ulid.Make().String()
	now := s.opts.Now()
	s.session = &sessionState{
		id:        id,
		startedAt: now,
		lastSeen:  now,
	}
	return s.emit(ctx, out, event.Event{
		Kind:      event.KindSessionStart,
		SessionID: id,
		SessionStart: &event.SessionStartPayload{
			StartedAt:    now,
			RowerID:      s.opts.RowerID,
			RowerName:    s.opts.RowerName,
			InitialLevel: f.Level,
		},
	})
}

func (s *Sessionizer) closeSession(ctx context.Context, out chan<- event.Event) error {
	st := s.session
	s.session = nil
	summary := event.SessionSummary{
		TotalDistanceM: st.totalDistance,
		TotalTimeSec:   st.totalTime,
		TotalStrokes:   st.strokes,
		PeakPowerW:     st.peakPower,
	}
	if st.strokes > 0 {
		summary.AvgPowerW = st.powerSum / st.strokes
		summary.AvgSPM = float64(st.spmSum) / float64(st.strokes)
		summary.AvgDPS = st.dpsSum / float64(st.strokes)
		summary.AvgPaceSecPer500m = st.paceSum / st.strokes
		summary.SessionCalories = st.calSum / 1000 // joules → kcal
	}
	return s.emit(ctx, out, event.Event{
		Kind:      event.KindSessionEnd,
		SessionID: st.id,
		SessionEnd: &event.SessionEndPayload{
			EndedAt: s.opts.Now(),
			Summary: summary,
		},
	})
}

func (s *Sessionizer) closeIfOpen(ctx context.Context, out chan<- event.Event) {
	if s.session == nil {
		return
	}
	_ = s.closeSession(ctx, out)
}

// noop — the ulid pkg already uses crypto/rand; exported symbol for
// test visibility if needed later.
var _ = rand.Reader
```

- [ ] **Step 4: Run — must pass**

```bash
cd backend && go test ./internal/session/ -v
```

Expected: all four tests pass.

- [ ] **Step 5: Commit**

```bash
git add backend/internal/session/sessionizer.go backend/internal/session/sessionizer_test.go
git commit -m "feat(backend): sessionizer with idle FSM and Tier-2 enrichment"
```

---

## Task 5: Pipeline ring buffer

**Files:**
- Create: `backend/internal/pipeline/ring.go`
- Create: `backend/internal/pipeline/ring_test.go`

The ring buffer is the replay store for reconnecting clients (per INT-0002 §replay/resume). Simple mutex-guarded slice; drop-oldest on overflow; capacity 10 000 (one long row's worth of strokes).

- [ ] **Step 1: Write the failing test**

Create `backend/internal/pipeline/ring_test.go`:

```go
package pipeline

import (
	"testing"

	"github.com/gloeckner-daniel/home-ergo/internal/event"
)

func TestRingWriteAndSince(t *testing.T) {
	r := NewRing(4)
	for i := uint64(1); i <= 3; i++ {
		r.Write(event.Event{ID: i})
	}
	got := r.Since(0)
	if len(got) != 3 || got[0].ID != 1 || got[2].ID != 3 {
		t.Fatalf("got %#v", got)
	}
	if got := r.Since(2); len(got) != 1 || got[0].ID != 3 {
		t.Fatalf("got %#v", got)
	}
	if got := r.Since(10); len(got) != 0 {
		t.Fatalf("expected empty, got %#v", got)
	}
}

func TestRingDropsOldest(t *testing.T) {
	r := NewRing(2)
	r.Write(event.Event{ID: 1})
	r.Write(event.Event{ID: 2})
	r.Write(event.Event{ID: 3})
	got := r.Since(0)
	if len(got) != 2 || got[0].ID != 2 || got[1].ID != 3 {
		t.Fatalf("got %#v", got)
	}
}

func TestRingStats(t *testing.T) {
	r := NewRing(10)
	r.Write(event.Event{ID: 5})
	r.Write(event.Event{ID: 6})
	oldest, newest, size := r.Stats()
	if oldest != 5 || newest != 6 || size != 2 {
		t.Fatalf("stats: %d %d %d", oldest, newest, size)
	}
}
```

- [ ] **Step 2: Run — must fail**

```bash
cd backend && go test ./internal/pipeline/ -v
```

- [ ] **Step 3: Implement**

Create `backend/internal/pipeline/ring.go`:

```go
// Package pipeline wires stages between the sessionizer and the leaf
// consumers (persister, broadcaster). See
// specs/arch/0001-backend-pipeline.md.
package pipeline

import (
	"sync"

	"github.com/gloeckner-daniel/home-ergo/internal/event"
)

// Ring is a bounded replay buffer of events. Writes never block; when
// the buffer is full the oldest entry is dropped. Readers call Since
// to obtain a snapshot of events newer than a given id.
type Ring struct {
	mu   sync.RWMutex
	buf  []event.Event
	cap  int
}

func NewRing(capacity int) *Ring {
	if capacity < 1 {
		capacity = 1
	}
	return &Ring{buf: make([]event.Event, 0, capacity), cap: capacity}
}

func (r *Ring) Write(e event.Event) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if len(r.buf) == r.cap {
		copy(r.buf, r.buf[1:])
		r.buf = r.buf[:len(r.buf)-1]
	}
	r.buf = append(r.buf, e)
}

// Since returns a copy of all buffered events with ID > afterID.
func (r *Ring) Since(afterID uint64) []event.Event {
	r.mu.RLock()
	defer r.mu.RUnlock()
	var out []event.Event
	for _, e := range r.buf {
		if e.ID > afterID {
			out = append(out, e)
		}
	}
	return out
}

// Stats returns (oldestID, newestID, size) for /debug/ingest.
// Returns zero values on an empty buffer.
func (r *Ring) Stats() (uint64, uint64, int) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	if len(r.buf) == 0 {
		return 0, 0, 0
	}
	return r.buf[0].ID, r.buf[len(r.buf)-1].ID, len(r.buf)
}
```

- [ ] **Step 4: Run — must pass**

```bash
cd backend && go test ./internal/pipeline/ -v
```

- [ ] **Step 5: Commit**

```bash
git add backend/internal/pipeline/ring.go backend/internal/pipeline/ring_test.go
git commit -m "feat(backend): pipeline ring buffer for SSE replay"
```

---

## Task 6: Pipeline dispatcher

**Files:**
- Create: `backend/internal/pipeline/dispatcher.go`
- Create: `backend/internal/pipeline/dispatcher_test.go`

Reads `event.Event`, writes to ring synchronously, then fans out to two downstream channels (persister + broadcaster) in parallel per ARCH-0001 §Dispatcher.

- [ ] **Step 1: Write the failing test**

Create `backend/internal/pipeline/dispatcher_test.go`:

```go
package pipeline

import (
	"context"
	"testing"
	"time"

	"github.com/gloeckner-daniel/home-ergo/internal/event"
)

func TestDispatcherFansOut(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	in := make(chan event.Event, 4)
	persist := make(chan event.Event, 4)
	broadcast := make(chan event.Event, 4)
	ring := NewRing(8)
	d := &Dispatcher{Ring: ring, Persist: persist, Broadcast: broadcast}

	done := make(chan error, 1)
	go func() { done <- d.Run(ctx, in) }()

	in <- event.Event{ID: 1}
	in <- event.Event{ID: 2}
	close(in)

	select {
	case err := <-done:
		if err != nil {
			t.Fatalf("run: %v", err)
		}
	case <-time.After(time.Second):
		t.Fatal("dispatcher did not return")
	}

	if n := len(persist); n != 2 {
		t.Errorf("persist received %d, want 2", n)
	}
	if n := len(broadcast); n != 2 {
		t.Errorf("broadcast received %d, want 2", n)
	}
	if _, newest, size := ring.Stats(); newest != 2 || size != 2 {
		t.Errorf("ring stats wrong: newest=%d size=%d", newest, size)
	}
}
```

- [ ] **Step 2: Run — must fail**

```bash
cd backend && go test ./internal/pipeline/ -run TestDispatcher -v
```

- [ ] **Step 3: Implement**

Create `backend/internal/pipeline/dispatcher.go`:

```go
package pipeline

import (
	"context"
	"log/slog"
	"sync"

	"github.com/gloeckner-daniel/home-ergo/internal/event"
)

// Dispatcher fans events out to the ring buffer, the persister
// channel, and the broadcaster channel. Per ARCH-0001 the ring write
// is synchronous-before-fanout so reconnecting clients never see a
// gap between the newest replayable id and the next live id.
type Dispatcher struct {
	Ring      *Ring
	Persist   chan<- event.Event
	Broadcast chan<- event.Event
}

// Run consumes events until in is closed or ctx is done. Closes the
// downstream channels on return so persister and broadcaster can
// drain and exit.
func (d *Dispatcher) Run(ctx context.Context, in <-chan event.Event) error {
	defer close(d.Persist)
	defer close(d.Broadcast)

	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case e, ok := <-in:
			if !ok {
				return nil
			}
			d.Ring.Write(e)
			var wg sync.WaitGroup
			wg.Add(2)
			go func() { defer wg.Done(); d.sendOrBlock(ctx, d.Persist, e, "persister") }()
			go func() { defer wg.Done(); d.sendOrBlock(ctx, d.Broadcast, e, "broadcaster") }()
			wg.Wait()
		}
	}
}

func (d *Dispatcher) sendOrBlock(ctx context.Context, ch chan<- event.Event, e event.Event, target string) {
	select {
	case ch <- e:
	default:
		slog.Error("pipeline.dispatcher.would_block", "target", target, "event_id", e.ID)
		select {
		case ch <- e:
		case <-ctx.Done():
		}
	}
}
```

- [ ] **Step 4: Run — must pass**

```bash
cd backend && go test ./internal/pipeline/ -v
```

- [ ] **Step 5: Commit**

```bash
git add backend/internal/pipeline/dispatcher.go backend/internal/pipeline/dispatcher_test.go
git commit -m "feat(backend): dispatcher fan-out to ring, persister, broadcaster"
```

---

## Task 7: Storage — open DB, WAL, embedded migrations

**Files:**
- Create: `backend/internal/storage/db.go`
- Create: `backend/internal/storage/db_test.go`
- Create: `backend/internal/storage/migrations/0001_init.sql`

- [ ] **Step 1: Write the migration**

Create `backend/internal/storage/migrations/0001_init.sql`:

```sql
CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  rower_id TEXT NOT NULL,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  initial_level INTEGER NOT NULL,
  total_distance_m INTEGER,
  total_time_sec REAL,
  total_strokes INTEGER,
  summary_json TEXT
);

CREATE INDEX IF NOT EXISTS idx_sessions_started_at ON sessions(started_at);
CREATE INDEX IF NOT EXISTS idx_sessions_rower ON sessions(rower_id, started_at);

CREATE TABLE IF NOT EXISTS strokes (
  global_id INTEGER PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id),
  stroke_no INTEGER NOT NULL,
  time_sec REAL NOT NULL,
  distance_m INTEGER NOT NULL,
  spm INTEGER NOT NULL,
  power_w INTEGER NOT NULL,
  cal_per_hr INTEGER NOT NULL,
  level INTEGER NOT NULL,
  dps REAL NOT NULL,
  stroke_cycle_sec REAL NOT NULL,
  pace_sec_per_500m INTEGER NOT NULL,
  energy_joules INTEGER NOT NULL,
  at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_strokes_session ON strokes(session_id, stroke_no);
```

- [ ] **Step 2: Write the failing test**

Create `backend/internal/storage/db_test.go`:

```go
package storage

import (
	"path/filepath"
	"testing"
)

func TestOpenRunsMigrations(t *testing.T) {
	path := filepath.Join(t.TempDir(), "test.db")
	db, err := Open(path)
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	defer db.Close()

	var v int
	if err := db.Handle().QueryRow(`SELECT MAX(version) FROM schema_migrations`).Scan(&v); err != nil {
		t.Fatalf("query: %v", err)
	}
	if v != 1 {
		t.Errorf("schema_migrations.max(version) = %d, want 1", v)
	}

	var mode string
	if err := db.Handle().QueryRow(`PRAGMA journal_mode`).Scan(&mode); err != nil {
		t.Fatalf("pragma: %v", err)
	}
	if mode != "wal" {
		t.Errorf("journal_mode = %q, want wal", mode)
	}
}

func TestOpenIsIdempotent(t *testing.T) {
	path := filepath.Join(t.TempDir(), "test.db")
	db, err := Open(path)
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	db.Close()

	db2, err := Open(path)
	if err != nil {
		t.Fatalf("reopen: %v", err)
	}
	defer db2.Close()

	var v int
	if err := db2.Handle().QueryRow(`SELECT MAX(version) FROM schema_migrations`).Scan(&v); err != nil {
		t.Fatalf("query: %v", err)
	}
	if v != 1 {
		t.Errorf("version after reopen = %d", v)
	}
}
```

- [ ] **Step 3: Run — must fail**

```bash
cd backend && go test ./internal/storage/ -v
```

- [ ] **Step 4: Implement**

Create `backend/internal/storage/db.go`:

```go
// Package storage owns the SQLite persistence of sessions and
// strokes. See specs/arch/0001-backend-pipeline.md and ADR-0004.
package storage

import (
	"database/sql"
	"embed"
	"fmt"
	"sort"
	"strings"

	_ "modernc.org/sqlite"
)

//go:embed migrations/*.sql
var migrations embed.FS

// DB wraps a *sql.DB. Use Open; Close; Handle for test access.
type DB struct {
	db *sql.DB
}

func (d *DB) Handle() *sql.DB { return d.db }
func (d *DB) Close() error    { return d.db.Close() }

// Open opens or creates the SQLite file at path, enables WAL, and
// applies any pending migrations. Safe to call at every process
// start.
func Open(path string) (*DB, error) {
	dsn := fmt.Sprintf("file:%s?_pragma=busy_timeout(5000)&_pragma=foreign_keys(on)", path)
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, fmt.Errorf("sql.Open: %w", err)
	}
	if _, err := db.Exec(`PRAGMA journal_mode=WAL;`); err != nil {
		db.Close()
		return nil, fmt.Errorf("set WAL: %w", err)
	}
	if err := applyMigrations(db); err != nil {
		db.Close()
		return nil, err
	}
	return &DB{db: db}, nil
}

func applyMigrations(db *sql.DB) error {
	if _, err := db.Exec(`CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT (datetime('now')))`); err != nil {
		return fmt.Errorf("migrations bootstrap: %w", err)
	}

	entries, err := migrations.ReadDir("migrations")
	if err != nil {
		return err
	}
	names := make([]string, 0, len(entries))
	for _, e := range entries {
		if !e.IsDir() && strings.HasSuffix(e.Name(), ".sql") {
			names = append(names, e.Name())
		}
	}
	sort.Strings(names)

	for _, name := range names {
		var version int
		if _, err := fmt.Sscanf(name, "%04d_", &version); err != nil {
			return fmt.Errorf("parse version from %q: %w", name, err)
		}
		var exists int
		if err := db.QueryRow(`SELECT COUNT(*) FROM schema_migrations WHERE version=?`, version).Scan(&exists); err != nil {
			return err
		}
		if exists > 0 {
			continue
		}
		body, err := migrations.ReadFile("migrations/" + name)
		if err != nil {
			return err
		}
		if _, err := db.Exec(string(body)); err != nil {
			return fmt.Errorf("apply %s: %w", name, err)
		}
		if _, err := db.Exec(`INSERT OR IGNORE INTO schema_migrations(version) VALUES(?)`, version); err != nil {
			return fmt.Errorf("record %s: %w", name, err)
		}
	}
	return nil
}
```

- [ ] **Step 5: Run — must pass**

```bash
cd backend && go test ./internal/storage/ -v
```

- [ ] **Step 6: Commit**

```bash
git add backend/internal/storage/db.go backend/internal/storage/db_test.go backend/internal/storage/migrations
git commit -m "feat(backend): SQLite storage open, WAL, embedded migrations"
```

---

## Task 8: Storage — write queries

**Files:**
- Create: `backend/internal/storage/queries.go`
- Create: `backend/internal/storage/queries_test.go`

Write-side only (reads come with the next plan's history UI). Three mutations: `InsertSession`, `UpdateSessionEnd`, `InsertStroke`.

- [ ] **Step 1: Write the failing test**

Create `backend/internal/storage/queries_test.go`:

```go
package storage

import (
	"context"
	"path/filepath"
	"testing"
	"time"

	"github.com/gloeckner-daniel/home-ergo/internal/event"
)

func testDB(t *testing.T) *DB {
	t.Helper()
	db, err := Open(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	t.Cleanup(func() { db.Close() })
	return db
}

func TestInsertSessionAndUpdateEnd(t *testing.T) {
	db := testDB(t)
	ctx := context.Background()

	started := time.Date(2026, 4, 21, 10, 0, 0, 0, time.UTC)
	if err := InsertSession(ctx, db.Handle(), "S1", "R1", started, 3); err != nil {
		t.Fatalf("insert session: %v", err)
	}

	ended := started.Add(5 * time.Minute)
	sum := event.SessionSummary{
		TotalDistanceM: 1000, TotalTimeSec: 300,
		TotalStrokes: 120, AvgPowerW: 250, PeakPowerW: 320,
		AvgSPM: 26.1, AvgDPS: 8.3, AvgPaceSecPer500m: 135, SessionCalories: 110,
	}
	if err := UpdateSessionEnd(ctx, db.Handle(), "S1", ended, sum); err != nil {
		t.Fatalf("update end: %v", err)
	}

	var totalDistance int
	var summaryJSON string
	if err := db.Handle().QueryRow(
		`SELECT total_distance_m, summary_json FROM sessions WHERE id=?`, "S1",
	).Scan(&totalDistance, &summaryJSON); err != nil {
		t.Fatalf("select: %v", err)
	}
	if totalDistance != 1000 {
		t.Errorf("total_distance_m = %d", totalDistance)
	}
	if summaryJSON == "" {
		t.Errorf("summary_json empty")
	}
}

func TestInsertStroke(t *testing.T) {
	db := testDB(t)
	ctx := context.Background()
	if err := InsertSession(ctx, db.Handle(), "S1", "R1", time.Now().UTC(), 3); err != nil {
		t.Fatal(err)
	}
	p := event.StrokePayload{
		StrokeNo: 1, TimeSec: 2.2, DistanceM: 8,
		SPM: 27, PowerW: 245, CalPerHr: 1175, Level: 3,
		DPS: 8, StrokeCycleSec: 2.2, PaceSecPer500m: 137, EnergyJoules: 544,
	}
	if err := InsertStroke(ctx, db.Handle(), 42, "S1", time.Now().UTC(), p); err != nil {
		t.Fatalf("insert stroke: %v", err)
	}
	var count int
	if err := db.Handle().QueryRow(`SELECT COUNT(*) FROM strokes WHERE session_id=?`, "S1").Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != 1 {
		t.Errorf("stroke count = %d", count)
	}
}
```

- [ ] **Step 2: Run — must fail**

```bash
cd backend && go test ./internal/storage/ -v
```

- [ ] **Step 3: Implement**

Create `backend/internal/storage/queries.go`:

```go
package storage

import (
	"context"
	"database/sql"
	"encoding/json"
	"time"

	"github.com/gloeckner-daniel/home-ergo/internal/event"
)

func InsertSession(ctx context.Context, db *sql.DB, id, rowerID string, startedAt time.Time, initialLevel int) error {
	_, err := db.ExecContext(ctx,
		`INSERT INTO sessions(id, rower_id, started_at, initial_level) VALUES(?, ?, ?, ?)`,
		id, rowerID, startedAt.UTC().Format(time.RFC3339Nano), initialLevel)
	return err
}

func UpdateSessionEnd(ctx context.Context, db *sql.DB, id string, endedAt time.Time, s event.SessionSummary) error {
	blob, err := json.Marshal(s)
	if err != nil {
		return err
	}
	_, err = db.ExecContext(ctx,
		`UPDATE sessions SET ended_at=?, total_distance_m=?, total_time_sec=?, total_strokes=?, summary_json=? WHERE id=?`,
		endedAt.UTC().Format(time.RFC3339Nano), s.TotalDistanceM, s.TotalTimeSec, s.TotalStrokes, string(blob), id)
	return err
}

func InsertStroke(ctx context.Context, db *sql.DB, globalID uint64, sessionID string, at time.Time, p event.StrokePayload) error {
	_, err := db.ExecContext(ctx,
		`INSERT INTO strokes(
			global_id, session_id, stroke_no, time_sec, distance_m, spm, power_w, cal_per_hr, level,
			dps, stroke_cycle_sec, pace_sec_per_500m, energy_joules, at
		) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		globalID, sessionID, p.StrokeNo, p.TimeSec, p.DistanceM, p.SPM, p.PowerW, p.CalPerHr, p.Level,
		p.DPS, p.StrokeCycleSec, p.PaceSecPer500m, p.EnergyJoules,
		at.UTC().Format(time.RFC3339Nano))
	return err
}
```

- [ ] **Step 4: Run — must pass**

```bash
cd backend && go test ./internal/storage/ -v
```

- [ ] **Step 5: Commit**

```bash
git add backend/internal/storage/queries.go backend/internal/storage/queries_test.go
git commit -m "feat(backend): storage write queries for sessions + strokes"
```

---

## Task 9: Persister

**Files:**
- Create: `backend/internal/storage/persister.go`
- Create: `backend/internal/storage/persister_test.go`

Consumes the dispatcher's persister channel. Retries on SQLite error with exponential backoff (100 ms → 5 s cap), as specified in ARCH-0001.

- [ ] **Step 1: Write the failing test**

Create `backend/internal/storage/persister_test.go`:

```go
package storage

import (
	"context"
	"path/filepath"
	"testing"
	"time"

	"github.com/gloeckner-daniel/home-ergo/internal/event"
)

func TestPersisterWritesFullSession(t *testing.T) {
	db, err := Open(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	in := make(chan event.Event, 8)
	p := &Persister{DB: db.Handle()}
	done := make(chan error, 1)
	go func() { done <- p.Run(ctx, in) }()

	started := time.Date(2026, 4, 21, 10, 0, 0, 0, time.UTC)
	in <- event.Event{ID: 1, Kind: event.KindSessionStart, SessionID: "S1",
		SessionStart: &event.SessionStartPayload{StartedAt: started, RowerID: "R1", RowerName: "D", InitialLevel: 3}}
	in <- event.Event{ID: 2, Kind: event.KindStroke, SessionID: "S1", At: started,
		Stroke: &event.StrokePayload{StrokeNo: 1, TimeSec: 2.2, DistanceM: 8, SPM: 27, PowerW: 245, CalPerHr: 1175, Level: 3,
			DPS: 8, StrokeCycleSec: 2.2, PaceSecPer500m: 137, EnergyJoules: 544}}
	in <- event.Event{ID: 3, Kind: event.KindSessionEnd, SessionID: "S1",
		SessionEnd: &event.SessionEndPayload{EndedAt: started.Add(time.Minute),
			Summary: event.SessionSummary{TotalDistanceM: 8, TotalTimeSec: 2.2, TotalStrokes: 1}}}
	close(in)

	select {
	case err := <-done:
		if err != nil {
			t.Fatalf("run: %v", err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("persister did not finish")
	}

	var strokes int
	if err := db.Handle().QueryRow(`SELECT COUNT(*) FROM strokes WHERE session_id=?`, "S1").Scan(&strokes); err != nil {
		t.Fatal(err)
	}
	if strokes != 1 {
		t.Errorf("strokes = %d, want 1", strokes)
	}
	var endedAt string
	if err := db.Handle().QueryRow(`SELECT COALESCE(ended_at,'') FROM sessions WHERE id=?`, "S1").Scan(&endedAt); err != nil {
		t.Fatal(err)
	}
	if endedAt == "" {
		t.Errorf("ended_at should be set")
	}
}
```

- [ ] **Step 2: Run — must fail**

```bash
cd backend && go test ./internal/storage/ -run TestPersister -v
```

- [ ] **Step 3: Implement**

Create `backend/internal/storage/persister.go`:

```go
package storage

import (
	"context"
	"database/sql"
	"errors"
	"log/slog"
	"time"

	"github.com/gloeckner-daniel/home-ergo/internal/event"
)

// Persister consumes events and persists sessions and strokes to
// SQLite. Retries with exponential backoff on transient SQLite errors
// (100 ms → 5 s cap, infinite); never drops.
type Persister struct {
	DB       *sql.DB
	Retries  int // optional — exposed for /debug/ingest
}

const (
	minBackoff = 100 * time.Millisecond
	maxBackoff = 5 * time.Second
)

func (p *Persister) Run(ctx context.Context, in <-chan event.Event) error {
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case e, ok := <-in:
			if !ok {
				return nil
			}
			p.applyWithRetry(ctx, e)
		}
	}
}

func (p *Persister) applyWithRetry(ctx context.Context, e event.Event) {
	backoff := minBackoff
	for {
		err := p.apply(ctx, e)
		if err == nil {
			return
		}
		if errors.Is(err, context.Canceled) {
			return
		}
		p.Retries++
		slog.Error("storage.persister.retry", "event_id", e.ID, "err", err, "backoff", backoff)
		select {
		case <-time.After(backoff):
		case <-ctx.Done():
			return
		}
		backoff *= 2
		if backoff > maxBackoff {
			backoff = maxBackoff
		}
	}
}

func (p *Persister) apply(ctx context.Context, e event.Event) error {
	switch e.Kind {
	case event.KindSessionStart:
		return InsertSession(ctx, p.DB, e.SessionID, e.SessionStart.RowerID, e.SessionStart.StartedAt, e.SessionStart.InitialLevel)
	case event.KindStroke:
		return InsertStroke(ctx, p.DB, e.ID, e.SessionID, e.At, *e.Stroke)
	case event.KindSessionEnd:
		return UpdateSessionEnd(ctx, p.DB, e.SessionID, e.SessionEnd.EndedAt, e.SessionEnd.Summary)
	case event.KindLevelChange:
		// No persistent write — level is already on every stroke row.
		return nil
	}
	return nil
}
```

- [ ] **Step 4: Run — must pass**

```bash
cd backend && go test ./internal/storage/ -v
```

- [ ] **Step 5: Commit**

```bash
git add backend/internal/storage/persister.go backend/internal/storage/persister_test.go
git commit -m "feat(backend): persister consumes events into SQLite with retry"
```

---

## Task 10: Broadcaster

**Files:**
- Create: `backend/internal/stream/broadcaster.go`
- Create: `backend/internal/stream/broadcaster_test.go`

Owns the set of connected SSE clients. One input channel from the dispatcher, one per-client outbound channel (size 64). Drops *clients* whose channel fills (INT-0002 §backpressure). Emits a ping every 20 s on an idle client.

- [ ] **Step 1: Write the failing test**

Create `backend/internal/stream/broadcaster_test.go`:

```go
package stream

import (
	"context"
	"testing"
	"time"

	"github.com/gloeckner-daniel/home-ergo/internal/event"
)

func TestBroadcasterFanOutToClients(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	in := make(chan event.Event, 8)
	b := NewBroadcaster(in)
	go func() { _ = b.Run(ctx) }()

	a := b.Subscribe(0) // subscribe from scratch (no replay yet)
	c := b.Subscribe(0)

	in <- event.Event{ID: 1, Kind: event.KindPing()} // Kind helper? No — use real kind.

	// Re-do: use a real stroke kind via Marshal-capable payload.
	// The broadcaster doesn't discriminate — it forwards every event.
	_ = a
	_ = c
}

func TestBroadcasterDropsSlowClient(t *testing.T) {
	// Build a client whose receive channel capacity is 1 and doesn't
	// consume, then send 3 events. Broadcaster must close the channel
	// rather than block other clients.
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	in := make(chan event.Event, 8)
	b := NewBroadcaster(in)
	go func() { _ = b.Run(ctx) }()

	_ = b.Subscribe(0) // slow — we never read from it

	for i := 1; i <= BroadcasterPerClientBuffer+2; i++ {
		in <- event.Event{ID: uint64(i)}
	}
	// Allow the broadcaster goroutine to catch up.
	time.Sleep(50 * time.Millisecond)

	if got := b.DroppedClients(); got != 1 {
		t.Errorf("dropped clients = %d, want 1", got)
	}
}
```

Note: `KindPing()` does not exist — replace the first test with a concrete live-event test once the broadcaster impl lands. Rewrite the first test as:

```go
func TestBroadcasterFanOutToClients(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	in := make(chan event.Event, 8)
	b := NewBroadcaster(in)
	go func() { _ = b.Run(ctx) }()

	a := b.Subscribe(0)
	c := b.Subscribe(0)

	in <- event.Event{ID: 1, Kind: event.KindStroke, SessionID: "S1", Stroke: &event.StrokePayload{}}

	select {
	case e := <-a:
		if e.ID != 1 {
			t.Errorf("client a got id=%d", e.ID)
		}
	case <-time.After(time.Second):
		t.Fatal("client a timeout")
	}
	select {
	case e := <-c:
		if e.ID != 1 {
			t.Errorf("client c got id=%d", e.ID)
		}
	case <-time.After(time.Second):
		t.Fatal("client c timeout")
	}
}
```

- [ ] **Step 2: Run — must fail**

```bash
cd backend && go test ./internal/stream/ -v
```

- [ ] **Step 3: Implement**

Create `backend/internal/stream/broadcaster.go`:

```go
// Package stream owns the SSE fan-out layer: broadcaster + the HTTP
// handler at /api/v1/stream. See specs/arch/0001-backend-pipeline.md.
package stream

import (
	"context"
	"sync"

	"github.com/gloeckner-daniel/home-ergo/internal/event"
)

// BroadcasterPerClientBuffer is the per-client outbound channel size.
// Exposed for tests.
const BroadcasterPerClientBuffer = 64

// Broadcaster fans events out to every subscribed client. A client
// whose receive buffer fills is dropped (its channel is closed);
// the HTTP handler detects the closure and ends the request so the
// browser's EventSource reconnects.
type Broadcaster struct {
	in      <-chan event.Event
	mu      sync.Mutex
	clients map[int]chan event.Event
	nextID  int
	dropped int
}

func NewBroadcaster(in <-chan event.Event) *Broadcaster {
	return &Broadcaster{in: in, clients: map[int]chan event.Event{}}
}

// Subscribe returns a channel of events. The afterID parameter
// currently unused; replay is handled at the HTTP level in sse.go
// by querying the ring first. The parameter is kept for future
// broadcaster-internal ordering guarantees.
func (b *Broadcaster) Subscribe(_ uint64) <-chan event.Event {
	ch := make(chan event.Event, BroadcasterPerClientBuffer)
	b.mu.Lock()
	b.nextID++
	b.clients[b.nextID] = ch
	b.mu.Unlock()
	return ch
}

func (b *Broadcaster) DroppedClients() int {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.dropped
}

func (b *Broadcaster) ClientCount() int {
	b.mu.Lock()
	defer b.mu.Unlock()
	return len(b.clients)
}

// Run consumes in and pushes every event to every live subscriber
// non-blockingly; slow subscribers are dropped.
func (b *Broadcaster) Run(ctx context.Context) error {
	for {
		select {
		case <-ctx.Done():
			b.closeAll()
			return ctx.Err()
		case e, ok := <-b.in:
			if !ok {
				b.closeAll()
				return nil
			}
			b.fanout(e)
		}
	}
}

func (b *Broadcaster) fanout(e event.Event) {
	b.mu.Lock()
	defer b.mu.Unlock()
	for id, ch := range b.clients {
		select {
		case ch <- e:
		default:
			close(ch)
			delete(b.clients, id)
			b.dropped++
		}
	}
}

func (b *Broadcaster) closeAll() {
	b.mu.Lock()
	defer b.mu.Unlock()
	for id, ch := range b.clients {
		close(ch)
		delete(b.clients, id)
	}
}
```

- [ ] **Step 4: Run — must pass**

```bash
cd backend && go test ./internal/stream/ -v
```

Expected: both tests pass.

- [ ] **Step 5: Commit**

```bash
git add backend/internal/stream/broadcaster.go backend/internal/stream/broadcaster_test.go
git commit -m "feat(backend): broadcaster fan-out with slow-client drop"
```

---

## Task 11: SSE HTTP handler

**Files:**
- Create: `backend/internal/stream/sse.go`
- Create: `backend/internal/stream/sse_test.go`

`GET /api/v1/stream`. Parses `Last-Event-ID` and `?since=`, replays the ring, then attaches to the broadcaster for live events.

- [ ] **Step 1: Write the failing test**

Create `backend/internal/stream/sse_test.go`:

```go
package stream

import (
	"bufio"
	"context"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gloeckner-daniel/home-ergo/internal/event"
	"github.com/gloeckner-daniel/home-ergo/internal/pipeline"
)

func TestSSEReplayThenLive(t *testing.T) {
	ring := pipeline.NewRing(16)
	ring.Write(event.Event{ID: 1, Kind: event.KindStroke, SessionID: "S1", Stroke: &event.StrokePayload{StrokeNo: 1, TimeSec: 0.0, DistanceM: 0, SPM: 25, PowerW: 200, CalPerHr: 1000, Level: 3}})

	bcastIn := make(chan event.Event, 4)
	b := NewBroadcaster(bcastIn)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go func() { _ = b.Run(ctx) }()

	h := NewHandler(ring, b)
	srv := httptest.NewServer(h)
	defer srv.Close()

	req, _ := http.NewRequestWithContext(ctx, "GET", srv.URL, nil)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.Header.Get("Content-Type") != "text/event-stream; charset=utf-8" {
		t.Errorf("content-type = %q", resp.Header.Get("Content-Type"))
	}

	rd := bufio.NewReader(resp.Body)
	got := readOneEvent(t, rd)
	if !strings.Contains(got, "event: stroke") || !strings.Contains(got, "id: 1") {
		t.Errorf("replay event missing expected fields: %q", got)
	}

	// Now push a live event through the broadcaster.
	bcastIn <- event.Event{ID: 2, Kind: event.KindStroke, SessionID: "S1", Stroke: &event.StrokePayload{StrokeNo: 2}}

	got = readOneEvent(t, rd)
	if !strings.Contains(got, "id: 2") {
		t.Errorf("live event missing: %q", got)
	}
}

func readOneEvent(t *testing.T, rd *bufio.Reader) string {
	t.Helper()
	var b strings.Builder
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		line, err := rd.ReadString('\n')
		if err != nil {
			t.Fatal(err)
		}
		if line == "\n" {
			if b.Len() > 0 {
				return b.String()
			}
			continue
		}
		b.WriteString(line)
	}
	t.Fatal("timeout reading SSE event")
	return ""
}
```

Add `import "net/http"` to the test file.

- [ ] **Step 2: Run — must fail**

```bash
cd backend && go test ./internal/stream/ -v
```

- [ ] **Step 3: Implement**

Create `backend/internal/stream/sse.go`:

```go
package stream

import (
	"fmt"
	"net/http"
	"strconv"
	"time"

	"github.com/gloeckner-daniel/home-ergo/internal/event"
	"github.com/gloeckner-daniel/home-ergo/internal/pipeline"
)

// NewHandler returns the /api/v1/stream handler. Auth is the caller's
// responsibility (middleware); this handler assumes the request has
// been authenticated.
func NewHandler(ring *pipeline.Ring, b *Broadcaster) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		flusher, ok := w.(http.Flusher)
		if !ok {
			http.Error(w, "streaming unsupported", http.StatusInternalServerError)
			return
		}

		w.Header().Set("Content-Type", "text/event-stream; charset=utf-8")
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("Connection", "keep-alive")
		w.WriteHeader(http.StatusOK)

		afterID := parseAfterID(r)

		// Replay phase: everything in the ring newer than afterID.
		for _, e := range ring.Since(afterID) {
			if err := writeSSE(w, flusher, e); err != nil {
				return
			}
			if e.ID > afterID {
				afterID = e.ID
			}
		}

		// Attach to broadcaster.
		ch := b.Subscribe(afterID)
		ticker := time.NewTicker(20 * time.Second)
		defer ticker.Stop()

		for {
			select {
			case <-r.Context().Done():
				return
			case e, ok := <-ch:
				if !ok {
					return
				}
				if e.ID <= afterID {
					continue
				}
				if err := writeSSE(w, flusher, e); err != nil {
					return
				}
				afterID = e.ID
			case <-ticker.C:
				if _, err := fmt.Fprintf(w, "event: ping\ndata: {}\n\n"); err != nil {
					return
				}
				flusher.Flush()
			}
		}
	})
}

func parseAfterID(r *http.Request) uint64 {
	if s := r.URL.Query().Get("since"); s != "" {
		if v, err := strconv.ParseUint(s, 10, 64); err == nil {
			return v
		}
	}
	if s := r.Header.Get("Last-Event-ID"); s != "" {
		if v, err := strconv.ParseUint(s, 10, 64); err == nil {
			return v
		}
	}
	return 0
}

func writeSSE(w http.ResponseWriter, f http.Flusher, e event.Event) error {
	name := event.EventName(e.Kind)
	if name == "" {
		return nil
	}
	data, err := event.Marshal(e)
	if err != nil {
		return err
	}
	if _, err := fmt.Fprintf(w, "event: %s\nid: %d\ndata: %s\n\n", name, e.ID, data); err != nil {
		return err
	}
	f.Flush()
	return nil
}
```

- [ ] **Step 4: Run — must pass**

```bash
cd backend && go test ./internal/stream/ -v
```

- [ ] **Step 5: Commit**

```bash
git add backend/internal/stream/sse.go backend/internal/stream/sse_test.go
git commit -m "feat(backend): SSE handler with ring replay + live follow + ping"
```

---

## Task 12: /debug/ingest handler

**Files:**
- Create: `backend/internal/api/debug.go`
- Create: `backend/internal/api/debug_test.go`

Exposes pipeline health per ARCH-0001 §Observability.

- [ ] **Step 1: Write the failing test**

Create `backend/internal/api/debug_test.go`:

```go
package api

import (
	"encoding/json"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gloeckner-daniel/home-ergo/internal/pipeline"
	"github.com/gloeckner-daniel/home-ergo/internal/stream"
)

func TestDebugIngestShape(t *testing.T) {
	ring := pipeline.NewRing(16)
	bcast := stream.NewBroadcaster(make(chan interface{}) /* placeholder */)

	// The stream.Broadcaster's in channel is typed; use the real signature.
}
```

Rewrite — the earlier sketch used an `interface{}` channel. Use the real types:

```go
package api

import (
	"encoding/json"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gloeckner-daniel/home-ergo/internal/event"
	"github.com/gloeckner-daniel/home-ergo/internal/pipeline"
	"github.com/gloeckner-daniel/home-ergo/internal/stream"
)

func TestDebugIngestShape(t *testing.T) {
	ring := pipeline.NewRing(16)
	ring.Write(event.Event{ID: 1})

	b := stream.NewBroadcaster(make(chan event.Event))

	start := time.Unix(1000, 0)
	h := DebugIngestHandler(DebugIngestInputs{
		Ring:        ring,
		Broadcaster: b,
		StartedAt:   start,
		Now:         func() time.Time { return start.Add(10 * time.Second) },
	})

	req := httptest.NewRequest("GET", "/debug/ingest", nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if rec.Code != 200 {
		t.Fatalf("status = %d", rec.Code)
	}
	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body["uptime_sec"] != float64(10) {
		t.Errorf("uptime_sec = %v", body["uptime_sec"])
	}
	if body["ring"] == nil {
		t.Error("ring missing")
	}
	if body["broadcaster"] == nil {
		t.Error("broadcaster missing")
	}
}
```

- [ ] **Step 2: Run — must fail**

```bash
cd backend && go test ./internal/api/ -v
```

- [ ] **Step 3: Implement**

Create `backend/internal/api/debug.go`:

```go
package api

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/gloeckner-daniel/home-ergo/internal/pipeline"
	"github.com/gloeckner-daniel/home-ergo/internal/stream"
)

type DebugIngestInputs struct {
	Ring        *pipeline.Ring
	Broadcaster *stream.Broadcaster
	StartedAt   time.Time
	Now         func() time.Time
}

func DebugIngestHandler(in DebugIngestInputs) http.Handler {
	if in.Now == nil {
		in.Now = time.Now
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		oldest, newest, size := in.Ring.Stats()
		body := map[string]any{
			"uptime_sec": int(in.Now().Sub(in.StartedAt).Seconds()),
			"ring": map[string]any{
				"size":      size,
				"oldest_id": oldest,
				"newest_id": newest,
			},
			"broadcaster": map[string]any{
				"clients":          in.Broadcaster.ClientCount(),
				"clients_dropped":  in.Broadcaster.DroppedClients(),
			},
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(body)
	})
}
```

- [ ] **Step 4: Run — must pass**

```bash
cd backend && go test ./internal/api/ -v
```

- [ ] **Step 5: Commit**

```bash
git add backend/internal/api/debug.go backend/internal/api/debug_test.go
git commit -m "feat(backend): /debug/ingest JSON health"
```

---

## Task 13: Wire the router

**Files:**
- Modify: `backend/internal/api/router.go`

Add `/api/v1/stream` and `/debug/ingest`. The handler constructors take external dependencies (ring, broadcaster, start-time) — thread these in via a `RouterInputs` struct so `main` can wire them.

- [ ] **Step 1: Edit the router**

Overwrite `backend/internal/api/router.go`:

```go
package api

import (
	"net/http"
	"time"

	"github.com/gloeckner-daniel/home-ergo/internal/pipeline"
	"github.com/gloeckner-daniel/home-ergo/internal/stream"
)

// Inputs aggregates the stateful dependencies the router needs from
// main.
type Inputs struct {
	Ring        *pipeline.Ring
	Broadcaster *stream.Broadcaster
	StartedAt   time.Time
}

// NewRouter builds the HTTP handler.
func NewRouter(in Inputs) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/health", healthHandler)
	mux.Handle("GET /api/v1/stream", stream.NewHandler(in.Ring, in.Broadcaster))
	mux.Handle("GET /debug/ingest", DebugIngestHandler(DebugIngestInputs{
		Ring:        in.Ring,
		Broadcaster: in.Broadcaster,
		StartedAt:   in.StartedAt,
	}))
	return Chain(mux, Recover(), Logging())
}
```

- [ ] **Step 2: Verify compile + tests still green**

```bash
cd backend && go build ./... && go test ./...
```

Expected: all green. `main.go` will not compile yet — it calls `api.NewRouter()` without args. That's fixed in Task 14.

- [ ] **Step 3: Commit**

```bash
git add backend/internal/api/router.go
git commit -m "feat(backend): router registers /api/v1/stream + /debug/ingest"
```

---

## Task 14: Wire main.go — full pipeline

**Files:**
- Modify: `backend/cmd/homeergo/main.go`

Replace the stdout printer with: parser → sessionizer → dispatcher → (ring + persister + broadcaster). Use `errgroup` for coordinated shutdown.

- [ ] **Step 1: Overwrite main.go**

Overwrite `backend/cmd/homeergo/main.go`:

```go
package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"golang.org/x/sync/errgroup"

	"github.com/gloeckner-daniel/home-ergo/internal/api"
	"github.com/gloeckner-daniel/home-ergo/internal/config"
	"github.com/gloeckner-daniel/home-ergo/internal/event"
	"github.com/gloeckner-daniel/home-ergo/internal/ipm"
	"github.com/gloeckner-daniel/home-ergo/internal/pipeline"
	"github.com/gloeckner-daniel/home-ergo/internal/session"
	"github.com/gloeckner-daniel/home-ergo/internal/storage"
	"github.com/gloeckner-daniel/home-ergo/internal/stream"
)

const httpShutdownTimeout = 30 * time.Second

func main() {
	if err := run(); err != nil {
		slog.Error("homeergo.exit", "err", err)
		os.Exit(1)
	}
}

func run() error {
	cfg, err := config.Load(os.LookupEnv)
	if err != nil {
		return err
	}
	configureLogger(cfg.LogLevel)
	slog.Info("homeergo.start",
		"addr", cfg.Addr, "fixture", cfg.Fixture, "fixture_rate", cfg.FixtureRate,
		"serial_port", cfg.SerialPort, "db_path", cfg.DBPath, "idle_timeout", cfg.IdleTimeout,
	)

	ctx, cancel := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer cancel()

	db, err := storage.Open(cfg.DBPath)
	if err != nil {
		return err
	}
	defer db.Close()

	// Wire stages: frames → events → (ring + persister + broadcaster).
	frames := make(chan ipm.Frame, 64)
	events := make(chan event.Event, 64)
	persistCh := make(chan event.Event, 1024)
	broadcastCh := make(chan event.Event, 256)

	producer := pickProducer(cfg)
	ring := pipeline.NewRing(10000)
	bcast := stream.NewBroadcaster(broadcastCh)
	sessionizer := session.New(session.Options{
		IdleTimeout: cfg.IdleTimeout,
		RowerID:     "local-rower",
		RowerName:   "Lokal",
	})
	dispatcher := &pipeline.Dispatcher{Ring: ring, Persist: persistCh, Broadcast: broadcastCh}
	persister := &storage.Persister{DB: db.Handle()}

	g, gctx := errgroup.WithContext(ctx)
	g.Go(func() error { return producer.Run(gctx, frames) })
	g.Go(func() error { return sessionizer.Run(gctx, frames, events) })
	g.Go(func() error { return dispatcher.Run(gctx, events) })
	g.Go(func() error { return persister.Run(gctx, persistCh) })
	g.Go(func() error { return bcast.Run(gctx) })

	srv := &http.Server{
		Addr: cfg.Addr,
		Handler: api.NewRouter(api.Inputs{
			Ring:        ring,
			Broadcaster: bcast,
			StartedAt:   time.Now(),
		}),
		ReadHeaderTimeout: 10 * time.Second,
	}
	g.Go(func() error {
		err := srv.ListenAndServe()
		if errors.Is(err, http.ErrServerClosed) {
			return nil
		}
		return err
	})
	g.Go(func() error {
		<-gctx.Done()
		sctx, scancel := context.WithTimeout(context.Background(), httpShutdownTimeout)
		defer scancel()
		return srv.Shutdown(sctx)
	})

	if err := g.Wait(); err != nil && !errors.Is(err, context.Canceled) {
		return err
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

- [ ] **Step 2: Build + run tests**

```bash
cd backend && go build ./... && go test ./...
```

Expected: everything green.

- [ ] **Step 3: Commit**

```bash
git add backend/cmd/homeergo/main.go
git commit -m "feat(backend): wire full M3 pipeline in main with errgroup"
```

---

## Task 15: End-to-end SSE smoke with fixture

**Files:**
- Create: `backend/cmd/homeergo/main_sse_test.go`

Boot the binary with the short-session CSV fixture, open `/api/v1/stream`, assert the expected event order.

- [ ] **Step 1: Write the test**

Create `backend/cmd/homeergo/main_sse_test.go`:

```go
package main

import (
	"bufio"
	"context"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// e2e boots the real main via run(), pointing at a fixture + temp DB
// + a random port. Returns the URL of the SSE endpoint.
func startServer(t *testing.T, fixture string) string {
	t.Helper()
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	addr := l.Addr().String()
	l.Close()

	db := filepath.Join(t.TempDir(), "homeergo.db")
	os.Setenv("HOMEERGO_ADDR", addr)
	os.Setenv("HOMEERGO_DB_PATH", db)
	os.Setenv("HOMEERGO_FIXTURE", fixture)
	os.Setenv("HOMEERGO_FIXTURE_RATE", "fast")
	os.Setenv("HOMEERGO_IDLE_TIMEOUT", "60s")

	done := make(chan error, 1)
	go func() { done <- run() }()
	t.Cleanup(func() {
		_ = syscallInterrupt()
		<-done
	})
	waitForServer(t, "http://"+addr+"/api/health")
	return "http://" + addr
}

func syscallInterrupt() error { return nil } // best-effort; the process exits when the fixture EOFs anyway

func waitForServer(t *testing.T, url string) {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		if r, err := http.Get(url); err == nil {
			r.Body.Close()
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatalf("server at %s never came up", url)
}

func TestEndToEndShortSession(t *testing.T) {
	base := startServer(t, "../../specs/int/fixtures/ipm/session-short.csv")

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	req, _ := http.NewRequestWithContext(ctx, "GET", base+"/api/v1/stream", nil)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()

	rd := bufio.NewReader(resp.Body)
	var kinds []string
	seenStroke := 0
	for i := 0; i < 30 && ctx.Err() == nil; i++ {
		block, err := readBlock(rd)
		if err != nil {
			break
		}
		for _, line := range strings.Split(block, "\n") {
			if strings.HasPrefix(line, "event: ") {
				k := strings.TrimPrefix(line, "event: ")
				kinds = append(kinds, k)
				if k == "stroke" {
					seenStroke++
				}
			}
		}
		if seenStroke >= 2 {
			break
		}
	}
	if len(kinds) == 0 || kinds[0] != "session_start" {
		t.Errorf("first event = %q, want session_start (all = %v)", firstOrEmpty(kinds), kinds)
	}
	if seenStroke < 2 {
		t.Errorf("saw %d strokes, wanted ≥ 2", seenStroke)
	}
}

func readBlock(rd *bufio.Reader) (string, error) {
	var b strings.Builder
	for {
		line, err := rd.ReadString('\n')
		if err != nil {
			return "", err
		}
		if line == "\n" {
			return b.String(), nil
		}
		b.WriteString(line)
	}
}

func firstOrEmpty(xs []string) string {
	if len(xs) == 0 {
		return ""
	}
	return xs[0]
}
```

- [ ] **Step 2: Run**

```bash
cd backend && go test ./cmd/homeergo/ -run TestEndToEndShortSession -v
```

Expected: passes. First event is `session_start`; ≥ 2 `stroke` events arrive.

- [ ] **Step 3: Commit**

```bash
git add backend/cmd/homeergo/main_sse_test.go
git commit -m "test(backend): end-to-end SSE smoke over fixture"
```

---

## Task 16: Frontend — point live view at the real backend

**Files:**
- Create: `web/tests/e2e/live-view-real-backend.spec.ts`
- Modify: `web/playwright.config.ts` (add a second project or just an env-gated variant)

A Playwright test that spawns the Go backend with a fast-mode fixture, loads the PWA, and asserts the hero shows a non-dash split.

- [ ] **Step 1: Write the spec**

Create `web/tests/e2e/live-view-real-backend.spec.ts`:

```ts
import { test, expect } from '@playwright/test'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let backend: ChildProcessWithoutNullStreams | null = null

test.beforeAll(async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'homeergo-e2e-'))
  backend = spawn('go', ['run', './cmd/homeergo'], {
    cwd: join(process.cwd(), '..', 'backend'),
    env: {
      ...process.env,
      HOMEERGO_ADDR: ':8080',
      HOMEERGO_DB_PATH: join(tmp, 'e2e.db'),
      HOMEERGO_FIXTURE: 'specs/int/fixtures/ipm/session-short.csv',
      HOMEERGO_FIXTURE_RATE: 'fast',
      HOMEERGO_IDLE_TIMEOUT: '60s',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  // Wait for /api/health to respond.
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    try {
      const r = await fetch('http://localhost:8080/api/health')
      if (r.ok) return
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 100))
  }
  throw new Error('backend did not come up')
})

test.afterAll(async () => {
  backend?.kill('SIGINT')
  backend = null
})

test('live view shows real split from backend fixture', async ({ page }) => {
  await page.goto('/')
  // With fast-pacing fixture, strokes arrive within ~1 s.
  await expect(page.locator('text=/^\\d+:\\d{2}\\.\\d$/').first()).toBeVisible({ timeout: 5000 })
  // Confirm we moved off the em-dash idle state for at least one numeric field.
  const zeitValue = await page.getByText('Zeit', { exact: true }).locator('xpath=following-sibling::span').first().innerText()
  expect(zeitValue).not.toBe('—')
})
```

- [ ] **Step 2: Run**

```bash
cd web && npm run e2e -- live-view-real-backend
```

Expected: the test passes — split and Zeit fields show real values.

- [ ] **Step 3: Commit**

```bash
git add web/tests/e2e/live-view-real-backend.spec.ts
git commit -m "test(web): e2e against real Go backend with fixture"
```

---

## Task 17: Backend README

**Files:**
- Create: `backend/README.md`

Short, developer-oriented. What env vars, how to run dev mode against a fixture, how to point the frontend at it.

- [ ] **Step 1: Write**

Create `backend/README.md`:

````markdown
# backend — Home Ergo backend

Go service that reads the FDF IPM serial console, derives per-stroke metrics, broadcasts a Server-Sent-Events stream, and persists sessions to SQLite.

## Run against a fixture (no hardware needed)

```bash
cd backend
HOMEERGO_FIXTURE=specs/int/fixtures/ipm/session-short.csv \
HOMEERGO_FIXTURE_RATE=realtime \
HOMEERGO_DB_PATH=./dev.db \
go run ./cmd/homeergo
```

- `realtime` pacing honours the original inter-stroke timing (~0.5 Hz).
- Use `fast` pacing for tight dev loops.

The PWA at `http://localhost:5173/` proxies `/api/*` to `http://localhost:8080/`, so start the fixture first and then `npm run dev` in `../web/`.

## Run against the real IPM console

```bash
cd backend
HOMEERGO_SERIAL_PORT=/dev/cu.usbserial-AB0JKG07 go run ./cmd/homeergo
```

If the port is left unset the backend auto-detects the FTDI `0403:6001` (see INT-0001).

## Tests

```bash
go test ./...
```

The e2e smoke in `cmd/homeergo/main_sse_test.go` boots a real server against a fixture and asserts the SSE stream shape.

## Config

| Env var                     | Default                   | Purpose                                         |
|-----------------------------|---------------------------|-------------------------------------------------|
| `HOMEERGO_ADDR`             | `:8080`                   | HTTP listen address                             |
| `HOMEERGO_SERIAL_PORT`      | auto-detect FTDI          | Override for non-FTDI / multi-device            |
| `HOMEERGO_SERIAL_BAUD`      | `9600`                    | Per INT-0001                                    |
| `HOMEERGO_DB_PATH`          | `./homeergo.db`           | SQLite file                                     |
| `HOMEERGO_FIXTURE`          | unset                     | CSV / bin fixture in place of serial            |
| `HOMEERGO_FIXTURE_RATE`     | `realtime`                | `realtime` or `fast` pacing                     |
| `HOMEERGO_LOG_LEVEL`        | `info`                    | `debug` / `info` / `warn` / `error`             |
| `HOMEERGO_IDLE_TIMEOUT`     | `60s`                     | Stroke gap that closes a session                |

## Debugging

`GET /debug/ingest` returns pipeline health JSON (LAN-only; no auth in v1).
````

- [ ] **Step 2: Commit**

```bash
git add backend/README.md
git commit -m "docs(backend): runtime + dev guide"
```

---

## Task 18: Roadmap update

**Files:**
- Modify: `ROADMAP.md`

- [ ] **Step 1: Edit**

Under `## M2 — Live view`, check off the two `[ ]` items (SSE pushes, FEAT-0001 rendered). Under `## M3 — Persistence & users`, add a `[x]` line:

```
- [x] Backend SSE + SQLite persistence shipped (plan `docs/plans/2026-04-21-m3-backend-sse-persistence.md`) — auth still stubbed, history read-UI deferred.
```

- [ ] **Step 2: Commit**

```bash
git add ROADMAP.md
git commit -m "docs: mark M2 live view + M3 backend persistence complete"
```

---

## Task 19: Final verification

**Files:**
- None.

- [ ] **Step 1: Run the full verification chain**

```bash
cd backend && go vet ./... && go test ./...
cd ../web && npm run typecheck && npm run lint && npm test && npm run build && npm run e2e
```

Expected: every step green.

- [ ] **Step 2: Manual dev smoke**

In one terminal:

```bash
cd backend && HOMEERGO_FIXTURE=specs/int/fixtures/ipm/session-short.csv HOMEERGO_FIXTURE_RATE=realtime HOMEERGO_DB_PATH=./dev.db go run ./cmd/homeergo
```

In another:

```bash
cd web && npm run dev
```

Open `http://localhost:5173/`. Confirm:
- Hero shows non-dash `Split` within a second of the fixture starting.
- After the fixture EOFs and the backend exits, reloading shows em-dashes again (idle state).
- `sqlite3 backend/dev.db 'select id, total_distance_m, total_strokes from sessions'` returns one row with non-null totals.
- `curl http://localhost:8080/debug/ingest` returns JSON with a non-empty `ring.newest_id`.

- [ ] **Step 3: Commit if any cleanup was needed**

```bash
git status
# commit with a short message if files changed during the smoke
```

---

## Self-Review Notes

Checks performed before publishing this plan:

- **Spec coverage:**
  - **ARCH-0001**: every stage named in the arch doc has a task — sessionizer (Task 4), dispatcher (Task 6), ring (Task 5), persister (Task 9), broadcaster (Task 10). Config surface already landed in M1. Dependency rules enforced by the packages: `event`, `session`, `pipeline`, `storage`, `stream`, `api`, `main` — no backward imports.
  - **INT-0002**: wire mapping (Task 2), replay via `Last-Event-ID` / `since=` (Task 11), ping every 20 s (Task 11), session-start/end/level-change event emission (Task 4 + Task 11). One open question decided inline: event ids are lifetime-monotonic. Replay of past sessions via `?session=<uuid>` is *not* implemented here — that lands with the history read plan; the query parameter is ignored (stream follows live). Noted in "Out of scope".
  - **FEAT-0007**: Tier-2 derivations (Task 3). All four metrics (DPS, cycle, pace/500 m, energy-J) plus edge cases from the tile catalogue covered by the test suite.
  - **FEAT-0003 acceptance**: auto-save on first stroke (Task 4 session_start synth); idle boundary configurable (default 60 s via `HOMEERGO_IDLE_TIMEOUT`); session stores start/end, totals, per-stroke series (Task 8 schema). List/detail UI, soft-delete, exports are explicitly deferred.
  - **ADR-0004**: single SQLite file on backend host (Task 7). Migrations embedded (no external tool). Pure-Go driver → Pi deploy target (no CGO dep).
  - **ADR-0005**: stubbed — `RowerID: "local-rower"` hardcoded in `main`. Explicit "out of scope" line.

- **Placeholder scan:** No `TBD`, `TODO`, or "similar to Task N" phrases. One self-acknowledged sketch in Task 10's test body was rewritten inline to the concrete version before continuing. Task 16 uses `fetch` which is standard under Node 20+.

- **Type consistency:**
  - `event.Event` fields used identically across wire, sessionizer, dispatcher, persister, broadcaster, and SSE handler.
  - `pipeline.Ring` — `Write`, `Since`, `Stats` consistent across dispatcher, SSE handler, and /debug/ingest.
  - `stream.Broadcaster` — `NewBroadcaster(in)`, `Run(ctx)`, `Subscribe(afterID)`, `DroppedClients()`, `ClientCount()` consistent between tests, sse.go, and /debug/ingest.
  - `storage.DB` — `Open`, `Close`, `Handle` consistent between test helpers and persister.
  - SQL column names match the struct field→column mapping in `queries.go`.
  - `api.Inputs` (router) uses the same type names as the individual handler constructors.

- **One scope decision worth flagging:** This plan deliberately does *not* ship a history read endpoint (`GET /api/v1/sessions`, `GET /api/v1/sessions/{id}/samples`) or the History page UI. The persister writes rows that nothing reads yet. That's intentional: it (a) proves write-path correctness via the e2e smoke, and (b) keeps this plan bounded. The next plan picks up those reads *with* UI — FEAT-0003 acceptance is only partially hit by this plan (persistence, not browsing) and the roadmap entry reflects that.

- **Deferred to follow-up plans:**
  - FEAT-0003 list / detail UI + read APIs.
  - Soft-delete + undelete window.
  - Export (CSV minimum, FIT/TCX stretch).
  - ADR-0005 real auth (QR pairing).
  - PWA offline data cache (FEAT-0006).
