# Training Modes — Live-View Overlay (frontend-driven segments)

> **Status:** Shipped — merged to main.


> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** While a workout-tagged session is active, Live View shows a progress strip, segment label + countdown, and green/yellow target-range indicators on split + SPM tiles. Abort button falls back to Just Row without stopping the session. Segments are derived **client-side** from the workout record; the backend stays simple.

**Architecture decision:** No new SSE event kind. Instead:
- Backend adds `workout_id` to the existing `session_start` SSE payload (one field).
- Frontend fetches `GET /api/v1/workouts/{id}` when `session_start` arrives with a `workout_id`.
- A pure function expands the workout into a list of `Segment` records.
- A selector derives the active segment + remaining from the current stroke's distance + time.
- Components subscribe via a single `useWorkoutProgress()` hook.

This is less moving parts than a backend segmenter, easier to test, and enough for v1. If we later want authoritative server-side transitions (e.g., for haptics that must not drift), we promote to a `segment_state` SSE event without rewriting UI.

**Tech stack:** React 18, TypeScript, React Query, Web Vibration API, Go (tiny backend tweak).

---

## File structure

**New (FE):**
- `web/src/live/segments.ts` — `expandWorkout(workout) → Segment[]`, `locateSegment(segments, distanceM, timeSec) → ActiveSegment | null`
- `web/src/live/segments.test.ts`
- `web/src/live/useWorkoutProgress.ts` — hook: fetches workout, computes active segment from LiveState
- `web/src/live/useWorkoutProgress.test.ts`
- `web/src/live/targetRange.ts` — `inRange(value, range) → 'in' | 'out' | 'none'`
- `web/src/live/targetRange.test.ts`
- `web/src/pages/live/WorkoutProgressStrip.tsx` + `.module.css` + `.test.tsx`
- `web/src/pages/live/SegmentStatus.tsx` + `.module.css` + `.test.tsx` — the "Intervall 3/8 · 500 m · 1:12" banner above the hero
- `web/src/pages/live/TargetDot.tsx` + `.module.css` + `.test.tsx` — small colored dot used inside tiles
- `web/src/pages/live/AbortWorkoutButton.tsx` + `.test.tsx`
- `web/src/live/haptics.ts` — thin `vibrate(ms|pattern)` wrapper + feature detect
- `web/src/live/haptics.test.ts`

**Modified (FE):**
- `web/src/live/events.ts` — add `workout_id?: string` to `SessionStartPayload`
- `web/src/live/reducer.ts` — persist `session.workout_id` (already carried if we store the whole payload)
- `web/src/pages/LivePage.tsx` — render `<SegmentStatus />` above `<LiveHero />` and `<WorkoutProgressStrip />` above that; render `<AbortWorkoutButton />` in a corner
- `web/src/pages/LiveHero.tsx` (or whichever renders split + SPM tiles) — consume `TargetDot` for split + SPM
- `web/src/pages/TileGrid.tsx` — same for any tile that shows split / SPM

**Modified (backend):**
- `backend/internal/event/wire.go` — add `WorkoutID string \`json:"workout_id,omitempty"\`` to `sessionStartWire`
- `backend/internal/event/wire_test.go` — assert JSON contains/excludes `workout_id` appropriately
- `specs/int/0002-live-stream-sse.md` — document the new optional field

---

## Terminology

```ts
type SegmentKind = 'warmup' | 'work' | 'rest' | 'cooldown'

type Segment = {
  kind: SegmentKind
  index: number            // 0-based position in the full ordered list
  // Exactly one of the two is set:
  durationSec?: number     // time-bounded segment
  distanceM?: number       // distance-bounded segment
  // Target ranges only for 'work' segments:
  targetSplit?: { lo: number; hi: number | null }
  targetSPM?: { lo: number; hi: number | null }
  // Absolute offsets inside the session timeline:
  startTimeSec: number     // when time-bounded cumulative time; 0 for distance-bounded
  endTimeSec: number       // derived
  startDistanceM: number   // when distance-bounded cumulative distance; 0 for time-bounded
  endDistanceM: number     // derived
}

type ActiveSegment = {
  segment: Segment
  remainingSec?: number    // only for time-bounded
  remainingM?: number      // only for distance-bounded
  progressRatio: number    // 0..1 inside the segment
  totalSegments: number
  activeIndexOneBased: number
}
```

### Segment expansion rules

Given a `Workout` with `mode`, `params`, `intensity`, `warmup_sec`, `cooldown_sec`:

1. If `warmup_sec > 0`: prepend `{kind:'warmup', durationSec: warmup_sec}`.
2. Work segments:
   - `distance`: one `{kind:'work', distanceM: meters, targetSplit, targetSPM}`
   - `time`: one `{kind:'work', durationSec: seconds, ...}`
   - `intervals`: for `i in 0..reps-1`: push `{kind:'work', …}` then (if `i < reps-1`) `{kind:'rest', durationSec: rest_sec}`. The work unit has `distanceM` when `length.unit === 'm'` else `durationSec` (minutes→sec).
3. If `cooldown_sec > 0`: append `{kind:'cooldown', durationSec: cooldown_sec}`.
4. Fill `startTimeSec/endTimeSec/startDistanceM/endDistanceM` by cumulative walk, separately for the two "clocks" — time-bounded segments advance their `timeSec` counters and carry through the other clock unchanged, distance-bounded segments vice-versa.

### Locating the active segment

Segments that were earlier in the list will have already consumed their distance/time allotment. Walk the list; for each segment compute `consumed = max(distanceConsumed, timeConsumed)` where:
- For a distance-bounded segment: `distanceConsumed = clamp(stroke.distanceM - seg.startDistanceM, 0, seg.distanceM); timeConsumed = 0`.
- For a time-bounded segment: `timeConsumed = clamp(stroke.timeSec - seg.startTimeSec, 0, seg.durationSec); distanceConsumed = 0`.

A segment is "active" when its consumed fraction is `> 0` AND `< 1` **and** no later segment is already active. If all segments are exhausted → return `null` (workout complete; session may continue but live view shows "Fertig").

Boundary safety: if the cumulative stroke metric is below segment 0's start, active is segment 0 with 0% progress.

Write these as pure functions so tests don't need React.

---

## Task 1 — Segment expansion (pure)

**Files:**
- Create: `web/src/live/segments.ts`
- Create: `web/src/live/segments.test.ts`

- [ ] **Step 1: Tests first**

Cover:
- Distance-only workout: `expandWorkout({mode:'distance', params:{meters:5000}, intensity:'moderat', warmup_sec:0, cooldown_sec:0})` → single work segment, distanceM 5000, targets populated.
- With warmup + cooldown: 3 segments in order; offsets cumulative.
- Time workout.
- Intervals meters: `4×500m rest_sec=60` → 4 work + 3 rest = 7 segments; with WU+CD = 9.
- Intervals minutes: `3×90s rest 30s` → work segments have `durationSec`, not `distanceM`.
- Targets: only on `work` kind; missing on warmup/rest/cooldown.

Example:

```ts
import { describe, it, expect } from 'vitest'
import { expandWorkout } from './segments'

describe('expandWorkout', () => {
  it('distance with WU+CD yields 3 segments', () => {
    const segs = expandWorkout({
      id: 'W1', mode: 'distance',
      params: { meters: 5000 },
      intensity: 'moderat',
      warmup_sec: 300, cooldown_sec: 300,
      created_at: '',
    })
    expect(segs.map((s) => s.kind)).toEqual(['warmup', 'work', 'cooldown'])
    expect(segs[1].distanceM).toBe(5000)
    expect(segs[1].targetSplit).toBeDefined()
    expect(segs[0].targetSplit).toBeUndefined()
  })

  it('intervals meters: 4×500m rest 60s → 7 segments (work,rest,work,rest,work,rest,work)', () => {
    const segs = expandWorkout({
      id: 'W2', mode: 'intervals',
      params: { reps: 4, length: { unit: 'm', value: 500 }, rest_sec: 60 },
      warmup_sec: 0, cooldown_sec: 0, created_at: '',
    })
    expect(segs.map((s) => s.kind)).toEqual(['work','rest','work','rest','work','rest','work'])
    expect(segs[0].distanceM).toBe(500)
    expect(segs[1].durationSec).toBe(60)
  })

  it('intervals minutes: 3×90s rest 30s', () => {
    const segs = expandWorkout({
      id: 'W3', mode: 'intervals',
      params: { reps: 3, length: { unit: 'min', value: 1.5 }, rest_sec: 30 },
      warmup_sec: 0, cooldown_sec: 0, created_at: '',
    } as any)
    const workDurations = segs.filter((s) => s.kind === 'work').map((s) => s.durationSec)
    expect(workDurations).toEqual([90, 90, 90])
  })

  it('assigns cumulative start/end offsets', () => {
    const segs = expandWorkout({
      id: 'W4', mode: 'intervals',
      params: { reps: 2, length: { unit: 'm', value: 500 }, rest_sec: 60 },
      warmup_sec: 120, cooldown_sec: 0, created_at: '',
    } as any)
    // warmup 120s; work 500m; rest 60s; work 500m
    expect(segs[0].startTimeSec).toBe(0)
    expect(segs[0].endTimeSec).toBe(120)
    expect(segs[1].startDistanceM).toBe(0)
    expect(segs[1].endDistanceM).toBe(500)
    expect(segs[2].startTimeSec).toBe(120)
    expect(segs[2].endTimeSec).toBe(180)
    expect(segs[3].startDistanceM).toBe(500)
    expect(segs[3].endDistanceM).toBe(1000)
  })
})
```

- [ ] **Step 2: Implement**

```ts
import type { Workout, Intensity } from '../api/workouts'
import { intensityRanges } from '../pages/workout/intensityRanges'

export type SegmentKind = 'warmup' | 'work' | 'rest' | 'cooldown'

export type Segment = {
  kind: SegmentKind
  index: number
  durationSec?: number
  distanceM?: number
  targetSplit?: { lo: number; hi: number | null }
  targetSPM?: { lo: number; hi: number | null }
  startTimeSec: number
  endTimeSec: number
  startDistanceM: number
  endDistanceM: number
}

export function expandWorkout(w: Workout): Segment[] {
  const out: Segment[] = []
  const ranges = w.intensity ? intensityRanges[w.intensity] : undefined

  if (w.warmup_sec > 0) out.push({ kind: 'warmup', index: 0, durationSec: w.warmup_sec, startTimeSec: 0, endTimeSec: 0, startDistanceM: 0, endDistanceM: 0 })

  if (w.mode === 'distance') {
    const meters = (w.params as { meters: number }).meters
    out.push(mkWork(meters, undefined, ranges))
  } else if (w.mode === 'time') {
    const seconds = (w.params as { seconds: number }).seconds
    out.push(mkWork(undefined, seconds, ranges))
  } else if (w.mode === 'intervals') {
    const p = w.params as { reps: number; length: { unit: 'm'|'min'; value: number }; rest_sec: number }
    for (let i = 0; i < p.reps; i++) {
      if (p.length.unit === 'm') out.push(mkWork(p.length.value, undefined, ranges))
      else out.push(mkWork(undefined, Math.round(p.length.value * 60), ranges))
      if (i < p.reps - 1) out.push({ kind: 'rest', index: 0, durationSec: p.rest_sec, startTimeSec: 0, endTimeSec: 0, startDistanceM: 0, endDistanceM: 0 })
    }
  }

  if (w.cooldown_sec > 0) out.push({ kind: 'cooldown', index: 0, durationSec: w.cooldown_sec, startTimeSec: 0, endTimeSec: 0, startDistanceM: 0, endDistanceM: 0 })

  // Assign index + cumulative offsets.
  let cumT = 0, cumD = 0
  out.forEach((seg, i) => {
    seg.index = i
    seg.startTimeSec = cumT
    seg.startDistanceM = cumD
    if (seg.durationSec) cumT += seg.durationSec
    if (seg.distanceM) cumD += seg.distanceM
    seg.endTimeSec = cumT
    seg.endDistanceM = cumD
  })

  return out
}

function mkWork(distanceM: number | undefined, durationSec: number | undefined, ranges?: { splitSec: { lo: number; hi: number|null }; spm: { lo: number; hi: number|null } }): Segment {
  return {
    kind: 'work',
    index: 0,
    distanceM,
    durationSec,
    targetSplit: ranges?.splitSec,
    targetSPM: ranges?.spm,
    startTimeSec: 0,
    endTimeSec: 0,
    startDistanceM: 0,
    endDistanceM: 0,
  }
}
```

- [ ] **Step 3: Run tests — PASS**
- [ ] **Step 4: Commit**: `feat(web): segment expansion from workout`

---

## Task 2 — Locate active segment (pure)

**Files:** append to `segments.ts` + `segments.test.ts`

```ts
export type ActiveSegment = {
  segment: Segment
  remainingSec?: number
  remainingM?: number
  progressRatio: number
  totalSegments: number
  activeIndexOneBased: number
}

export function locateSegment(segments: Segment[], distanceM: number, timeSec: number): ActiveSegment | null {
  if (segments.length === 0) return null
  for (const seg of segments) {
    const tConsumed = seg.durationSec ? Math.max(0, timeSec - seg.startTimeSec) : 0
    const dConsumed = seg.distanceM ? Math.max(0, distanceM - seg.startDistanceM) : 0

    if (seg.durationSec) {
      if (tConsumed < seg.durationSec) {
        return {
          segment: seg,
          remainingSec: Math.max(0, seg.durationSec - tConsumed),
          progressRatio: tConsumed / seg.durationSec,
          totalSegments: segments.length,
          activeIndexOneBased: seg.index + 1,
        }
      }
    } else if (seg.distanceM) {
      if (dConsumed < seg.distanceM) {
        return {
          segment: seg,
          remainingM: Math.max(0, seg.distanceM - dConsumed),
          progressRatio: dConsumed / seg.distanceM,
          totalSegments: segments.length,
          activeIndexOneBased: seg.index + 1,
        }
      }
    }
  }
  return null // workout done
}
```

Tests to add:
- Active on first segment when all metrics zero.
- Transitions to second segment when first consumed.
- Returns null after last segment consumed.
- Distance segment's remainingM correct.
- Time segment's remainingSec correct.

Commit: `feat(web): locate active segment`

---

## Task 3 — Target range helper

**Files:** `web/src/live/targetRange.ts` + test.

```ts
export type Range = { lo: number; hi: number | null }
export type RangeStatus = 'in' | 'under' | 'over' | 'none'

export function inRange(value: number | null | undefined, range: Range | undefined): RangeStatus {
  if (value == null || value === 0 || !range) return 'none'
  if (value < range.lo) return 'under'
  if (range.hi != null && value > range.hi) return 'over'
  return 'in'
}
```

Note: lower split = faster, so "under" actually means "faster than target." UI can still show green when status is `'in'`, yellow otherwise. Keep the directional distinction in case we want richer UI later.

Tests cover: in-range, below lo, above hi, unbounded hi, null value, undefined range.

Commit: `feat(web): target range helper`

---

## Task 4 — Add workout_id to SSE session_start + FE types

**Files:**
- Modify: `backend/internal/event/wire.go` — `sessionStartWire` gets `WorkoutID string \`json:"workout_id,omitempty"\``. `Marshal` sets it from `p.WorkoutID`.
- Modify: `backend/internal/event/wire_test.go` — add a case with non-empty WorkoutID asserting the JSON contains `"workout_id"`, and an existing case (empty WorkoutID) confirming omitempty.
- Modify: `specs/int/0002-live-stream-sse.md` — one-line addition documenting the optional field.
- Modify: `web/src/live/events.ts` — add `workout_id?: string` to `SessionStartPayload`.
- Modify: `web/src/live/reducer.test.ts` — quick assertion that `workout_id` survives round-trip through the reducer (it's already stored via the full payload).

Steps: write tests first, run FAIL, edit wire.go + events.ts, run PASS.

Commit: `feat(backend+web): carry workout_id in session_start SSE payload`

---

## Task 5 — useWorkoutProgress hook

**Files:** `web/src/live/useWorkoutProgress.ts` + test

```ts
import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { useLiveSession } from './LiveSessionContext'
import { getWorkout } from '../api/workouts' // add if missing; for v1 we already have GET /workouts/{id}
import { expandWorkout, locateSegment, type ActiveSegment, type Segment } from './segments'

export type WorkoutProgress = {
  segments: Segment[]
  active: ActiveSegment | null
  workoutId: string | null
  isLoading: boolean
}

export function useWorkoutProgress(): WorkoutProgress {
  const state = useLiveSession()
  const workoutId = state.session?.workout_id ?? null

  const q = useQuery({
    queryKey: ['workout', workoutId],
    queryFn: () => getWorkout(workoutId!),
    enabled: !!workoutId,
    staleTime: 60_000,
  })

  const segments = useMemo(() => (q.data ? expandWorkout(q.data) : []), [q.data])
  const active = useMemo(() => {
    if (!state.stroke || segments.length === 0) return null
    return locateSegment(segments, state.stroke.distance_m, state.stroke.time_sec)
  }, [state.stroke, segments])

  return { segments, active, workoutId, isLoading: q.isLoading }
}
```

**Prereq:** `getWorkout(id)` may need to be added to `web/src/api/workouts.ts`. If it doesn't exist yet, add it in this task alongside a test:

```ts
export async function getWorkout(id: string): Promise<Workout> {
  const res = await fetch(`/api/v1/workouts/${encodeURIComponent(id)}`)
  if (!res.ok) throw new Error(`getWorkout: ${res.status}`)
  return res.json()
}
```

Test the hook via a small wrapper component, mocked fetch, and a mocked `useLiveSession`. Assert:
- Returns `workoutId=null` when no session.
- Returns empty segments while loading.
- After resolve, segments + active populated; `active.segment.kind === 'warmup'` at stroke 0.
- Active transitions when stroke distance advances into the work segment.

Commit: `feat(web): useWorkoutProgress hook (fetch + derive)`

---

## Task 6 — Progress strip

**Files:** `web/src/pages/live/WorkoutProgressStrip.tsx` + css + test

Renders one `<span>` per segment with width proportional to segment size. Kinds get distinct colors (warmup/cooldown = dashed outline, work = accent, rest = muted). The active segment gets a 2px vertical marker at `progressRatio`. Hidden when there's no active workout.

Size proportioning: because distance + time live on different axes, pick a single "cost" heuristic per segment:
- Distance-bounded: treat as `distanceM`.
- Time-bounded: treat as `durationSec * 3` (rowers cover ~3 m/sec at moderate pace, so the display roughly matches visual "length").

Expose via `useWorkoutProgress()`. Test renders with mocked state + resolved workout, asserts:
- Strip hidden when no workout.
- Correct number of blocks.
- Active marker is positioned (has inline `left: NN%` style).

Commit: `feat(web): WorkoutProgressStrip component`

---

## Task 7 — Segment status banner

**Files:** `web/src/pages/live/SegmentStatus.tsx` + css + test

Renders a single-row banner above the hero:

- For intervals work: `Intervall <activeIndex> / <reps> · <length label>`
- For intervals rest: `Pause · <remainingSec>s`
- For warmup: `Warm-up · <remainingSec>s`
- For cooldown: `Cool-down · <remainingSec>s`
- For distance single work: `<remainingM> m bis Ziel`
- For time single work: `<remainingSec>s bis Ziel`

Color the remaining when `<10s` on a time-bounded segment.

Test inputs: pass fake `ActiveSegment` via a tiny test harness that provides `useWorkoutProgress` with a stub. Since we can't easily stub a hook, expose a **pure presentational component** `SegmentStatusView({ active, workout })` and wire a thin `SegmentStatus` that calls the hook + forwards props. Tests exercise the view component directly.

Commit: `feat(web): SegmentStatus banner`

---

## Task 8 — Target dot on split + SPM tiles

**Files:**
- Create: `web/src/pages/live/TargetDot.tsx` + css + test — pure component receiving `status: RangeStatus`, renders a color-coded 8px dot (green for `in`, yellow for out).
- Modify: the existing tile renderer for split + SPM to mount `<TargetDot status={…} />` in the corner. Locate by grepping `split\|spm` in `web/src/pages/` — probably `TileGrid.tsx` or a child. Keep the change minimal; hide the dot when `status === 'none'`.

Wire the status in each tile: `status = inRange(stroke.spm, active?.segment.targetSPM)` etc. If no active work segment, status is `'none'` and dot hides.

Tests:
- `TargetDot` renders the right color per status.
- Integration test: render a tile with a mocked hook, assert dot visibility and color.

Commit: `feat(web): target range dot on split + SPM tiles`

---

## Task 9 — Haptics on segment transition

**Files:** `web/src/live/haptics.ts` + test

```ts
export function vibrate(pattern: number | number[]): boolean {
  if (typeof navigator === 'undefined') return false
  const v = (navigator as Navigator & { vibrate?: (p: number | number[]) => boolean }).vibrate
  return typeof v === 'function' ? v(pattern) : false
}
```

Wire a small effect inside `SegmentStatus` (or a dedicated `useSegmentTransitions()` hook) that tracks `active?.segment.index` with a ref; when the index rises, fires `vibrate([80, 40, 80])`. Skip on mount.

Test: mock `navigator.vibrate`, simulate a transition via rerender with a changed index, assert called once with the expected pattern. Another test: no call on mount.

Commit: `feat(web): haptic buzz on segment transition`

---

## Task 10 — Abort button

**Files:** `web/src/pages/live/AbortWorkoutButton.tsx` + test

Behavior:
- Hidden when no workout active (`workoutId === null`).
- Visible in a corner of LivePage while a workout is active.
- Tap → browser `confirm('Workout abbrechen?')`. If confirmed → calls `POST /api/v1/workouts/attach-clear` (plan-level decision: we need a way to detach a workout mid-session).

**Backend nit:** there's no "clear" endpoint yet. Either:
- Add `POST /api/v1/workouts/{id}/attach` with `id = "none"` and special-case (ugly), or
- Add a `DELETE /api/v1/sessions/current/workout` that clears the session's `workout_id`.

Simpler for v1: the live view just **stops rendering the overlay** when the user taps Abort. The server-side `session.workout_id` stays set, but UI behaves as if Just Row. Document this in the Self-Review section and mark a follow-up.

Implementation:
- Local React state `aborted: boolean` on LivePage.
- `useWorkoutProgress` returns `null` when the user has aborted (override via a second `workout-aborted` context, or lift the abort flag to the LiveSessionContext — whichever is simpler).

Simplest: add a `WorkoutOverlayContext` in `LivePage` (just `React.createContext<{aborted:boolean; setAborted: (b:boolean)=>void}>`) wrapping hero + tiles + overlays. Each overlay component checks the flag before rendering.

Tests:
- Button hidden when no workout.
- Tap triggers confirm, on yes sets flag, overlay disappears.

Commit: `feat(web): abort workout button (client-side overlay suppression)`

---

## Task 11 — Wire everything into LivePage

**File:** `web/src/pages/LivePage.tsx`

Structure (inside the `<div className={styles.page}>`):

```
<WorkoutOverlayProvider>
  <WorkoutProgressStrip />
  <SegmentStatus />
  <AbortWorkoutButton />
  <LiveHero state={state} />
  <TileGrid state={state} />
</WorkoutOverlayProvider>
```

Existing session-end navigation (Task 12 of the home+flow plan) stays. When nav fires, overlay is unmounted naturally.

Tests:
- Integration test: mount with a stubbed `useLiveSession` returning `{session:{workout_id:'W1'}, stroke: {...}, ...}` and a mocked fetch for `/api/v1/workouts/W1`. Verify the progress strip + segment status + target dot all render.
- When `session.workout_id` is missing, overlay pieces don't render.

Commit: `feat(web): wire workout overlay into LivePage`

---

## Task 12 — Smoke + build

- [ ] `cd web && npm run test -- --run` — full suite green.
- [ ] `cd web && npm run build` — clean.
- [ ] `cd backend && go test ./... && go build ./...` — green.
- [ ] Commit if anything needed polishing: `chore: live-view overlay polish`

---

## Self-review checklist

**Spec coverage:**
- Progress strip under status bar ✓ (T6)
- Segment label + countdown above hero ✓ (T7)
- Target range indicator (green/yellow) on split + SPM ✓ (T8)
- Haptik on segment transition ✓ (T9)
- Workout abbrechen → fallback to Just Row ✓ (T10, caveat: client-side suppression only; server keeps workout_id)
- `workout_id` surfaced via SSE ✓ (T4)

**Placeholder scan:** no TBD/TODO left other than one intentional follow-up on backend workout-clear.

**Type consistency:** `Segment`, `ActiveSegment`, `SegmentKind`, `Range`, `RangeStatus`, `WorkoutProgress` — used consistently.

## Not in this plan

- Server-side authoritative segment state (`segment_state` SSE event) — upgrade path open.
- Audio cues at segment boundaries — behind a settings flag, deferred.
- Workout-aborted persistence in DB — tracked as follow-up.
- Post-session "Geschafft!" / "Neue Bestzeit!" full-screen states — Stitch has 5 variants, FEAT-0005a spec, deferred.
- Per-user intensity defaults (FEAT-0004) — still static ranges.
