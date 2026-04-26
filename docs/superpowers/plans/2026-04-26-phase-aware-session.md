# Phase-Aware Session Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make warmup/rest/cooldown strokes invisible to PB candidates and summary totals, hard-reset live display at warmup→work, end the session authoritatively from the backend when cooldown elapses.

**Architecture:** A new Go `phaseplan` package classifies each stroke into `warmup|work|rest|cooldown` against the workout's expanded segments. The sessionizer tags every stroke + persists the phase, emits `phase_change` SSE on boundaries, and adds a `WorkoutComplete` end-trigger. Compaction filters to work-phase strokes before computing samples, summary totals, and per-work-segment PB candidates. Frontend subtracts the work-segment baseline so the hero counter resets at warmup→work, and consumes `phase_change` from SSE for the authoritative reset moment.

**Tech Stack:** Go 1.x, SQLite, React + TypeScript + Vite, Vitest, Go test (testing + table tests), SSE.

Spec: `docs/superpowers/specs/2026-04-26-phase-aware-session-design.md`.

---

## File Structure

**Backend (new):**
- `backend/internal/session/phaseplan.go` — pure phase-plan builder + classifier
- `backend/internal/session/phaseplan_test.go`
- `backend/internal/storage/migrations/0006_stroke_phase.sql`

**Backend (modified):**
- `backend/internal/event/event.go` — `KindPhaseChange`, `PhaseChangePayload`, `Phase` field on `StrokePayload`, `WarmupSec`/`RestSec`/`CooldownSec` on `SessionSummary`
- `backend/internal/session/sessionizer.go` — load workout on session-open, classify per stroke, emit phase_change, add `WorkoutComplete` end trigger
- `backend/internal/session/sessionizer_test.go`
- `backend/internal/storage/queries.go` — `phase` column wiring
- `backend/internal/storage/persister.go` — filter work strokes
- `backend/internal/stats/candidates.go` — per-work-segment runs

**Frontend (new):**
- `web/src/live/usePhaseBaseline.ts`
- `web/src/live/usePhaseBaseline.test.tsx`

**Frontend (modified):**
- `web/src/live/segments.ts` — fix cooldown-after-distance bug
- `web/src/live/LiveSessionContext.tsx` (or the SSE reducer) — handle `phase_change` event
- `web/src/pages/LiveHero.tsx` — consume baseline
- `web/src/pages/TileGrid.tsx` — consume baseline
- `web/src/live/useSegmentTransitions.ts` — also subscribe to phase_change

**Frontend (deleted):**
- `web/src/live/useAutoEndOnComplete.ts`
- `web/src/pages/LivePage.tsx` — remove import + hook call

---

## Task 1: Frontend — fix cooldown-after-distance bug in segments.ts

**Files:**
- Modify: `web/src/live/segments.ts:99-166`
- Test: `web/src/live/segments.test.ts`

- [ ] **Step 1: Add failing test for cooldown after distance segment**

Append to `web/src/live/segments.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { expandWorkout, locateSegment } from './segments'
import type { Workout } from '../api/workouts'

describe('locateSegment cooldown after distance work', () => {
  const w: Workout = {
    id: 'w1',
    mode: 'distance',
    params: { meters: 2000 },
    warmup_sec: 60,
    cooldown_sec: 120,
    intensity: undefined,
  } as unknown as Workout

  const segs = expandWorkout(w)

  it('returns full cooldown remaining at the moment work distance is reached', () => {
    const active = locateSegment(segs, 2000, 600)
    expect(active?.segment.kind).toBe('cooldown')
    expect(active?.remainingSec).toBe(120)
  })

  it('decrements cooldown remaining as time advances after work completion', () => {
    const active = locateSegment(segs, 2000, 660) // 60s after work done
    expect(active?.segment.kind).toBe('cooldown')
    expect(active?.remainingSec).toBe(60)
  })

  it('returns null after cooldown elapsed', () => {
    const active = locateSegment(segs, 2000, 721) // 121s after work done
    expect(active).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run src/live/segments.test.ts`
Expected: FAIL — `remainingSec` is 120 always; null transition never happens.

- [ ] **Step 3: Replace `afterDistance` branch in `locateSegment` with timeSec-anchored cooldown**

Replace `web/src/live/segments.ts:99-166` with:

```typescript
export function locateSegment(
  segments: Segment[],
  distanceM: number,
  timeSec: number,
): ActiveSegment | null {
  if (segments.length === 0) return null
  let timeAnchor = 0
  // workCompletedAt: timeSec at which the most recently completed
  // distance segment's target distance was crossed. Tracked so that
  // a following time-based segment (rest or cooldown) can anchor its
  // countdown to that moment instead of session start.
  let workCompletedAt: number | null = null

  for (let idx = 0; idx < segments.length; idx++) {
    const seg = segments[idx]
    if (seg.durationSec != null) {
      if (workCompletedAt != null) {
        const consumed = Math.max(0, timeSec - workCompletedAt)
        if (consumed < seg.durationSec) {
          return {
            segment: seg,
            remainingSec: Math.max(0, seg.durationSec - consumed),
            progressRatio: consumed / seg.durationSec,
            totalSegments: segments.length,
            activeIndexOneBased: seg.index + 1,
          }
        }
        workCompletedAt += seg.durationSec
        timeAnchor = workCompletedAt
      } else {
        const consumed = Math.max(0, timeSec - timeAnchor)
        if (consumed < seg.durationSec) {
          return {
            segment: seg,
            remainingSec: Math.max(0, seg.durationSec - consumed),
            progressRatio: consumed / seg.durationSec,
            totalSegments: segments.length,
            activeIndexOneBased: seg.index + 1,
          }
        }
        timeAnchor += seg.durationSec
      }
    } else if (seg.distanceM != null) {
      const consumed = Math.max(0, distanceM - seg.startDistanceM)
      if (consumed < seg.distanceM) {
        return {
          segment: seg,
          remainingM: Math.max(0, seg.distanceM - consumed),
          progressRatio: consumed / seg.distanceM,
          totalSegments: segments.length,
          activeIndexOneBased: seg.index + 1,
        }
      }
      // The moment this segment's target was crossed is approximated
      // by the current timeSec when the user is past the boundary.
      // For an accurate anchor, callers must invoke locateSegment with
      // the timeSec of the stroke that crossed the line. The sessionizer
      // does this; the frontend follows the SSE stroke stream which is
      // the same stroke timeline.
      workCompletedAt = timeSec
    }
  }
  return null
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npx vitest run src/live/segments.test.ts`
Expected: PASS for the three new cases plus all existing cases.

- [ ] **Step 5: Commit**

```bash
git add web/src/live/segments.ts web/src/live/segments.test.ts
git commit -m "fix(web): cooldown timer anchors to work-completion timeSec"
```

---

## Task 2: Backend — phaseplan package

**Files:**
- Create: `backend/internal/session/phaseplan.go`
- Test: `backend/internal/session/phaseplan_test.go`

- [ ] **Step 1: Create failing test file**

Create `backend/internal/session/phaseplan_test.go`:

```go
package session

import (
	"testing"

	"github.com/gloeckner-daniel/home-ergo/internal/workout"
)

func TestPhasePlanDistanceWithWarmupCooldown(t *testing.T) {
	w := &workout.Workout{
		ID:          "w1",
		Mode:        "distance",
		Params:      []byte(`{"meters":2000}`),
		WarmupSec:   60,
		CooldownSec: 120,
	}
	plan, err := BuildPhasePlan(w)
	if err != nil {
		t.Fatalf("build: %v", err)
	}
	cases := []struct {
		name     string
		dist     int
		time     float64
		want     Phase
		complete bool
	}{
		{"warmup mid", 0, 30, PhaseWarmup, false},
		{"work start", 5, 61, PhaseWork, false},
		{"work mid", 1000, 300, PhaseWork, false},
		{"cooldown start", 2000, 600, PhaseCooldown, false},
		{"cooldown mid", 2000, 660, PhaseCooldown, false},
		{"cooldown done", 2000, 721, PhaseDone, true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, complete := plan.Classify(tc.dist, tc.time)
			if got != tc.want {
				t.Fatalf("phase: got %v want %v", got, tc.want)
			}
			if complete != tc.complete {
				t.Fatalf("complete: got %v want %v", complete, tc.complete)
			}
		})
	}
}

func TestPhasePlanIntervalsRestExcluded(t *testing.T) {
	w := &workout.Workout{
		ID:          "w2",
		Mode:        "intervals",
		Params:      []byte(`{"reps":2,"length":{"unit":"m","value":500},"rest_sec":30}`),
		WarmupSec:   0,
		CooldownSec: 0,
	}
	plan, err := BuildPhasePlan(w)
	if err != nil {
		t.Fatalf("build: %v", err)
	}
	// rep 1 mid
	if p, _ := plan.Classify(250, 60); p != PhaseWork {
		t.Fatalf("rep1: got %v", p)
	}
	// hit 500 → rest segment begins; remain at 500m for the 30s rest
	if p, _ := plan.Classify(500, 121); p != PhaseRest {
		t.Fatalf("rest: got %v", p)
	}
	// rep 2 mid (distance advanced past rest's start anchor)
	if p, _ := plan.Classify(750, 200); p != PhaseWork {
		t.Fatalf("rep2: got %v", p)
	}
	// cooldown=0 means after both reps done the workout is complete
	if p, complete := plan.Classify(1000, 260); p != PhaseDone || !complete {
		t.Fatalf("done: got %v complete=%v", p, complete)
	}
}

func TestPhasePlanFreeRow(t *testing.T) {
	plan := FreeRowPhasePlan()
	if p, _ := plan.Classify(0, 0); p != PhaseWork {
		t.Fatalf("free row should be all work")
	}
	if p, complete := plan.Classify(99999, 99999); p != PhaseWork || complete {
		t.Fatalf("free row never completes")
	}
}
```

- [ ] **Step 2: Run test, expect compile failure**

Run: `cd backend && go test ./internal/session/ -run TestPhasePlan -v`
Expected: build fails — `BuildPhasePlan`, `Phase`, `PhaseWarmup`, etc. undefined.

- [ ] **Step 3: Create `phaseplan.go`**

Create `backend/internal/session/phaseplan.go`:

```go
package session

import (
	"encoding/json"
	"fmt"

	"github.com/gloeckner-daniel/home-ergo/internal/workout"
)

// Phase classifies a stroke against the workout's segment plan.
type Phase uint8

const (
	PhaseWork Phase = iota + 1
	PhaseWarmup
	PhaseRest
	PhaseCooldown
	PhaseDone
)

func (p Phase) String() string {
	switch p {
	case PhaseWork:
		return "work"
	case PhaseWarmup:
		return "warmup"
	case PhaseRest:
		return "rest"
	case PhaseCooldown:
		return "cooldown"
	case PhaseDone:
		return "done"
	}
	return "unknown"
}

// segment is the internal expanded form. Mirrors web/src/live/segments.ts
// but only carries what the classifier needs.
type segment struct {
	kind          Phase
	durationSec   float64 // 0 if not time-based
	distanceM     int     // 0 if not distance-based
	startTimeSec  float64
	startDistance int
	endTimeSec    float64
	endDistance   int
}

// PhasePlan classifies a (distance, time) point into a phase. Stateless
// across calls; the sessionizer tracks "work completed at" itself when it
// matters for cooldown anchoring (see Classify).
type PhasePlan struct {
	segs   []segment
	hasAny bool // false for FreeRow
}

// FreeRowPhasePlan is the no-workout plan: every stroke is work, never
// completes.
func FreeRowPhasePlan() *PhasePlan {
	return &PhasePlan{hasAny: false}
}

// BuildPhasePlan expands a workout into segments.
func BuildPhasePlan(w *workout.Workout) (*PhasePlan, error) {
	if w == nil {
		return FreeRowPhasePlan(), nil
	}
	p := &PhasePlan{hasAny: true}
	if w.WarmupSec > 0 {
		p.segs = append(p.segs, segment{kind: PhaseWarmup, durationSec: float64(w.WarmupSec)})
	}
	switch w.Mode {
	case "distance":
		var params struct {
			Meters int `json:"meters"`
		}
		if err := json.Unmarshal(w.Params, &params); err != nil {
			return nil, fmt.Errorf("parse distance params: %w", err)
		}
		p.segs = append(p.segs, segment{kind: PhaseWork, distanceM: params.Meters})
	case "time":
		var params struct {
			Seconds int `json:"seconds"`
		}
		if err := json.Unmarshal(w.Params, &params); err != nil {
			return nil, fmt.Errorf("parse time params: %w", err)
		}
		p.segs = append(p.segs, segment{kind: PhaseWork, durationSec: float64(params.Seconds)})
	case "intervals":
		var params struct {
			Reps   int `json:"reps"`
			Length struct {
				Unit  string  `json:"unit"`
				Value float64 `json:"value"`
			} `json:"length"`
			RestSec int `json:"rest_sec"`
		}
		if err := json.Unmarshal(w.Params, &params); err != nil {
			return nil, fmt.Errorf("parse intervals params: %w", err)
		}
		for i := 0; i < params.Reps; i++ {
			s := segment{kind: PhaseWork}
			if params.Length.Unit == "m" {
				s.distanceM = int(params.Length.Value)
			} else {
				s.durationSec = params.Length.Value * 60
			}
			p.segs = append(p.segs, s)
			if i < params.Reps-1 {
				p.segs = append(p.segs, segment{kind: PhaseRest, durationSec: float64(params.RestSec)})
			}
		}
	default:
		return nil, fmt.Errorf("unknown workout mode: %s", w.Mode)
	}
	if w.CooldownSec > 0 {
		p.segs = append(p.segs, segment{kind: PhaseCooldown, durationSec: float64(w.CooldownSec)})
	}
	// cumulative offsets
	var cumT float64
	var cumD int
	for i := range p.segs {
		s := &p.segs[i]
		s.startTimeSec = cumT
		s.startDistance = cumD
		cumT += s.durationSec
		cumD += s.distanceM
		s.endTimeSec = cumT
		s.endDistance = cumD
	}
	return p, nil
}

// Classify returns the phase for the given absolute (distanceM, timeSec).
// The second return is true when the entire workout is complete (cooldown
// elapsed, or last work segment done if no cooldown).
//
// Algorithm matches the frontend locateSegment: time-based segments
// following a distance segment anchor their countdown to the timeSec at
// which the distance target was crossed. Since Classify is stateless,
// the sessionizer must call it with strokes in order — when classifying
// a stroke whose distance has just crossed a work segment's target, that
// stroke's timeSec is taken as the anchor for any following time-based
// segment.
func (p *PhasePlan) Classify(distanceM int, timeSec float64) (Phase, bool) {
	if !p.hasAny {
		return PhaseWork, false
	}
	var timeAnchor float64
	workCompletedAt := -1.0 // <0 = no distance segment crossed yet
	for _, s := range p.segs {
		if s.durationSec > 0 {
			if workCompletedAt >= 0 {
				consumed := timeSec - workCompletedAt
				if consumed < s.durationSec {
					return s.kind, false
				}
				workCompletedAt += s.durationSec
				timeAnchor = workCompletedAt
			} else {
				consumed := timeSec - timeAnchor
				if consumed < s.durationSec {
					return s.kind, false
				}
				timeAnchor += s.durationSec
			}
		} else if s.distanceM > 0 {
			consumed := distanceM - s.startDistance
			if consumed < s.distanceM {
				return s.kind, false
			}
			workCompletedAt = timeSec
		}
	}
	return PhaseDone, true
}
```

- [ ] **Step 4: Run tests, expect pass**

Run: `cd backend && go test ./internal/session/ -run TestPhasePlan -v`
Expected: all four sub-tests pass.

- [ ] **Step 5: Commit**

```bash
git add backend/internal/session/phaseplan.go backend/internal/session/phaseplan_test.go
git commit -m "feat(session): add phaseplan classifier"
```

---

## Task 3: Backend — extend event types with phase

**Files:**
- Modify: `backend/internal/event/event.go`

- [ ] **Step 1: Add Phase field, PhaseChangePayload, KindPhaseChange, summary side-counters**

Edit `backend/internal/event/event.go`:

Add to the `Kind` const block (after `KindWorkoutAttached`):

```go
	KindPhaseChange
```

Add `Phase` to `StrokePayload` (after `Level`):

```go
	Phase string // "work" | "warmup" | "rest" | "cooldown"
```

Add to `Event` struct (after `WorkoutAttached`):

```go
	PhaseChange *PhaseChangePayload
```

Add new type at end of file:

```go
type PhaseChangePayload struct {
	From         string  `json:"from"`
	To           string  `json:"to"`
	AtStroke     int     `json:"at_stroke"`
	AtTimeSec    float64 `json:"at_time_sec"`
	AtDistanceM  int     `json:"at_distance_m"`
}
```

Add to `SessionSummary` (before `Samples`):

```go
	WarmupSec   float64 `json:"warmup_sec,omitempty"`
	RestSec     float64 `json:"rest_sec,omitempty"`
	CooldownSec float64 `json:"cooldown_sec,omitempty"`
```

- [ ] **Step 2: Verify it builds**

Run: `cd backend && go build ./...`
Expected: builds clean.

- [ ] **Step 3: Commit**

```bash
git add backend/internal/event/event.go
git commit -m "feat(event): add phase field, phase_change kind, summary side counters"
```

---

## Task 4: Backend — migration 0006 for stroke phase column

**Files:**
- Create: `backend/internal/storage/migrations/0006_stroke_phase.sql`

- [ ] **Step 1: Write migration SQL**

Create `backend/internal/storage/migrations/0006_stroke_phase.sql`:

```sql
-- Phase per stroke. 'work' is the default so existing free-row sessions
-- and any pre-rollout strokes (DB is reset for this rollout, so this is
-- defensive only) behave as before — every stroke counts.
ALTER TABLE strokes ADD COLUMN phase TEXT NOT NULL DEFAULT 'work';
```

- [ ] **Step 2: Verify migration loads**

Run: `cd backend && go test ./internal/storage/...`
Expected: existing tests pass; the migration runner picks up the new file.

- [ ] **Step 3: Commit**

```bash
git add backend/internal/storage/migrations/0006_stroke_phase.sql
git commit -m "feat(storage): migration 0006 — strokes.phase column"
```

---

## Task 5: Backend — persist phase column

**Files:**
- Modify: `backend/internal/storage/queries.go`
- Test: `backend/internal/storage/queries_test.go` (extend existing tests)

- [ ] **Step 1: Update InsertStroke + LoadSessionStrokes**

Replace `InsertStroke` body and `LoadSessionStrokes` SELECT in `backend/internal/storage/queries.go`:

```go
func InsertStroke(ctx context.Context, db *sql.DB, globalID uint64, sessionID string, at time.Time, p event.StrokePayload) error {
	phase := p.Phase
	if phase == "" {
		phase = "work"
	}
	_, err := db.ExecContext(ctx,
		`INSERT INTO strokes(
			global_id, session_id, stroke_no, time_sec, distance_m, spm, power_w, cal_per_hr, level,
			dps, stroke_cycle_sec, pace_sec_per_500m, energy_joules, at, phase
		) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		globalID, sessionID, p.StrokeNo, p.TimeSec, p.DistanceM, p.SPM, p.PowerW, p.CalPerHr, p.Level,
		p.DPS, p.StrokeCycleSec, p.PaceSecPer500m, p.EnergyJoules,
		at.UTC().Format(time.RFC3339Nano), phase)
	return err
}
```

Replace `LoadSessionStrokes`:

```go
func LoadSessionStrokes(ctx context.Context, db dbExec, sessionID string) ([]event.StrokePayload, error) {
	rows, err := db.QueryContext(ctx, `
		SELECT stroke_no, time_sec, distance_m, spm, power_w, cal_per_hr, level,
		       dps, stroke_cycle_sec, pace_sec_per_500m, energy_joules, phase
		FROM strokes WHERE session_id = ? ORDER BY stroke_no`, sessionID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []event.StrokePayload
	for rows.Next() {
		var p event.StrokePayload
		if err := rows.Scan(&p.StrokeNo, &p.TimeSec, &p.DistanceM, &p.SPM, &p.PowerW,
			&p.CalPerHr, &p.Level, &p.DPS, &p.StrokeCycleSec, &p.PaceSecPer500m,
			&p.EnergyJoules, &p.Phase); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}
```

- [ ] **Step 2: Add round-trip test**

Append to `backend/internal/storage/queries_test.go` (or create if missing — match existing test style):

```go
func TestStrokePhaseRoundTrip(t *testing.T) {
	db := newTestDB(t) // assume helper from existing tests
	ctx := context.Background()
	if err := InsertSession(ctx, db, "s1", "r1", time.Now(), 5, ""); err != nil {
		t.Fatal(err)
	}
	p := event.StrokePayload{StrokeNo: 1, TimeSec: 1.0, DistanceM: 5, Phase: "warmup"}
	if err := InsertStroke(ctx, db, 1, "s1", time.Now(), p); err != nil {
		t.Fatal(err)
	}
	got, err := LoadSessionStrokes(ctx, db, "s1")
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 1 || got[0].Phase != "warmup" {
		t.Fatalf("phase round-trip: %+v", got)
	}
}
```

- [ ] **Step 3: Run, expect pass**

Run: `cd backend && go test ./internal/storage/ -run TestStrokePhaseRoundTrip -v`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add backend/internal/storage/queries.go backend/internal/storage/queries_test.go
git commit -m "feat(storage): persist stroke phase column"
```

---

## Task 6: Backend — sessionizer phase classification + phase_change emission

**Files:**
- Modify: `backend/internal/session/sessionizer.go`
- Test: `backend/internal/session/sessionizer_test.go` (extend)

- [ ] **Step 1: Wire workout loader into sessionizer Options**

Edit `backend/internal/session/sessionizer.go` `Options`:

```go
type Options struct {
	IdleTimeout       time.Duration
	InactivityTimeout time.Duration
	ResolveRower      func() (id, name string)
	RowerID           string
	RowerName         string
	Now               func() time.Time
	StartID           uint64
	// LoadWorkout returns the workout for the given id. nil id or nil
	// return → free-row plan. Required for phase classification; if
	// unset, the sessionizer falls back to FreeRowPhasePlan for every
	// session (behavior identical to pre-phase code).
	LoadWorkout func(id string) (*workout.Workout, error)
}
```

Add import: `"github.com/gloeckner-daniel/home-ergo/internal/workout"`.

- [ ] **Step 2: Add phaseplan + currentPhase to sessionState**

Edit `sessionState`:

```go
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
	lastActivity  time.Time
	lastLevel     int
	plan          *PhasePlan
	currentPhase  Phase
	// Side counters: total wall-time-equivalent in non-work phases.
	warmupSec   float64
	restSec     float64
	cooldownSec float64
	// phaseLastTime is the timeSec at which the current phase was
	// entered. Used to accumulate per-phase elapsed at boundary moments.
	phaseLastTime float64
}
```

- [ ] **Step 3: Open-session path loads workout + builds plan**

Find `openSessionPending` in `sessionizer.go` and add plan construction. Approximate location: where `s.session = &sessionState{...}` is initialized after a `session_start` event is emitted. Add immediately after the new `s.session` is assigned:

```go
	plan := FreeRowPhasePlan()
	if s.opts.LoadWorkout != nil && pendingWorkoutID != "" {
		w, err := s.opts.LoadWorkout(pendingWorkoutID)
		if err == nil && w != nil {
			if pp, perr := BuildPhasePlan(w); perr == nil {
				plan = pp
			}
		}
	}
	s.session.plan = plan
	s.session.currentPhase = PhaseWork // before any stroke arrives
```

(If the actual variable holding the workout id at that point is named differently, substitute. Look in the existing function for the symbol that becomes `SessionStartPayload.WorkoutID`.)

- [ ] **Step 4: Classify in onFrame and emit phase_change at boundaries**

In `onFrame` (`sessionizer.go:199-280`), after `stroke := s.enrich(f)` and before the existing `s.emit(... KindStroke ...)`, add:

```go
	phase, complete := s.session.plan.Classify(stroke.DistanceM, stroke.TimeSec)
	stroke.Phase = phase.String()
	if phase != s.session.currentPhase {
		// Accumulate the just-ended phase's duration.
		dt := stroke.TimeSec - s.session.phaseLastTime
		switch s.session.currentPhase {
		case PhaseWarmup:
			s.session.warmupSec += dt
		case PhaseRest:
			s.session.restSec += dt
		case PhaseCooldown:
			s.session.cooldownSec += dt
		}
		// Emit boundary event before the stroke event so the frontend
		// resets baseline before consuming the first work-phase stroke.
		if err := s.emit(ctx, out, event.Event{
			Kind:      event.KindPhaseChange,
			SessionID: s.session.id,
			PhaseChange: &event.PhaseChangePayload{
				From:        s.session.currentPhase.String(),
				To:          phase.String(),
				AtStroke:    stroke.StrokeNo,
				AtTimeSec:   stroke.TimeSec,
				AtDistanceM: stroke.DistanceM,
			},
		}); err != nil {
			return err
		}
		s.session.currentPhase = phase
		s.session.phaseLastTime = stroke.TimeSec
	}
```

(Remove `complete` shadow — it'll be used in Task 7.)

- [ ] **Step 5: Add sessionizer test for phase tagging**

Append to `backend/internal/session/sessionizer_test.go`:

```go
func TestSessionizerTagsStrokesWithPhase(t *testing.T) {
	w := &workout.Workout{
		ID: "w1", Mode: "distance", Params: []byte(`{"meters":100}`),
		WarmupSec: 30, CooldownSec: 60,
	}
	s := New(Options{
		IdleTimeout: time.Hour,
		Now:         func() time.Time { return time.Unix(0, 0) },
		LoadWorkout: func(id string) (*workout.Workout, error) { return w, nil },
	})
	s.SetPendingWorkout(w.ID) // assume a setter exists or use s.pendingWorkoutID directly via test helper
	// Drive frames through Run via a goroutine + channels — pattern
	// exists in other sessionizer_test.go cases. Reuse that harness.
	in := make(chan ipm.Frame, 8)
	out := make(chan event.Event, 16)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go s.Run(ctx, in, out)
	s.StartSession(w.ID)
	// warmup stroke
	in <- ipm.Frame{TimeSec: 5, DistanceM: 0, SPM: 20, PowerW: 100}
	// work stroke
	in <- ipm.Frame{TimeSec: 35, DistanceM: 5, SPM: 22, PowerW: 150}
	// cooldown stroke (dist target 100m at t=70)
	in <- ipm.Frame{TimeSec: 75, DistanceM: 100, SPM: 15, PowerW: 80}
	close(in)

	var phases []string
	for e := range out {
		if e.Kind == event.KindStroke {
			phases = append(phases, e.Stroke.Phase)
		}
	}
	want := []string{"warmup", "work", "cooldown"}
	for i, p := range want {
		if i >= len(phases) || phases[i] != p {
			t.Fatalf("phase[%d]: got %v want %v", i, phases, want)
		}
	}
}
```

If `SetPendingWorkout` doesn't exist, use the existing test helper pattern in this file (look for how other tests prime `pendingWorkoutID`).

- [ ] **Step 6: Run and pass**

Run: `cd backend && go test ./internal/session/ -run TestSessionizerTagsStrokes -v`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add backend/internal/session/sessionizer.go backend/internal/session/sessionizer_test.go
git commit -m "feat(session): classify strokes and emit phase_change"
```

---

## Task 7: Backend — WorkoutComplete end trigger

**Files:**
- Modify: `backend/internal/session/sessionizer.go`
- Test: `backend/internal/session/sessionizer_test.go`

- [ ] **Step 1: End session on completion**

In `onFrame`, immediately after the phase-classification block from Task 6 (after `s.session.phaseLastTime = stroke.TimeSec`), add:

```go
	if complete {
		// Emit the stroke first so the final work/cooldown sample is
		// included in the persister's stroke load.
		if err := s.emit(ctx, out, event.Event{
			Kind:      event.KindStroke,
			SessionID: s.session.id,
			Stroke:    &stroke,
		}); err != nil {
			return err
		}
		s.accumulate(&stroke)
		s.session.lastSeen = s.opts.Now()
		s.session.lastActivity = s.opts.Now()
		return s.closeSession(ctx, out)
	}
```

Then guard the **existing** stroke `s.emit(...)` and `s.accumulate(...)` so they don't run again — wrap remainder of `onFrame` after that early return condition. (The stroke emission and accumulate that already exist further down become unreachable for the completion-frame; that's correct.)

- [ ] **Step 2: Test end-on-completion**

Append to `backend/internal/session/sessionizer_test.go`:

```go
func TestSessionizerEndsOnWorkoutComplete(t *testing.T) {
	w := &workout.Workout{
		ID: "w1", Mode: "distance", Params: []byte(`{"meters":100}`),
		WarmupSec: 0, CooldownSec: 30,
	}
	s := New(Options{
		IdleTimeout: time.Hour,
		Now:         func() time.Time { return time.Unix(0, 0) },
		LoadWorkout: func(id string) (*workout.Workout, error) { return w, nil },
	})
	in := make(chan ipm.Frame, 8)
	out := make(chan event.Event, 16)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go s.Run(ctx, in, out)
	s.StartSession(w.ID)
	in <- ipm.Frame{TimeSec: 10, DistanceM: 100} // distance reached
	in <- ipm.Frame{TimeSec: 41, DistanceM: 100} // cooldown elapsed (>30s after dist hit)
	close(in)

	var sawEnd bool
	for e := range out {
		if e.Kind == event.KindSessionEnd {
			sawEnd = true
		}
	}
	if !sawEnd {
		t.Fatal("expected session_end after cooldown elapsed")
	}
}
```

- [ ] **Step 3: Run, pass**

Run: `cd backend && go test ./internal/session/ -run TestSessionizerEndsOnWorkoutComplete -v`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add backend/internal/session/sessionizer.go backend/internal/session/sessionizer_test.go
git commit -m "feat(session): end session when workout cooldown elapses"
```

---

## Task 8: Backend — sessionizer summary uses work-only running totals

**Files:**
- Modify: `backend/internal/session/sessionizer.go`

- [ ] **Step 1: Switch accumulator to skip non-work strokes**

In `onFrame`, change the `s.accumulate(&stroke)` call to be conditional:

```go
	if phase == PhaseWork {
		s.accumulate(&stroke)
	}
```

This affects every place `accumulate` was called (the regular flow plus the new completion early-return). Apply consistently.

- [ ] **Step 2: Populate side-counters in closeSession**

Find `closeSession` (`sessionizer.go:~430`). After the existing `summary := event.SessionSummary{...}` literal (or wherever the summary is populated), add:

```go
	// Trailing accumulation: if the session closes mid-non-work-phase
	// (e.g. mid-cooldown timeout), credit the elapsed slice to that
	// phase's counter using the lastSeen-based approximation.
	if s.session.lastStroke != nil {
		dt := s.session.lastStroke.TimeSec - s.session.phaseLastTime
		switch s.session.currentPhase {
		case PhaseWarmup:
			s.session.warmupSec += dt
		case PhaseRest:
			s.session.restSec += dt
		case PhaseCooldown:
			s.session.cooldownSec += dt
		}
	}
	summary.WarmupSec = s.session.warmupSec
	summary.RestSec = s.session.restSec
	summary.CooldownSec = s.session.cooldownSec
```

- [ ] **Step 3: Update existing summary test expectations**

Run: `cd backend && go test ./internal/session/...`
Expected: tests that compute summary from full stroke runs may need updating — change them to either drive only work-phase strokes (free-row plan) or assert the new work-only totals. Free-row sessions still report identical numbers because every stroke is `work`.

- [ ] **Step 4: Commit**

```bash
git add backend/internal/session/sessionizer.go backend/internal/session/sessionizer_test.go
git commit -m "feat(session): summary totals work-only + side counters"
```

---

## Task 9: Backend — persister filters work strokes

**Files:**
- Modify: `backend/internal/storage/persister.go`
- Test: `backend/internal/storage/persister_test.go` (extend)

- [ ] **Step 1: Filter work strokes before sample/candidate computation**

Replace the body of `applySessionEnd` (`backend/internal/storage/persister.go:91`) inner block (after `LoadSessionStrokes`) with:

```go
	strokes, err := LoadSessionStrokes(ctx, tx, e.SessionID)
	if err != nil {
		return err
	}
	workStrokes := filterWorkStrokes(strokes)
	summary := e.SessionEnd.Summary
	summary.Samples = stats.ComputeSamples(workStrokes, stats.DefaultBucketStrokes)
	summary.PBCandidates = stats.ComputeCandidates(workStrokes)
```

Add helper at end of file:

```go
func filterWorkStrokes(in []event.StrokePayload) []event.StrokePayload {
	out := make([]event.StrokePayload, 0, len(in))
	for _, s := range in {
		if s.Phase == "" || s.Phase == "work" {
			out = append(out, s)
		}
	}
	return out
}
```

- [ ] **Step 2: Test filter excludes warmup/rest/cooldown**

Append to `backend/internal/storage/persister_test.go`:

```go
func TestApplySessionEndFiltersNonWorkStrokes(t *testing.T) {
	db := newTestDB(t)
	ctx := context.Background()
	if err := InsertSession(ctx, db, "s1", "r1", time.Unix(0, 0), 5, ""); err != nil {
		t.Fatal(err)
	}
	mk := func(no int, ts float64, dist int, phase string, power int) event.StrokePayload {
		return event.StrokePayload{StrokeNo: no, TimeSec: ts, DistanceM: dist, PowerW: power, Phase: phase}
	}
	rows := []event.StrokePayload{
		mk(1, 1, 0, "warmup", 50),
		mk(2, 2, 5, "work", 200),
		mk(3, 3, 10, "work", 210),
		mk(4, 4, 10, "cooldown", 80),
	}
	for i, r := range rows {
		if err := InsertStroke(ctx, db, uint64(i+1), "s1", time.Unix(0, 0), r); err != nil {
			t.Fatal(err)
		}
	}
	p := &Persister{DB: db}
	end := event.Event{
		Kind: event.KindSessionEnd, SessionID: "s1",
		SessionEnd: &event.SessionEndPayload{EndedAt: time.Unix(10, 0), Summary: event.SessionSummary{
			TotalDistanceM: 10, TotalTimeSec: 4, TotalStrokes: 2,
			AvgPowerW: 205, PeakPowerW: 210,
		}},
	}
	if err := p.apply(ctx, end); err != nil {
		t.Fatal(err)
	}
	var blob string
	if err := db.QueryRow(`SELECT summary_json FROM sessions WHERE id='s1'`).Scan(&blob); err != nil {
		t.Fatal(err)
	}
	var sum event.SessionSummary
	if err := json.Unmarshal([]byte(blob), &sum); err != nil {
		t.Fatal(err)
	}
	// Samples should reflect only the two work strokes.
	if sum.Samples == nil || len(sum.Samples.Watt) == 0 {
		t.Fatalf("expected work-only samples, got %+v", sum.Samples)
	}
	for _, w := range sum.Samples.Watt {
		if w < 200 || w > 210 {
			t.Fatalf("samples include non-work stroke: %v", sum.Samples.Watt)
		}
	}
}
```

- [ ] **Step 3: Run, pass**

Run: `cd backend && go test ./internal/storage/ -run TestApplySessionEndFilters -v`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add backend/internal/storage/persister.go backend/internal/storage/persister_test.go
git commit -m "feat(storage): compaction filters to work-phase strokes"
```

---

## Task 10: Backend — per-work-segment PB candidate runs

**Files:**
- Modify: `backend/internal/stats/candidates.go`
- Test: `backend/internal/stats/candidates_test.go`

- [ ] **Step 1: Failing test for rest gap not bridging PB**

Append to `backend/internal/stats/candidates_test.go`:

```go
func TestComputeCandidatesPerWorkSegmentRuns(t *testing.T) {
	// Two reps of 500m separated by a (filtered-out) rest. After the
	// persister filter, candidates sees a gap in stroke_no but NOT a
	// time discontinuity — the second rep's strokes have timeSec
	// continuing well after the first rep's. The two-pointer must not
	// count the rest gap as part of a 1k window.
	mk := func(no int, t float64, d int, p int) event.StrokePayload {
		return event.StrokePayload{StrokeNo: no, TimeSec: t, DistanceM: d, PowerW: p}
	}
	in := []event.StrokePayload{
		mk(1, 1, 50, 200), mk(2, 2, 100, 200), mk(3, 4, 250, 200),
		mk(4, 5, 500, 200),
		// rep 2 starts after a 60s rest (rest strokes filtered out)
		mk(20, 65, 550, 200), mk(21, 66, 600, 200), mk(22, 68, 750, 200),
		mk(23, 69, 1000, 200),
	}
	c := ComputeCandidates(in)
	for _, d := range c.Distance {
		if d.DistanceM == 1000 {
			// A naive two-pointer would report ~68s for the 1k. The
			// per-run version cannot cover 1k in either single rep
			// (each rep is only 500m), so no 1k candidate exists.
			t.Fatalf("did not expect a 1k candidate spanning rest gap: %+v", d)
		}
	}
}
```

- [ ] **Step 2: Run, expect failure**

Run: `cd backend && go test ./internal/stats/ -run TestComputeCandidatesPerWorkSegmentRuns -v`
Expected: FAIL — current code reports a 1k candidate.

- [ ] **Step 3: Split runs at stroke-no gaps**

Replace `ComputeCandidates` in `backend/internal/stats/candidates.go`:

```go
func ComputeCandidates(strokes []event.StrokePayload) *PBCandidates {
	runs := splitByStrokeNoGap(strokes)
	out := &PBCandidates{}
	for _, run := range runs {
		mergeDistance(&out.Distance, distanceCandidates(run, StandardDistances))
		mergeWindow(&out.Window, windowCandidates(run, WindowDefs))
	}
	if len(strokes) >= MinStrokesForConsistency {
		out.Consistency = consistencyCandidates(strokes)
	}
	return out
}

// splitByStrokeNoGap splits the filtered stroke list into contiguous
// runs whenever stroke_no jumps by more than 1. In the post-filter
// stream this happens only at rest-segment boundaries (the rest strokes
// were dropped, leaving a gap).
func splitByStrokeNoGap(strokes []event.StrokePayload) [][]event.StrokePayload {
	if len(strokes) == 0 {
		return nil
	}
	var out [][]event.StrokePayload
	cur := []event.StrokePayload{strokes[0]}
	for i := 1; i < len(strokes); i++ {
		if strokes[i].StrokeNo-strokes[i-1].StrokeNo > 1 {
			out = append(out, cur)
			cur = nil
		}
		cur = append(cur, strokes[i])
	}
	if len(cur) > 0 {
		out = append(out, cur)
	}
	return out
}

// mergeDistance keeps the best (shortest time) per target distance.
func mergeDistance(acc *[]DistanceCandidate, in []DistanceCandidate) {
	for _, c := range in {
		found := false
		for i := range *acc {
			if (*acc)[i].DistanceM == c.DistanceM {
				if c.TimeSec < (*acc)[i].TimeSec {
					(*acc)[i] = c
				}
				found = true
				break
			}
		}
		if !found {
			*acc = append(*acc, c)
		}
	}
}

// mergeWindow keeps the best per (Metric, Kind, Size).
func mergeWindow(acc *[]WindowCandidate, in []WindowCandidate) {
	for _, c := range in {
		found := false
		for i := range *acc {
			ex := (*acc)[i]
			if ex.Metric == c.Metric && ex.Kind == c.Kind && ex.Size == c.Size {
				if better(c.Metric, c.Value, ex.Value) {
					(*acc)[i] = c
				}
				found = true
				break
			}
		}
		if !found {
			*acc = append(*acc, c)
		}
	}
}
```

- [ ] **Step 4: Run, pass**

Run: `cd backend && go test ./internal/stats/...`
Expected: existing tests still pass; new test passes.

- [ ] **Step 5: Commit**

```bash
git add backend/internal/stats/candidates.go backend/internal/stats/candidates_test.go
git commit -m "feat(stats): PB candidates per work-segment run"
```

---

## Task 11: Backend — wire LoadWorkout into the sessionizer at boot

**Files:**
- Modify: wherever the sessionizer is constructed at startup. Find via:
  `grep -rn "session.New(" backend/cmd backend/internal`

- [ ] **Step 1: Locate construction site and inject LoadWorkout**

Run: `cd backend && grep -rn "session.New(" cmd internal | head`
Identify the file (likely `backend/cmd/server/main.go` or similar).

Edit that file: pass `LoadWorkout` to `session.Options`:

```go
opts := session.Options{
	// existing fields...
	LoadWorkout: func(id string) (*workout.Workout, error) {
		return workout.LoadByID(ctx, db, id) // use the existing query helper
	},
}
```

If the existing repo already has a workout-load helper, reuse it. If not, add a thin one in `backend/internal/workout/` that wraps the existing query path used by `GET /api/v1/workouts/{id}`.

- [ ] **Step 2: Build + run existing integration tests**

Run: `cd backend && go build ./... && go test ./...`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add backend/cmd/server/main.go backend/internal/workout/...
git commit -m "feat(server): inject workout loader into sessionizer"
```

---

## Task 12: Frontend — handle phase_change SSE in reducer

**Files:**
- Modify: `web/src/live/LiveSessionContext.tsx` (or wherever the SSE reducer lives — locate via `grep -rn "session_start" web/src/live`)

- [ ] **Step 1: Find reducer + add phase tracking**

Run: `cd web && grep -rn "session_start\|stroke" src/live/LiveSessionContext* src/live/*.ts | head`

Add to the live state shape:

```typescript
type LiveState = {
  // existing fields...
  phase: 'warmup' | 'work' | 'rest' | 'cooldown' | null
  phaseAnchor: { distanceM: number; timeSec: number } | null
}
```

- [ ] **Step 2: Handle phase_change event**

In the reducer / event dispatcher, add a case for `phase_change`:

```typescript
case 'phase_change': {
  const p = event.phase_change
  return {
    ...state,
    phase: p.to as LiveState['phase'],
    phaseAnchor: { distanceM: p.at_distance_m, timeSec: p.at_time_sec },
  }
}
```

Initialize `phase: null`, `phaseAnchor: null` in the reducer's initial state and on `session_start` clear both (`phase: null, phaseAnchor: null`).

Also extend the `stroke` event branch to capture initial phase if state.phase is null and event has a phase field:

```typescript
case 'stroke': {
  // existing logic...
  const phase = (event.stroke.phase as LiveState['phase']) ?? state.phase
  return { ...state, stroke: event.stroke, phase }
}
```

- [ ] **Step 3: Type the new event**

If event types are declared in a shared module, add:

```typescript
type PhaseChangeEvent = {
  type: 'phase_change'
  phase_change: {
    from: string
    to: string
    at_stroke: number
    at_time_sec: number
    at_distance_m: number
  }
}
```

Add to the event union.

- [ ] **Step 4: Run vitest**

Run: `cd web && npx vitest run`
Expected: existing tests pass; if the reducer has tests they continue to pass with the additive change.

- [ ] **Step 5: Commit**

```bash
git add web/src/live/LiveSessionContext.tsx web/src/api/sse.ts # whichever files changed
git commit -m "feat(web): handle phase_change SSE event in live reducer"
```

---

## Task 13: Frontend — usePhaseBaseline hook

**Files:**
- Create: `web/src/live/usePhaseBaseline.ts`
- Test: `web/src/live/usePhaseBaseline.test.tsx`

- [ ] **Step 1: Failing test**

Create `web/src/live/usePhaseBaseline.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest'
import { renderHook } from '@testing-library/react'
import { usePhaseBaseline } from './usePhaseBaseline'
import { LiveSessionContext } from './LiveSessionContext'
import type { ReactNode } from 'react'

function wrap(state: any) {
  return ({ children }: { children: ReactNode }) => (
    <LiveSessionContext.Provider value={state}>{children}</LiveSessionContext.Provider>
  )
}

describe('usePhaseBaseline', () => {
  it('zero during warmup', () => {
    const state = {
      phase: 'warmup',
      phaseAnchor: { distanceM: 0, timeSec: 0 },
      stroke: { distance_m: 5, time_sec: 10 },
    }
    const { result } = renderHook(() => usePhaseBaseline(), { wrapper: wrap(state) })
    expect(result.current.displayDistanceM).toBe(0)
    expect(result.current.displayTimeSec).toBe(0)
    expect(result.current.frozen).toBe(false)
  })

  it('hard reset at warmup→work', () => {
    const state = {
      phase: 'work',
      phaseAnchor: { distanceM: 5, timeSec: 30 },
      stroke: { distance_m: 100, time_sec: 60 },
    }
    const { result } = renderHook(() => usePhaseBaseline(), { wrapper: wrap(state) })
    expect(result.current.displayDistanceM).toBe(95)
    expect(result.current.displayTimeSec).toBe(30)
  })

  it('frozen during rest', () => {
    const state = {
      phase: 'rest',
      phaseAnchor: { distanceM: 500, timeSec: 120 },
      stroke: { distance_m: 500, time_sec: 130 },
    }
    const { result } = renderHook(() => usePhaseBaseline(), { wrapper: wrap(state) })
    expect(result.current.frozen).toBe(true)
    expect(result.current.displayDistanceM).toBe(495) // 500 - workSegStart=5
    // workSegStart isn't on phaseAnchor for rest; assert frozen=true
  })
})
```

- [ ] **Step 2: Run, expect compile failure**

Run: `cd web && npx vitest run src/live/usePhaseBaseline.test.tsx`
Expected: module not found.

- [ ] **Step 3: Implement hook**

Create `web/src/live/usePhaseBaseline.ts`:

```typescript
import { useContext, useRef } from 'react'
import { LiveSessionContext } from './LiveSessionContext'

export type PhaseBaseline = {
  phase: 'warmup' | 'work' | 'rest' | 'cooldown' | null
  displayDistanceM: number
  displayTimeSec: number
  frozen: boolean
}

export function usePhaseBaseline(): PhaseBaseline {
  const state = useContext(LiveSessionContext)
  // Last-seen work display value, for freezing during rest/cooldown.
  const frozenWork = useRef<{ d: number; t: number }>({ d: 0, t: 0 })
  // Anchor captured at the moment work-phase started, for baseline subtraction.
  const workAnchor = useRef<{ d: number; t: number } | null>(null)

  const phase = state.phase
  const stroke = state.stroke
  const anchor = state.phaseAnchor

  if (phase === 'work' && anchor) {
    workAnchor.current = { d: anchor.distanceM, t: anchor.timeSec }
  }

  if (phase === 'work' && stroke && workAnchor.current) {
    const d = Math.max(0, stroke.distance_m - workAnchor.current.d)
    const t = Math.max(0, stroke.time_sec - workAnchor.current.t)
    frozenWork.current = { d, t }
    return { phase, displayDistanceM: d, displayTimeSec: t, frozen: false }
  }
  if (phase === 'warmup') {
    return { phase, displayDistanceM: 0, displayTimeSec: 0, frozen: false }
  }
  if (phase === 'rest' || phase === 'cooldown') {
    return {
      phase,
      displayDistanceM: frozenWork.current.d,
      displayTimeSec: frozenWork.current.t,
      frozen: true,
    }
  }
  // null phase / no workout: pass through raw stroke totals.
  return {
    phase,
    displayDistanceM: stroke?.distance_m ?? 0,
    displayTimeSec: stroke?.time_sec ?? 0,
    frozen: false,
  }
}
```

- [ ] **Step 4: Run tests, pass**

Run: `cd web && npx vitest run src/live/usePhaseBaseline.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/live/usePhaseBaseline.ts web/src/live/usePhaseBaseline.test.tsx
git commit -m "feat(web): usePhaseBaseline hook"
```

---

## Task 14: Frontend — LiveHero + TileGrid consume baseline

**Files:**
- Modify: `web/src/pages/LiveHero.tsx`
- Modify: `web/src/pages/TileGrid.tsx`

- [ ] **Step 1: Replace raw stroke distance/time reads in LiveHero**

In `web/src/pages/LiveHero.tsx`, find every reference to `state.stroke.distance_m` / `state.stroke.time_sec` that drives the primary distance/time readout. Replace with:

```typescript
import { usePhaseBaseline } from '../live/usePhaseBaseline'
// ...
const baseline = usePhaseBaseline()
// then use baseline.displayDistanceM / baseline.displayTimeSec
```

Apply the same change in `TileGrid.tsx` for the distance/time tiles. Leave power/SPM/pace tiles reading raw stroke values (the user still wants live instantaneous metrics during all phases).

- [ ] **Step 2: Existing snapshot/render tests**

Run: `cd web && npx vitest run`
Expected: PASS. Update any snapshot tests that now show distance=0 during warmup.

- [ ] **Step 3: Commit**

```bash
git add web/src/pages/LiveHero.tsx web/src/pages/TileGrid.tsx
git commit -m "feat(web): hero + tiles use phase-baseline distance/time"
```

---

## Task 15: Frontend — remove useAutoEndOnComplete

**Files:**
- Delete: `web/src/live/useAutoEndOnComplete.ts`
- Modify: `web/src/pages/LivePage.tsx`

- [ ] **Step 1: Remove import + call**

Edit `web/src/pages/LivePage.tsx`: delete the line `import { useAutoEndOnComplete } from '../live/useAutoEndOnComplete'` and the `useAutoEndOnComplete()` call inside `LiveBody`.

- [ ] **Step 2: Delete the hook file**

```bash
rm web/src/live/useAutoEndOnComplete.ts
```

- [ ] **Step 3: Build + tests**

Run: `cd web && npx tsc --noEmit && npx vitest run`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add web/src/pages/LivePage.tsx web/src/live/useAutoEndOnComplete.ts
git commit -m "refactor(web): remove useAutoEndOnComplete (backend now drives end)"
```

---

## Task 16: End-to-end smoke

**Files:**
- (no code changes) — manual verification

- [ ] **Step 1: Reset DB**

```bash
rm backend/data/*.db   # adjust path to actual sqlite file location
```

- [ ] **Step 2: Start backend + frontend**

```bash
cd backend && go run ./cmd/server &
cd web && npm run dev
```

- [ ] **Step 3: Walk a workout**

In the browser, create a distance workout (200 m) with 30 s warmup and 30 s cooldown. Start the session. Replay or row a fixture. Verify:

- Hero shows distance 0 / time counting up during warmup.
- At warmup→work boundary, hero distance + time reset to 0.
- During work, hero counts up from 0.
- After 200 m crossed, cooldown starts; hero distance freezes at 200, cooldown countdown shown.
- After 30 s cooldown elapses, `SessionEndedOverlay` appears with totals reflecting work-phase only.
- `SELECT phase, count(*) FROM strokes` mid-session shows the right distribution; after end, strokes table is empty.
- `summary_json` contains `warmup_sec`/`cooldown_sec` side counters and PB candidates computed only on work strokes.

- [ ] **Step 4: Commit nothing — log smoke result in PR description**

---

## Self-Review Notes

- **Spec coverage:** every section of the spec maps to a task: phase model = Tasks 2 + 6; backend sessionizer changes = Tasks 6 + 7 + 8 + 11; stroke storage = Tasks 4 + 5; compaction = Task 9; PB candidates = Task 10; frontend baseline = Tasks 13 + 14; end-trigger removal = Task 15; cooldown bug fix from spec = Task 1.
- **Rest segment timing**: the sessionizer relies on the same algorithm as the frontend's `locateSegment`. The `workCompletedAt` anchor is set when a work distance segment is crossed and is consumed by the immediately following time-based segment, which matches both rest-between-reps and cooldown.
- **No-workout sessions**: Task 6's `FreeRowPhasePlan()` returns `PhaseWork` for everything; the persister's `filterWorkStrokes` keeps every stroke (default phase = `'work'` from the migration). Behavior identical to today.
- **Free-row sessions never "complete"** by phase, so the `WorkoutComplete` trigger from Task 7 never fires for them. Idle/inactivity timeouts still close them.
