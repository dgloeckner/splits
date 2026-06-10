# Stability, Accuracy & Replay-Harness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the production bugs found in the 2026-06-10 frontend review, make the live pipeline deterministic and replay-testable (ADR-0017), implement Pause/auto-resume (CONTEXT.md §Pause / Abort), re-pin PBs to work-only strokes, consolidate session finalisation behind one seam, and finish with backend-stamped work-relative values plus the frontend deletion pass.

**Architecture:** Eight phases, each independently shippable. Phase A fixes user-visible bugs (the unwired `phase_change` SSE listener is the root cause of both training-session bug reports). Phase B makes the reducer a pure event-fold. Phase C builds the golden-JSONL replay seam (Go produces + asserts, TS consumes + asserts). Phases D–G build on that seam test-first. The golden files in `specs/int/fixtures/golden/` are the contract between the Go and TS suites; intentional wire changes regenerate them via `go test -update` and the diff is reviewed like an API change.

**Tech Stack:** Go 1.x backend (`backend/`), React + TypeScript PWA (`web/`, vitest), SQLite, SSE wire per INT-0002.

**Key references:** ADR-0017 (`specs/adr/0017-deterministic-replay-harness-ci-seam.md`), CONTEXT.md §Pause / Abort + §Workout phases + §Falschstart, `docs/distance-flow-audit.md` (B1/B5 history).

**Conventions:**
- Web tests: `cd web && npx vitest run <file>` (run the whole suite with `npx vitest run` before each commit).
- Backend tests: `cd backend && go test ./...` (race detector is on by default per repo config).
- Commits follow the existing `fix(scope):` / `feat(scope):` / `test(scope):` style.

**Phase order & independence:**

| Phase | Delivers | Depends on |
|---|---|---|
| A | Production hotfixes (frontend + backend) | — |
| B | Deterministic reducer (`nowMs` on action) | — |
| C | Synchronous step seam + golden replay harness (ADR-0017) | B |
| D | Pause / auto-resume sub-state | C (for TDD fixture) |
| E | PB work-only re-pin | — |
| F | Race correctness (clock domain, pre-GO exclusion) | — |
| G | Backend-stamped values + frontend deletion pass | C, D |
| H | Finalise seam | — (do after E to avoid churn) |

---

## Phase A — Production hotfixes (frontend + backend)

### Task A1: Wire `phase_change` into the SSE channel

The backend emits `event: phase_change` (`backend/internal/event/wire.go:24`) but `EventSourceChannel` never registers a listener for it, so the reducer's `phase_change` branch is dead in production: `phaseAnchor`/`workStartDistanceM` never latch and every work-distance display silently includes warmup meters.

**Files:**
- Modify: `web/src/live/channel.ts:195-200`
- Modify: `web/src/live/reducer.ts:317-338` (idempotency guard — snapshot replay re-sends the latest `phase_change`)
- Test: `web/src/live/channel.eventsource.test.ts`

- [ ] **Step 1: Write the failing per-kind round-trip test**

Add to `web/src/live/channel.eventsource.test.ts` (follow the file's existing fake-EventSource pattern for constructing the channel; the test below is self-contained if none fits):

```ts
describe('event kind registration', () => {
  it('registers a listener for every wire event kind', () => {
    const listeners = new Map<string, (ev: MessageEvent) => void>()
    const fakeES = {
      addEventListener: (kind: string, fn: (ev: MessageEvent) => void) => {
        listeners.set(kind, fn)
      },
      close: () => {},
      onopen: null as null | (() => void),
      onerror: null as null | (() => void),
    }
    const ch = new EventSourceChannel({
      factory: () => fakeES as unknown as EventSource,
      random: () => 0,
    })
    const received: string[] = []
    ch.subscribe({
      onEvent: (e) => received.push(e.kind),
      onStatus: () => {},
    })

    const wireKinds = [
      'stroke',
      'session_start',
      'session_end',
      'session_finalized',
      'level_change',
      'workout_attached',
      'phase_change',
    ]
    for (const k of wireKinds) {
      expect(listeners.has(k), `channel must listen for "${k}"`).toBe(true)
    }

    // Round-trip a phase_change payload through the registered listener.
    listeners.get('phase_change')!({
      data: JSON.stringify({
        session_id: 's1',
        from: 'warmup',
        to: 'work',
        at_stroke: 12,
        at_time_sec: 120,
        at_distance_m: 410,
      }),
      lastEventId: '42',
    } as MessageEvent)
    expect(received).toContain('phase_change')
  })
})
```

Adapt the `EventSourceChannel` constructor call to the actual constructor signature in `channel.ts` (it takes a factory and an injected random; check lines 100–125).

- [ ] **Step 2: Run it to make sure it fails**

Run: `cd web && npx vitest run src/live/channel.eventsource.test.ts`
Expected: FAIL — `channel must listen for "phase_change"`.

- [ ] **Step 3: Register the listener**

In `web/src/live/channel.ts`, after `handle('workout_attached')` (line 200):

```ts
    handle('phase_change')
```

- [ ] **Step 4: Add the snapshot-redelivery idempotency guard to the reducer**

The SSE snapshot re-sends the latest `phase_change` on reconnect (`sessionizer.go Snapshot()`); without a guard the handler wipes sparklines/smoothed on every redelivery. In `web/src/live/reducer.ts`, at the top of `case 'phase_change': {`:

```ts
        case 'phase_change': {
          const p = ev.data
          // Snapshot redelivery after an SSE reconnect re-sends the
          // latest phase_change. Don't wipe the live charts when the
          // state already reflects this exact transition.
          if (
            state.phase === (p.to as LiveState['phase']) &&
            state.phaseAnchor?.distanceM === p.at_distance_m &&
            state.phaseAnchor?.timeSec === p.at_time_sec
          ) {
            return state
          }
```

(rest of the case unchanged)

- [ ] **Step 5: Add a reducer test for the idempotency guard**

In `web/src/live/reducer.test.ts`:

```ts
it('redelivered phase_change (snapshot replay) does not wipe sparklines', () => {
  const pc = {
    kind: 'phase_change' as const,
    id: 10,
    data: {
      session_id: 's1', from: 'warmup', to: 'work',
      at_stroke: 5, at_time_sec: 120, at_distance_m: 400,
    },
  }
  let s = liveReducer(stateWithSparklines(), { type: 'event', event: pc })
  const after = liveReducer(s, { type: 'event', event: pc })
  expect(after).toBe(s) // object identity — no wipe, no new state
})
```

Use the file's existing helpers to build `stateWithSparklines()` (a state with at least one sparkline point and `session` set); follow the construction pattern already used in the `phase_change` tests there.

- [ ] **Step 6: E2E evidence — the user-visible symptom must be pinned.** A warmup-workout e2e already exists (commit `334567d` waits past the warmup split before asserting hero metrics — locate it via `grep -rln "warmup" web/e2e`). Extend it with the assertion that would have caught this bug: after the warmup→work transition, the hero distance tile shows **work-relative** distance (strictly less than the cumulative meters rowed; concretely, near 0 just after the transition), not session-cumulative.

- [ ] **Step 7: Run web suite + e2e, commit**

Run: `cd web && npx vitest run` (and the e2e suite per repo convention)
Expected: PASS.

```bash
git add web/src/live/channel.ts web/src/live/reducer.ts web/src/live/channel.eventsource.test.ts web/src/live/reducer.test.ts web/e2e
git commit -m "fix(live): wire phase_change into SSE channel; idempotent on snapshot redelivery"
```

### Task A2: Guard `session_end` by session_id

**Files:**
- Modify: `web/src/live/reducer.ts:286-291`
- Test: `web/src/live/reducer.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
it('ignores a redelivered session_end for a different session', () => {
  // state tracking session s2, stale session_end for s1 arrives
  const s = stateWithSession('s2') // helper per existing test patterns
  const stale = {
    kind: 'session_end' as const,
    id: 99,
    data: { session_id: 's1', ended_at: '2026-06-10T10:00:00Z', summary: emptySummary() },
  }
  const after = liveReducer(s, { type: 'event', event: stale })
  expect(after).toBe(s)
})
```

- [ ] **Step 2: Run to verify failure**

Run: `cd web && npx vitest run src/live/reducer.test.ts`
Expected: FAIL — summary applied despite mismatched id.

- [ ] **Step 3: Implement the guard (mirrors `session_finalized`)**

```ts
        case 'session_end':
          // Guard against SSE redelivery of a previous session's end
          // (mirrors session_finalized): only apply when it matches
          // the session we're tracking. With no tracked session, apply
          // (cold reconnect catching up on a just-ended session).
          if (state.session && ev.data.session_id !== state.session.session_id) {
            return state
          }
          return {
            ...state,
            stroke: null,
            summary: ev.data.summary,
          }
```

- [ ] **Step 4: Run + commit**

Run: `cd web && npx vitest run src/live/reducer.test.ts`

```bash
git add web/src/live/reducer.ts web/src/live/reducer.test.ts
git commit -m "fix(live): session_end only applies to the tracked session"
```

### Task A3: Reset phase state on implicit new session

The implicit new-session-from-stroke branch (reducer.ts:218-245) resets sparklines/smoothed but leaks `phase`, `phaseAnchor`, `workStartDistanceM` from the previous session.

**Files:**
- Modify: `web/src/live/reducer.ts:240-245`
- Test: `web/src/live/reducer.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
it('implicit new session from stroke clears phase anchors', () => {
  // Previous session ended with a work anchor latched.
  let s = stateWithSession('s1')
  s = { ...s, phase: 'work', phaseAnchor: { distanceM: 400, timeSec: 120 }, workStartDistanceM: 400 }
  const strokeNewSession = {
    kind: 'stroke' as const,
    id: 200,
    data: { ...baseStroke(), session_id: 's2', distance_m: 5 },
  }
  const after = liveReducer(s, { type: 'event', event: strokeNewSession })
  expect(after.phaseAnchor).toBeNull()
  expect(after.workStartDistanceM).toBeNull()
})
```

(`baseStroke()` per the file's existing stroke-builder helper. Note `after.phase` will be the stroke's own `phase` field via line 273 — assert anchors only.)

- [ ] **Step 2: Run to verify failure, then fix**

In the `newSession` baseState object (after `sessionStartedAtMs: null,` at line 244):

```ts
                smoothed: null,
                sessionStartedAtMs: null,
                phase: null,
                phaseAnchor: null,
                workStartDistanceM: null,
```

- [ ] **Step 3: Run + commit**

Run: `cd web && npx vitest run src/live/reducer.test.ts`

```bash
git add web/src/live/reducer.ts web/src/live/reducer.test.ts
git commit -m "fix(live): implicit new session resets phase anchors (no B5 leak across sessions)"
```

### Task A4: Remove the frontend-only rest-skip rule in `locateSegment`

`segments.ts:126-136` skips a rest segment as soon as the *next* interval's start distance is exceeded. The backend classifier (`phaseplan.go:204-225`) has no such rule — rest persists until `durationSec` elapses. With a warmup the bug is total (raw `distanceM` vs offset-free `startDistanceM` means rest is always skipped); without one, paddling during rest still skips it. Align with the backend: delete the skip.

**Files:**
- Modify: `web/src/live/segments.ts:126-136`
- Test: `web/src/live/segments.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
describe('rest segments match backend classification (phaseplan.go has no rest-skip)', () => {
  const segs: Segment[] = [
    { kind: 'work', index: 0, distanceM: 500, startTimeSec: 0, endTimeSec: 0, startDistanceM: 0, endDistanceM: 500 },
    { kind: 'rest', index: 1, durationSec: 60, startTimeSec: 0, endTimeSec: 0, startDistanceM: 500, endDistanceM: 500 },
    { kind: 'work', index: 2, distanceM: 500, startTimeSec: 0, endTimeSec: 0, startDistanceM: 500, endDistanceM: 1000 },
  ]
  it('stays in rest while its duration has not elapsed, even when paddling past the next start', () => {
    // Interval 1 crossed at t=120 (latches workCompletedAt); rower
    // paddles 30 m during rest; at t=150 rest (60 s) has not elapsed.
    locateSegment(segs, 500, 120) // latch the crossing
    const active = locateSegment(segs, 530, 150)
    expect(active?.segment.kind).toBe('rest')
    expect(active?.remainingSec).toBe(30)
  })
  it('with a warmup offset, rest is not skipped on entry', () => {
    const offset = 200 // warmup meters
    locateSegment(segs, 700, 120, offset) // 500 work-relative — crossing
    const active = locateSegment(segs, 720, 125, offset)
    expect(active?.segment.kind).toBe('rest')
  })
})
```

Build the `Segment` literals to match the actual `Segment` type fields in `segments.ts` (check the type at the top of the file; add `targetSplit`/`targetSPM` as `undefined` if required).

- [ ] **Step 2: Run to verify failure**

Run: `cd web && npx vitest run src/live/segments.test.ts`
Expected: the first case FAILS — returns work segment index 2.

- [ ] **Step 3: Delete the skip block**

In `locateSegment`, remove lines 128–136:

```ts
        // If a later distance segment has already been entered, this
        // time-based segment (rest) is consumed — skip it.
        const nextDistSeg = segments.slice(idx + 1).find((s) => s.distanceM != null)
        const nextDistStarted = nextDistSeg != null && distanceM > nextDistSeg.startDistanceM
        if (nextDistStarted) {
          workCompletedAt += seg.durationSec
          timeAnchor = workCompletedAt
          continue
        }
```

so the `workCompletedAt != null` branch goes straight to `const consumed = Math.max(0, timeSec - workCompletedAt)`.

- [ ] **Step 4: Run the segments suite; update any test asserting the old skip**

Run: `cd web && npx vitest run src/live/segments.test.ts`
If an existing case asserts the skip behaviour, rewrite it to backend semantics (rest until elapsed), citing `phaseplan.go:204-225` in a comment.

- [ ] **Step 5: Full web suite + commit**

```bash
cd web && npx vitest run
git add web/src/live/segments.ts web/src/live/segments.test.ts
git commit -m "fix(live): rest segments persist until elapsed, matching backend phaseplan"
```

### Task A5: Pause detection works under prefers-reduced-motion

`useIsLivePaused` re-evaluates only on re-render; with reduced motion (or hidden tab) the rAF tick is off and a pause produces no renders, so the PauseDialog never auto-opens.

**Files:**
- Modify: `web/src/live/useLiveDisplay.ts:72-79`
- Test: `web/src/live/useLiveDisplay.test.tsx`

- [ ] **Step 1: Write the failing test** (fake timers; mock `matchMedia` for reduced motion per the file's existing pattern, or stub `usePrefersReducedMotion` if the suite already does so)

```ts
it('detects a pause under prefers-reduced-motion via the interval fallback', () => {
  vi.useFakeTimers()
  mockReducedMotion(true) // per existing test helper/mocking pattern in this file
  const state = { ...initialLiveState, lastStrokeReceivedAtMs: Date.now(), stroke: baseStroke() }
  const { result } = renderHook(() => useIsLivePaused(state))
  expect(result.current).toBe(false)
  act(() => { vi.advanceTimersByTime(6000) })
  expect(result.current).toBe(true)
  vi.useRealTimers()
})
```

- [ ] **Step 2: Run to verify failure, then implement**

```ts
export function useIsLivePaused(state: LiveState): boolean {
  const reduced = usePrefersReducedMotion()
  const visible = usePageVisible()
  useFrameTick(!reduced && visible)
  // The rAF tick is disabled under reduced-motion / hidden tab, and a
  // pause by definition produces no new strokes — so nothing would
  // ever re-render this hook to flip `paused`. A coarse 1 s interval
  // keeps detection alive without re-enabling animation.
  const [, bump] = useState(0)
  useEffect(() => {
    if (!reduced && visible) return
    const id = setInterval(() => bump((n) => n + 1), 1000)
    return () => clearInterval(id)
  }, [reduced, visible])
  const last = state.lastStrokeReceivedAtMs
  if (last === null) return true
  return Date.now() - last >= smoothingConfig.deadReckoning.pauseThresholdMs
}
```

- [ ] **Step 3: Run + commit**

```bash
cd web && npx vitest run src/live/useLiveDisplay.test.tsx
git add web/src/live/useLiveDisplay.ts web/src/live/useLiveDisplay.test.tsx
git commit -m "fix(live): pause detection survives prefers-reduced-motion (interval fallback)"
```

### Task A6: Carry-safe duration formatters (no more "1:60")

Three local formatters (`StatBar.tsx:17-21`, `FinishOverlay.tsx:29-35`, `FinishOverlay.tsx:37-42`) round seconds before the minute-carry: 119.6 → `"1:60"`.

**Files:**
- Create: `web/src/lib/formatDuration.ts`
- Create: `web/src/lib/formatDuration.test.ts`
- Modify: `web/src/race/StatBar.tsx`, `web/src/race/FinishOverlay.tsx`

- [ ] **Step 1: Write the failing test**

```ts
import { fmtMmSs, fmtMmSsTenths } from './formatDuration'

describe('fmtMmSs', () => {
  it('carries rounded seconds into the minute', () => {
    expect(fmtMmSs(119.6)).toBe('2:00')
    expect(fmtMmSs(119.4)).toBe('1:59')
    expect(fmtMmSs(-119.6)).toBe('-2:00')
    expect(fmtMmSs(0)).toBe('0:00')
  })
})
describe('fmtMmSsTenths', () => {
  it('carries rounded tenths into the minute', () => {
    expect(fmtMmSsTenths(119.96)).toBe('2:00.0')
    expect(fmtMmSsTenths(119.94)).toBe('1:59.9')
    expect(fmtMmSsTenths(125.0)).toBe('2:05.0')
  })
})
```

- [ ] **Step 2: Implement `web/src/lib/formatDuration.ts`**

```ts
/** mm:ss with carry-safe rounding (119.6 → "2:00", never "1:60"). */
export function fmtMmSs(seconds: number): string {
  const sign = seconds < 0 ? '-' : ''
  const total = Math.round(Math.abs(seconds))
  const m = Math.floor(total / 60)
  const s = total - m * 60
  return `${sign}${m}:${String(s).padStart(2, '0')}`
}

/** mm:ss.t with carry-safe rounding (119.96 → "2:00.0", never "1:60.0"). */
export function fmtMmSsTenths(seconds: number): string {
  const sign = seconds < 0 ? '-' : ''
  const tenths = Math.round(Math.abs(seconds) * 10)
  const m = Math.floor(tenths / 600)
  const rem = tenths - m * 600
  return `${sign}${m}:${(rem / 10).toFixed(1).padStart(4, '0')}`
}
```

- [ ] **Step 3: Replace the three local formatters**

- `StatBar.tsx`: delete local `fmtSplit`, import `fmtMmSs` from `../lib/formatDuration`, use it where `fmtSplit` was called.
- `FinishOverlay.tsx`: delete local `fmtMmSs` (signed) and `fmtSplit` (tenths); import and substitute `fmtMmSs` / `fmtMmSsTenths`.
- Check `fmtElapsed` in StatBar — leave it (floor semantics are intentional for a running clock).

- [ ] **Step 4: Run web suite + commit**

```bash
cd web && npx vitest run
git add web/src/lib/formatDuration.ts web/src/lib/formatDuration.test.ts web/src/race/StatBar.tsx web/src/race/FinishOverlay.tsx
git commit -m "fix(race): carry-safe mm:ss formatters shared; no more 1:60 renders"
```

### Task A7: Delete dead `usePhaseBaseline`

`web/src/live/usePhaseBaseline.ts` has zero production consumers (only its own test imports it) and mutates refs during render (StrictMode-unsafe).

- [ ] **Step 1: Verify it is unused**

Run: `cd web && grep -rn "usePhaseBaseline" src --include="*.ts*" | grep -v test | grep -v "usePhaseBaseline.ts"`
Expected: no output.

- [ ] **Step 2: Delete + commit**

```bash
git rm web/src/live/usePhaseBaseline.ts web/src/live/usePhaseBaseline.test.tsx
cd web && npx vitest run
git commit -m "chore(live): delete dead usePhaseBaseline hook"
```

### Task A8: Boot reconciliation survives StrictMode

`useBootReconcile.ts:72-98`: under `<StrictMode>` (dev), effect → cleanup → effect on the same instance sets `cancelled = true` before the fetch resolves and the second run early-returns on `ran.current` — reconciliation silently no-ops in dev.

**Files:**
- Modify: `web/src/live/useBootReconcile.ts`
- Test: `web/src/live/useBootReconcile.test.tsx`

- [ ] **Step 1: Write the failing test** — render the hook, unmount + remount the same component synchronously (StrictMode simulation, or wrap the harness in `<StrictMode>`), resolve the mocked `getSession`, assert `dispatch` was called.

- [ ] **Step 2: Fix** — drop the `cancelled` guard around the dispatch (React 18+ dispatch is safe post-unmount and the reducer's `reset` is idempotent), or reset `ran.current = false` in the effect cleanup so the second StrictMode run re-fetches. Prefer the first (one deletion); keep the `ran` guard so production still fetches once.

- [ ] **Step 3: Run + commit**

```bash
cd web && npx vitest run src/live/useBootReconcile.test.tsx
git add web/src/live/useBootReconcile.ts web/src/live/useBootReconcile.test.tsx
git commit -m "fix(live): boot reconciliation dispatches under StrictMode"
```

### Task A9 (backend): Fix the dead rowerID query — recompute, insights, and race opponents have been silently disabled on the normal session-end path

**Confirmed production bug** (2026-06-10 backend review): `persister.go:243-247` LEFT JOINs `workouts` (plural) — the table is `workout` (migration `0004_workouts.sql`). The whole statement fails to prepare, the error is discarded, and `rowerID` is always `""` on the normal path. Consequences: `stats.OnSessionChange` never fires on normal session end (the B6 janitor sweep is the ONLY recompute path — the original U5 stale-stats mystery), insights are never persisted (prod DB: 13 ended sessions, 0 `session_insights` rows), and `ComputeRaceResult` always falls back to synth ghosts (`rowerID=""` matches no session/PB curves).

**Files:**
- Modify: `backend/internal/storage/persister.go:241-253` (collapse the two queries into one, fixed table name)
- Modify: `backend/internal/storage/race_result.go` (opponent time-base — see Step 3)
- Test: `backend/internal/storage/persister_test.go`

- [ ] **Step 1: Write the failing test** — end a session for a rower with a workout attached; assert the scheduler receives a Trigger (inject a fake scheduler or assert via `Wait` + recompute side effects, following `persister_test.go` patterns) and that `session_insights` rows exist after `applySessionEnd`.

- [ ] **Step 2: Fix — one query, correct table**

```go
	// Pre-load rower + workout context for race result, insights, and
	// the recompute trigger. NOTE: the table is `workout` (singular) —
	// the previous LEFT JOIN to `workouts` failed to prepare and
	// silently disabled all three consumers (2026-06-10 review).
	var rowerID, workoutMode, workoutID string
	if err := p.DB.QueryRowContext(ctx, `
		SELECT s.rower_id, COALESCE(w.mode, ''), COALESCE(s.workout_id, '')
		FROM sessions s
		LEFT JOIN workout w ON w.id = s.workout_id
		WHERE s.id = ?`, e.SessionID).Scan(&rowerID, &workoutMode, &workoutID); err != nil {
		return err
	}
```

Delete the second `raceWorkoutID` query (line 252-253); pass `workoutID` to `ComputeRaceResult`.

- [ ] **Step 3: Fix the opponent time-base BEFORE session-ghosts go live.** Fixing `rowerID` activates session-sourced ghost/PB curves, which exposes a latent bug: opponent `t_sec` comes from `summary_json.samples` in raw storage-rebased time (warmup seconds included), while the user's race time is work-anchored — `gapAtDistance` (`race_result.go:~196-233`) would flatter the user by the opponent's warmup duration. Normalize: in the opponent-curve load (or `gapAtDistance` input prep), subtract the curve's first sample time so both clocks start at 0. Add a test: ghost source session with 60 s warmup → gap unchanged vs the same source without warmup.

- [ ] **Step 4: Run, then note the backfill**

```bash
cd backend && go test ./internal/storage/...
```

Existing sessions' missing insights/PB recomputes self-heal via B6 on next boot — no manual backfill needed, but verify on the Pi after deploy.

```bash
git add backend/internal/storage
git commit -m "fix(storage): rowerID query joined non-existent table — recompute/insights/race opponents were dead on normal session end"
```

### Task A10 (backend): SSE replay gap — subscribe before replaying the ring

`sse.go:86-98` replays `ring.Since(afterID)` and only then calls `b.Subscribe(afterID)`: an event whose write+fanout lands in that window is permanently missed by the client (stroke, `phase_change`, even `session_end`) until the next reconnect. The dispatcher's write-before-fanout invariant only protects subscribe-first readers. Also: on browser-level reconnects the stale `?since=N` query param beats the fresher `Last-Event-ID` header (`parseAfterID` precedence), causing full re-floods.

**Files:**
- Modify: `backend/internal/stream/sse.go`
- Test: `backend/internal/stream/sse_test.go`

- [ ] **Step 1: Failing test** — subscribe a test client, interleave a broadcast between the ring read and subscription (inject via the existing test seams in `sse_test.go`; if no seam exists, restructure the handler so replay/subscribe order is testable), assert no event is lost.

- [ ] **Step 2: Reorder** — `ch := b.Subscribe(afterID)` BEFORE the ring replay; events arriving on `ch` during replay are buffered (64-slot client buffer) and deduped after replay by the existing `e.ID <= afterID` skip in the live loop. Mind the buffer: drain `ch` into a local pending slice if replay is long (ring cap 10000 vs 64-slot buffer — interleave or extend the local buffer during replay).

- [ ] **Step 3: Header precedence** — in `parseAfterID`, prefer the `Last-Event-ID` header over the `?since=` query param when both are present.

- [ ] **Step 4: Run + commit**

```bash
cd backend && go test ./internal/stream/...
git add backend/internal/stream
git commit -m "fix(sse): subscribe before ring replay (no event-loss window); Last-Event-ID beats stale ?since"
```

> Known-issue notes (deliberately out of scope, recorded for a future pass): fresh clients (`afterID=0`) joining a session older than ring retention never see `session_start` from the stream alone (mitigated by `GET /api/v1/session/active`); event IDs can collide across backend restarts because `StartID` seeds from max stroke `global_id` only.

---

## Phase B — Deterministic reducer (`nowMs` on the action)

### Task B1: Stamp arrival time on the dispatched action

`Date.now()` at `reducer.ts:211` and `new Date()` at `:235` make the reducer impure — the blocker for golden-stream replay (ADR-0017). Move the clock read to the dispatch site.

**Files:**
- Modify: `web/src/live/reducer.ts` (action type, stroke case)
- Modify: `web/src/live/useEventSource.ts:61`
- Test: `web/src/live/reducer.test.ts`

- [ ] **Step 1: Write the failing determinism test**

```ts
it('is a pure function of (state, action) when nowMs is supplied', () => {
  const stroke = { kind: 'stroke' as const, id: 3, data: { ...baseStroke(), session_id: 's1' } }
  const a = liveReducer(initialLiveState, { type: 'event', event: stroke, nowMs: 1_000_000 })
  const b = liveReducer(initialLiveState, { type: 'event', event: stroke, nowMs: 1_000_000 })
  expect(a).toEqual(b)
  expect(a.lastStrokeReceivedAtMs).toBe(1_000_000)
  expect(a.sessionStartedAtMs).toBe(1_000_000)
})
```

- [ ] **Step 2: Run to verify failure** (type error on `nowMs` — that counts), **then implement**

In `reducer.ts`:

```ts
export type LiveAction =
  | { type: 'status'; status: ChannelStatus }
  /**
   * nowMs: wall-clock at event arrival, stamped by the dispatcher
   * (useEventSource). Optional for legacy callers/tests; the golden
   * replay harness (ADR-0017) always supplies it so the reducer is a
   * pure fold over the event list.
   */
  | { type: 'event'; event: LiveEvent; nowMs?: number }
  | { type: 'tick'; nowMs: number }
  | { type: 'reset'; summary?: SessionEndSummary | null }
```

In the stroke case, replace `const now = Date.now()` with:

```ts
          const now = action.nowMs ?? Date.now()
```

and replace `started_at: new Date().toISOString(),` (line 235) with:

```ts
                      started_at: new Date(now).toISOString(),
```

In `useEventSource.ts:61`:

```ts
      onEvent: (event) => dispatch({ type: 'event', event, nowMs: Date.now() }),
```

- [ ] **Step 3: Run web suite + commit**

```bash
cd web && npx vitest run
git add web/src/live/reducer.ts web/src/live/useEventSource.ts web/src/live/reducer.test.ts
git commit -m "feat(live): nowMs stamped on dispatch — reducer pure for golden replay (ADR-0017)"
```

---

## Phase C — Golden replay harness (ADR-0017)

### Task C0: Synchronous step seam + injectable session IDs in the Sessionizer

Three review findings force this refactor before the harness: (1) golden byte-stability is impossible while `ulid.Make()` (`sessionizer.go:575`) draws crypto entropy into every wire line's `session_id`; (2) a channel-driven harness that handshakes "1 frame ⇒ 1 stroke" deadlocks the moment Phase D starts swallowing idle frames; (3) the existing test suite's `time.Sleep(50ms)`-before-`clk.Advance` pattern is flake-prone — Phase D's pause tests need a synchronous driver.

**Files:**
- Modify: `backend/internal/session/sessionizer.go`
- Modify: `backend/internal/ipm/parser.go` (export the A8 decoder)
- Test: existing `sessionizer_test.go` suite is the regression net; add a determinism test

- [ ] **Step 1: `Options.NewSessionID`**

```go
	// NewSessionID overrides session-id generation. Defaults to
	// ulid.Make().String(). The golden harness (ADR-0017) injects a
	// deterministic counter so golden JSONL is byte-stable run-to-run.
	NewSessionID func() string
```

Default it in `New()` (like `Now`); use it at `openSessionInternal` (line 575).

- [ ] **Step 2: Refactor the event flow from channel-writes to slice-returns.** Mechanically change `onFrame`, `openSessionInternal`, `closeSession`, `handleAttach` to **return `[]event.Event`** instead of writing to `out` (the `emit` helper becomes `append` + `stamp`). `Run` keeps the exact same select loop but forwards each returned slice to `out`. This is behaviour-preserving; the 1129-line sessionizer suite plus the full backend suite gate it.

- [ ] **Step 3: Export the synchronous single-goroutine API** (documented as mutually exclusive with `Run`):

```go
// OpenSession / ProcessFrame / CloseOpenSession form the synchronous
// driver used by the golden harness (ADR-0017) and unit tests: no
// goroutines, no channels, no sleeps — events come back as the return
// value. Must not be used concurrently with Run.
func (s *Sessionizer) OpenSession(workoutID string) []event.Event
func (s *Sessionizer) ProcessFrame(ctx context.Context, f ipm.Frame) ([]event.Event, error)
func (s *Sessionizer) CloseOpenSession() []event.Event
```

- [ ] **Step 4: Extract the `accumulator` struct** (prepares F3's reset and shrinks `sessionState`'s ~30 fields): move `strokes, totalDistance, totalTime, powerSum, peakPower, spmSum, dpsSum, spiSum, spiCount, paceSum, calSum` into `type accumulator struct`, with `Add(p *event.StrokePayload, workAnchorDist int, workAnchorSec float64)` and `Summary(...) event.SessionSummary` methods. F3's RaceGo reset becomes `st.acc = accumulator{}`.

- [ ] **Step 5: Export the A8 decoder in `ipm`** — the fixture CSVs' pre-decoded columns predate the May-2026 A8 boundary corrections (verified: `session-m1.csv` says `cal_per_hr=560`, the raw payload decodes to 564). The harness must parse `raw_payload` through the production decoder:

```go
// DecodeA8 decodes one raw A8 payload line into a Frame (exported for
// the ADR-0017 golden harness; wraps the internal decoder used by
// FixtureProducer and the serial producer).
func DecodeA8(raw string) (Frame, error)
```

- [ ] **Step 6: Run + commit**

```bash
cd backend && go test ./...
git add backend/internal/session backend/internal/ipm
git commit -m "refactor(session): synchronous step seam, injectable session ids, accumulator struct (ADR-0017 prep)"
```

### Task C1: Go harness — fixtures → Sessionizer → golden JSONL

**Files:**
- Create: `backend/internal/goldenstream/golden_test.go`
- Create: `backend/internal/goldenstream/harness.go`
- Create (generated): `specs/int/fixtures/golden/session-m1.jsonl`, `specs/int/fixtures/golden/session-short.jsonl`

- [ ] **Step 1: Write `harness.go`**

```go
// Package goldenstream is the ADR-0017 deterministic replay harness:
// it replays captured IPM fixtures through the production Sessionizer
// with an injected clock and pins the emitted SSE event stream as
// golden JSONL files committed under specs/int/fixtures/golden/.
// The TS suite (web/src/live/goldenReplay.test.ts) consumes the same
// files — the JSONL is the contract between the two suites.
package goldenstream

import (
	"context"
	"encoding/csv"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"strconv"
	"sync"
	"time"

	"github.com/gloeckner-daniel/splits/internal/event"
	"github.com/gloeckner-daniel/splits/internal/ipm"
	"github.com/gloeckner-daniel/splits/internal/session"
)

// timedFrame pairs a frame with its capture offset from stream start.
type timedFrame struct {
	Offset time.Duration
	Frame  ipm.Frame
}

// timedEvent is one golden JSONL line.
type timedEvent struct {
	AtMs  int64           `json:"at_ms"`
	Event string          `json:"event"`
	ID    uint64          `json:"id"`
	Data  json.RawMessage `json:"data"`
}

// loadFixtureFrames parses a specs/int/fixtures/ipm CSV into frames by
// decoding the raw_payload column (last) through the PRODUCTION A8
// decoder — the pre-decoded CSV columns predate the May-2026 boundary
// corrections and are distrusted, exactly as FixtureProducer.parseRow
// does. This also fills DeviceSplitPaceSec, so the sessionizer takes
// the device-split path it takes on real hardware, and RawPayload.
// Offsets are normalised to the first row's capture_ts (raw capture_ts
// starts at ~60 s of pre-session handshake, which would trip
// IdleTimeout and make session_start timing nondeterministic).
func loadFixtureFrames(path string) ([]timedFrame, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	r := csv.NewReader(f)
	if _, err := r.Read(); err != nil { // header
		return nil, err
	}
	var out []timedFrame
	first := -1.0
	for {
		rec, err := r.Read()
		if err == io.EOF {
			break
		}
		if err != nil {
			return nil, err
		}
		atF, _ := strconv.ParseFloat(rec[0], 64)
		if first < 0 {
			first = atF
		}
		frame, err := ipm.DecodeA8(rec[len(rec)-1]) // raw_payload column
		if err != nil {
			return nil, fmt.Errorf("row at %s: %w", rec[0], err)
		}
		out = append(out, timedFrame{
			Offset: time.Duration((atF - first) * float64(time.Second)),
			Frame:  frame,
		})
	}
	return out, nil
}

// run replays frames through a fresh Sessionizer via the synchronous
// step seam (Task C0): no goroutines, no channels, no handshakes —
// events come back as return values, so swallowed frames (Phase D's
// idle broadcasts) cannot deadlock anything. Single-threaded, so the
// injected clock is a plain variable.
func run(frames []timedFrame, opts session.Options, workoutID string) ([]timedEvent, error) {
	base := time.Unix(1_700_000_000, 0).UTC()
	cur := base
	opts.Now = func() time.Time { return cur }
	seq := 0
	opts.NewSessionID = func() string { seq++; return fmt.Sprintf("GOLDEN-%04d", seq) }

	sz := session.New(opts)
	var evs []timedEvent
	add := func(at time.Duration, es []event.Event) error {
		for _, e := range es {
			data, err := event.Marshal(e)
			if err != nil {
				return err
			}
			evs = append(evs, timedEvent{
				AtMs: at.Milliseconds(), Event: event.EventName(e.Kind),
				ID: e.ID, Data: data,
			})
		}
		return nil
	}

	if err := add(0, sz.OpenSession(workoutID)); err != nil {
		return nil, err
	}
	for _, tf := range frames {
		cur = base.Add(tf.Offset)
		f := tf.Frame
		f.ReceivedAt = cur
		es, err := sz.ProcessFrame(context.Background(), f)
		if err != nil {
			return nil, err
		}
		if err := add(tf.Offset, es); err != nil {
			return nil, err
		}
	}
	last := frames[len(frames)-1].Offset
	if err := add(last, sz.CloseOpenSession()); err != nil {
		return nil, err
	}
	return evs, nil
}
```

(Drop the now-unused `sync` import from the file's import block.)

- [ ] **Step 2: Write `golden_test.go`**

```go
package goldenstream

import (
	"bytes"
	"encoding/json"
	"flag"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/gloeckner-daniel/splits/internal/event"
	"github.com/gloeckner-daniel/splits/internal/session"
)

var update = flag.Bool("update", false, "rewrite golden JSONL files")

const fixtureDir = "../../../specs/int/fixtures/ipm"
const goldenDir = "../../../specs/int/fixtures/golden"

func harnessOpts() session.Options {
	return session.Options{
		IdleTimeout:       60 * time.Second,
		InactivityTimeout: 60 * time.Second, // Phase D renames this; update then
		RowerID:           "golden-rower",
		RowerName:         "Golden",
	}
}

func marshalLines(evs []timedEvent) []byte {
	var buf bytes.Buffer
	enc := json.NewEncoder(&buf)
	for _, e := range evs {
		_ = enc.Encode(e)
	}
	return buf.Bytes()
}

func TestGoldenFixtures(t *testing.T) {
	for _, name := range []string{"session-m1", "session-short"} {
		t.Run(name, func(t *testing.T) {
			frames, err := loadFixtureFrames(filepath.Join(fixtureDir, name+".csv"))
			if err != nil {
				t.Fatal(err)
			}
			evs, err := run(frames, harnessOpts(), "")
			if err != nil {
				t.Fatal(err)
			}

			// Invariant: free-row totals equal the last stroke's rebased
			// distance (storage anchor = first stroke; all strokes work).
			var lastStrokeDist int
			var summaryDist = -1
			for _, e := range evs {
				switch e.Event {
				case "stroke":
					var p struct {
						DistanceM int `json:"distance_m"`
					}
					_ = json.Unmarshal(e.Data, &p)
					lastStrokeDist = p.DistanceM
				case "session_end":
					var p struct {
						Summary struct {
							TotalDistanceM int `json:"total_distance_m"`
						} `json:"summary"`
					}
					_ = json.Unmarshal(e.Data, &p)
					summaryDist = p.Summary.TotalDistanceM
				}
			}
			if summaryDist != lastStrokeDist {
				t.Errorf("work-only totals: summary %d != last stroke %d", summaryDist, lastStrokeDist)
			}
			// Correctness, not just stability: pin exact totals derived
			// from the capture itself (hardware truth — the raw payloads
			// ARE what the console displayed; INT-0001 documents
			// session-m1 as 20 strokes / 163 m / 48 s). Compute the
			// expected value per fixture as lastCSVDistance − firstCSVDistance
			// (storage anchor = first frame) BY HAND from the decoded
			// payloads and hard-code it here; do not copy it from the
			// harness output, or the assertion is circular.
			if want := expectedWorkDistance[name]; summaryDist != want {
				t.Errorf("summary distance %d != hand-derived capture truth %d", summaryDist, want)
			}

			got := marshalLines(evs)
			goldenPath := filepath.Join(goldenDir, name+".jsonl")
			if *update {
				if err := os.MkdirAll(goldenDir, 0o755); err != nil {
					t.Fatal(err)
				}
				if err := os.WriteFile(goldenPath, got, 0o644); err != nil {
					t.Fatal(err)
				}
				return
			}
			want, err := os.ReadFile(goldenPath)
			if err != nil {
				t.Fatalf("golden missing (run with -update): %v", err)
			}
			if !bytes.Equal(got, want) {
				t.Errorf("golden mismatch for %s — if the wire change is intentional, regenerate with `go test ./internal/goldenstream -update` and review the diff", name)
			}
			_ = event.EventName // keep import if unused after edits
		})
	}
}
```

- [ ] **Step 2b: Add a WORKOUT golden fixture — without it every phase assertion downstream is vacuous.** The free-row fixtures produce zero `phase_change` events, so neither the goldens nor the TS consumer would exercise warmup offsets, the B5 anchor, or the A1 fix at the contract level. Add a subtest replaying `session-m3-long.csv` with a stubbed workout:

```go
	opts := harnessOpts()
	opts.LoadWorkout = func(id string) (*workout.Workout, error) {
		return &workout.Workout{
			ID: id, Mode: workout.ModeDistance,
			ParamsJSON: []byte(`{"meters":700}`),
			WarmupSec:  60, CooldownSec: 30,
		}, nil
	}
	evs, err := run(frames, opts, "golden-w1")
```

Golden file `session-m3-long-w700.jsonl`. Assertions: the event stream contains `phase_change` warmup→work and work→cooldown; every stroke's `phase` matches the latest `phase_change`; summary `total_distance_m` counts work strokes only (hand-derive: distance at cooldown entry − distance at work entry ≈ 700, exact value pinned after manual derivation from the CSV); the session closes via `PhaseDone` (cooldown elapsed), not EOF.

- [ ] **Step 3: Run twice — determinism check — and generate goldens**

```bash
cd backend && go test ./internal/goldenstream -update && go test ./internal/goldenstream && go test ./internal/goldenstream
```
Expected: second and third runs PASS (byte-identical output run-to-run). If they differ, find the wall-clock leak before proceeding — that is the harness's whole point.

- [ ] **Step 4: Commit (golden files included)**

```bash
git add backend/internal/goldenstream specs/int/fixtures/golden
git commit -m "feat(goldenstream): ADR-0017 Go harness — fixtures through Sessionizer to golden JSONL"
```

### Task C2: Extract the pure phase-relative helper from `useLiveDisplay`

**Files:**
- Modify: `web/src/live/useLiveDisplay.ts` (extract; hook behaviour unchanged)
- Test: `web/src/live/useLiveDisplay.test.tsx`

- [ ] **Step 1: Add the pure function + test**

In `useLiveDisplay.ts` (exported, near the phased hooks):

```ts
/**
 * Pure core of usePhasedDistance / usePhasedTime: the phase-relative
 * value, or the absolute value when no phase context exists (free row,
 * or anchor not yet latched). Exported for the golden replay suite.
 */
export function phaseRelative(
  value: number,
  phase: LiveState['phase'],
  anchor: LiveState['phaseAnchor'],
  key: 'distanceM' | 'timeSec',
): number {
  if (phase === null || anchor === null) return value
  return Math.max(0, value - anchor[key])
}
```

Rewrite the body of `usePhasedDistance` (lines ~174-184) and `usePhasedTime` (~192-202) to call `phaseRelative(e.value, phase, anchor, 'distanceM' | 'timeSec')` instead of the inline expression. Test:

```ts
describe('phaseRelative', () => {
  it('falls back to absolute without an anchor', () => {
    expect(phaseRelative(1500, 'work', null, 'distanceM')).toBe(1500)
  })
  it('subtracts the anchor and clamps at zero', () => {
    expect(phaseRelative(1500, 'work', { distanceM: 400, timeSec: 120 }, 'distanceM')).toBe(1100)
    expect(phaseRelative(390, 'work', { distanceM: 400, timeSec: 120 }, 'distanceM')).toBe(0)
  })
})
```

- [ ] **Step 2: Run + commit**

```bash
cd web && npx vitest run
git add web/src/live/useLiveDisplay.ts web/src/live/useLiveDisplay.test.tsx
git commit -m "refactor(live): extract pure phaseRelative for golden replay assertions"
```

### Task C3: TS golden consumer — replay JSONL through the real reducer

**Files:**
- Create: `web/src/live/goldenReplay.test.ts`

- [ ] **Step 1: Write the consumer test**

```ts
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect } from 'vitest'
import { liveReducer, initialLiveState, type LiveState } from './reducer'
import type { LiveEvent } from './events'
import { phaseRelative } from './useLiveDisplay'

// The golden JSONL files are the ADR-0017 contract with the Go suite
// (backend/internal/goldenstream). Regenerate via
// `cd backend && go test ./internal/goldenstream -update`.
const GOLDEN_DIR = join(__dirname, '../../../specs/int/fixtures/golden')

type GoldenLine = { at_ms: number; event: string; id: number; data: Record<string, unknown> }

function readGolden(file: string): GoldenLine[] {
  return readFileSync(join(GOLDEN_DIR, file), 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as GoldenLine)
}

const BASE_MS = 1_700_000_000_000 // matches the Go harness clock base

describe('golden replay through the live reducer (ADR-0017)', () => {
  const files = readdirSync(GOLDEN_DIR).filter((f) => f.endsWith('.jsonl'))
  it('has golden files to replay', () => {
    expect(files.length).toBeGreaterThan(0)
  })

  for (const file of files) {
    it(`replays ${file} deterministically with correct display invariants`, () => {
      const lines = readGolden(file)
      let state: LiveState = initialLiveState
      let lastSummary: Record<string, unknown> | null = null

      for (const line of lines) {
        const ev = { kind: line.event, id: line.id, data: line.data } as LiveEvent
        state = liveReducer(state, { type: 'event', event: ev, nowMs: BASE_MS + line.at_ms })

        if (line.event === 'stroke') {
          const d = line.data as { distance_m: number; phase?: string }
          // Hardware truth (ADR-0017): the wire distance IS the console
          // display (cumulative, session-rebased). The phase-relative
          // display value must never exceed it and never go negative.
          const shown = phaseRelative(d.distance_m, state.phase, state.phaseAnchor, 'distanceM')
          expect(shown).toBeGreaterThanOrEqual(0)
          expect(shown).toBeLessThanOrEqual(d.distance_m)
          // The reducer's phase mirrors the stroke's stamped phase.
          if (d.phase) expect(state.phase).toBe(d.phase)
        }
        if (line.event === 'phase_change') {
          const d = line.data as { from: string; to: string; at_distance_m: number }
          expect(state.phaseAnchor?.distanceM).toBe(d.at_distance_m)
          if (d.from === 'warmup' && d.to === 'work') {
            expect(state.workStartDistanceM).toBe(d.at_distance_m)
          }
        }
        if (line.event === 'session_end') {
          lastSummary = (line.data as { summary: Record<string, unknown> }).summary
        }
      }
      // Final state carries the work-only summary verbatim.
      expect(state.summary).toEqual(lastSummary)
    })
  }
})
```

- [ ] **Step 2: Run, fix type frictions, commit**

Run: `cd web && npx vitest run src/live/goldenReplay.test.ts`
Expected: PASS against the Phase C1 goldens. (If vitest's environment for this file needs node FS access, add `// @vitest-environment node` as the first line.)

```bash
git add web/src/live/goldenReplay.test.ts
git commit -m "test(live): TS golden consumer replays ADR-0017 JSONL through the real reducer"
```

---

## Phase D — Pause / auto-resume sub-state (CONTEXT.md §Pause / Abort)

Decisions already recorded in CONTEXT.md: auto-resume on next distance-advancing frame; hard close only after the 15-minute resume window; the work clock stops while paused; phase countdowns halt; race mode unchanged.

### Task D1: Pause events on the wire

**Files:**
- Modify: `backend/internal/event/event.go` (Kind constants + payload struct — locate the Kind list with `grep -n "Kind" backend/internal/event/event.go | head -30`)
- Modify: `backend/internal/event/wire.go` (EventName + Marshal)
- Modify: `web/src/live/events.ts`, `web/src/live/channel.ts`
- Test: existing wire tests (`grep -rln "EventName" backend/internal/event/*_test.go`)

- [ ] **Step 1: Backend event kinds + payload**

In `event.go`, **appended after `KindSessionFinalized`** (the enum is `iota+1`; numeric kinds aren't persisted anywhere, but append anyway so existing values never shift):

```go
	KindSessionPaused
	KindSessionResumed
```

Extend `TestEventNameMatrix` (`wire_test.go:~97`) with both new names — it is the guard against the EventName/Marshal split-brain (a kind with a name but no Marshal case sends clients an empty `data:` line).

payload (one struct serves both):

```go
// SessionPausePayload carries the work-clock time at which the pause
// began (session_paused) or from which rowing resumed (session_resumed).
// CONTEXT.md §Pause / Abort: the work clock stops while paused, so the
// resumed event carries the same at_time_sec the pause began with.
type SessionPausePayload struct {
	AtTimeSec float64
}
```

Add `SessionPause *SessionPausePayload` to the `Event` struct.

In `wire.go` `EventName`:

```go
	case KindSessionPaused:
		return "session_paused"
	case KindSessionResumed:
		return "session_resumed"
```

In `Marshal`:

```go
	case KindSessionPaused, KindSessionResumed:
		p := e.SessionPause
		return json.Marshal(sessionPauseWire{
			SessionID: e.SessionID,
			AtTimeSec: p.AtTimeSec,
		})
```

with:

```go
type sessionPauseWire struct {
	SessionID string  `json:"session_id"`
	AtTimeSec float64 `json:"at_time_sec"`
}
```

- [ ] **Step 2: Frontend types + channel registration**

`web/src/live/events.ts`:

```ts
export type SessionPausePayload = {
  session_id: string
  at_time_sec: number
}
```

Add `'session_paused' | 'session_resumed'` to the kind union and the two variants to `LiveEvent`:

```ts
  | { kind: 'session_paused'; id: number; data: SessionPausePayload }
  | { kind: 'session_resumed'; id: number; data: SessionPausePayload }
```

`web/src/live/channel.ts` after `handle('phase_change')`:

```ts
    handle('session_paused')
    handle('session_resumed')
```

Extend the Task A1 per-kind registration test's `wireKinds` list with both names.

- [ ] **Step 3: Reducer handling + test**

`reducer.ts`: add `serverPaused: boolean` to `LiveState` (init `false`; reset to `false` in `session_start`, the implicit-new-session base state, and `reset`), and:

```ts
        case 'session_paused':
          if (state.session && ev.data.session_id !== state.session.session_id) return state
          return state.serverPaused ? state : { ...state, serverPaused: true }

        case 'session_resumed':
          if (state.session && ev.data.session_id !== state.session.session_id) return state
          return state.serverPaused ? { ...state, serverPaused: false } : state
```

Test in `reducer.test.ts`: paused → `serverPaused === true`; resumed → `false`; mismatched session id ignored. Plus a hydration-compat case: a sessionStorage snapshot persisted by the previous deploy (build a `LiveState` JSON **without** the `serverPaused` key, mirroring `useEventSource.hydrate`) must not break pause display — `undefined` is falsy, but pin it so the next field whose check is `=== false` doesn't regress silently.

- [ ] **Step 4: Run both suites, commit**

```bash
cd backend && go test ./internal/event/... && cd ../web && npx vitest run
git add backend/internal/event web/src/live/events.ts web/src/live/channel.ts web/src/live/reducer.ts web/src/live/reducer.test.ts web/src/live/channel.eventsource.test.ts
git commit -m "feat(pause): session_paused/session_resumed events end to end"
```

### Task D2: Sessionizer pause state machine

**Files:**
- Modify: `backend/internal/session/sessionizer.go`
- Test: `backend/internal/session/sessionizer_test.go`

- [ ] **Step 1: Write the failing tests** (follow the existing test file's frame-driving helpers — it has 1129 lines of patterns for fake-clock frame injection):

One named test per policy — each must fail before its policy lands:

```go
// TestPause_AutoResumeWithinWindow: 10 strokes, 90 s of idle
// broadcasts, 10 strokes. NO session_end mid-stream; exactly one
// session_paused + one session_resumed; TotalTimeSec excludes the
// pause; TotalDistanceM counts all 20 strokes (minus anchor stroke).

// TestPause_ClosesAfterResumeWindow: strokes, then idle broadcasts
// past ResumeWindow. session_end with totals from the last REAL
// (distance-advancing) stroke — not the last idle broadcast.

// TestPause_FrameGapTreatedAsPause: strokes, NO frames for 3 min
// (wall clock advanced), strokes. Session survives; the post-gap
// stroke's TimeSec continues from the pre-gap work clock.

// TestIdleBroadcasts_NeverStrokes (policy a): a work session
// containing idle broadcasts emits no stroke events for them and
// AvgPowerW/AvgSPM equal the average over real strokes only.

// TestPause_NeverArmsDuringCooldown (policy b): workout with
// cooldown; rower idles through it. No session_paused; the session
// closes when the cooldown elapses (PhaseDone), exactly as today.

// TestPause_PhaseAnchorsInAdjustedDomain (policy c — the reviewer's
// bug scenario): free row → 120 s pause → resume → AttachWorkout
// with a 30 s warmup. The warmup completes after 30 s of rowing,
// not 150 s — Classify never sees the accumulated pause.

// TestPause_NoPhantomResume (policy d): session opened by Start,
// idle broadcasts only, then the first real stroke. No
// session_resumed is emitted.

// TestPause_StartClosesPausedSession (policy e): pause, then
// StartSession. The paused session closes and a fresh one opens —
// the start is not silently dropped.

// TestSnapshot_CarriesPauseState (policy f): after pause,
// Snapshot() includes the session_paused event; after resume (and
// after close) it does not.
```

Write all of them concretely against the helpers (use the C0 synchronous seam — `OpenSession`/`ProcessFrame` — instead of the legacy sleep-and-drain pattern); add an `idleFrame(timeSec, distanceM, level)` helper next to `frame()`.

- [ ] **Step 2: Run to verify failures**

Run: `cd backend && go test ./internal/session -run TestPause -v`
Expected: FAIL (sessions close at 60 s today).

- [ ] **Step 3: Implement**

`Options` — replace `InactivityTimeout` with:

```go
	// PauseTimeout: distance frozen (or no frames) for this long puts
	// the open session into Paused (CONTEXT.md §Pause / Abort) instead
	// of closing it. Zero disables pause detection (legacy tests).
	PauseTimeout time.Duration
	// ResumeWindow: a session continuously paused for this long is
	// closed for good. The stale-open threshold must not undercut it.
	ResumeWindow time.Duration
```

`sessionState` additions:

```go
	// Pause sub-state (CONTEXT.md §Pause / Abort). pausedSinceWall is
	// zero when not paused. pausedAtWorkSec is the work-clock TimeSec
	// of the last stroke before the pause. pausedAccumSec is total
	// device-time excluded from the work clock; every emitted stroke's
	// TimeSec is reduced by it, so phase classification, totals, PB
	// windows, and the wire all see a clock that stops during pauses.
	pausedSinceWall time.Time
	pausedAtWorkSec float64
	pausedAccumSec  float64
```

`onFrame` — replace the two close guards (lines 317-327) with:

```go
	if s.session != nil {
		idleFor := now.Sub(s.session.lastSeen)
		inactiveFor := now.Sub(s.session.lastActivity)
		window := s.opts.ResumeWindow
		if window <= 0 {
			window = s.opts.IdleTimeout // legacy behaviour when unconfigured
		}
		if idleFor >= window || inactiveFor >= window {
			if err := s.closeSession(ctx, out); err != nil {
				return err
			}
		} else if s.session.pausedSinceWall.IsZero() && s.opts.PauseTimeout > 0 &&
			(idleFor >= s.opts.PauseTimeout || inactiveFor >= s.opts.PauseTimeout) {
			if err := s.enterPause(ctx, now, out); err != nil {
				return err
			}
		}
	}
```

New method:

```go
// enterPause flips the open session into the Paused sub-state and
// announces it. The work clock freezes at the last stroke's TimeSec.
func (s *Sessionizer) enterPause(ctx context.Context, now time.Time, out chan<- event.Event) error {
	st := s.session
	st.pausedSinceWall = now
	if st.lastStroke != nil {
		st.pausedAtWorkSec = st.lastStroke.TimeSec
	}
	return s.emit(ctx, out, event.Event{
		Kind:         event.KindSessionPaused,
		SessionID:    st.id,
		SessionPause: &event.SessionPausePayload{AtTimeSec: st.pausedAtWorkSec},
	})
}
```

**Implementation policy (amended after the 2026-06-10 backend review — the original draft had four bugs here):**

(a) **Idle frames are never strokes.** Today every distance-frozen idle broadcast is emitted and, in the work phase, accumulated (`strokes++`, `powerSum+=0`, totalTime advances) — an existing bug that dilutes AvgPowerW/AvgSPM and would corrupt the pause arithmetic (`pausedAtWorkSec` would latch an idle stroke's time). New rule, applied whether paused or not: a frame whose rebased `DistanceM` does not exceed `lastStroke.DistanceM` updates `lastSeen`, is **not** enriched/emitted/accumulated (no `strokeSeq` increment), but — when not paused — is still run through `Classify` with the adjusted clock so `phase_change` and cooldown-elapsed completion stay timely. While paused, idle frames update `lastSeen` only.

(b) **Pause never enters during Cooldown.** §Session end requires the session to auto-close when cooldown elapses even if the rower walked away; pausing there would trap them for the ResumeWindow. Cooldown idleness flows to completion as today. **Edit CONTEXT.md §Pause / Abort accordingly** ("Phase countdowns halt while paused" → warmup/rest only; a pause during cooldown does not arm — cooldown idleness is expected and ends the session per §Session end). Flag this in the PR description — it narrows a recorded decision.

(c) **Phase anchors live in the adjusted, session-relative domain.** The current code latches `phaseAnchorDistance/TimeSec` from raw absolute device values (line 358-361) and the draft subtracted `pausedAccumSec` afterwards — mixing domains: a re-anchor (attach, RaceGo) after a pause would feed `Classify` a time offset wrong by the whole accumulated pause. Change the latch to store **rebased + pause-adjusted** values (latch after the rebase and the `f.TimeSec -= pausedAccumSec` adjustment, from `f` directly), and change line 375-377 to `Classify(stroke.DistanceM - s.session.phaseAnchorDistance, stroke.TimeSec - s.session.phaseAnchorTimeSec)` with the storage-anchor subtraction removed from the offset math (both operands are now session-relative adjusted). The `absDist/absTime` capture at line 352 becomes unnecessary — delete it.

(d) **Resume requires a real previous stroke.** Guard the resume branch on `s.session.lastStroke != nil` — a session opened by Start that has seen only idle broadcasts must not emit a phantom `session_resumed` on its first real stroke.

(e) **A paused session must not block an explicit Start.** In the `startC` handler (line 233-245), treat a paused session as closeable: `if now.Sub(s.session.lastSeen) < s.opts.IdleTimeout && s.session.pausedSinceWall.IsZero() { continue }` — otherwise a rower who walked away and comes back to tap Start would be silently ignored for up to 15 minutes.

(f) **The snapshot trio becomes a quartet.** Add `currentSessionPaused *event.Event` next to `currentPhaseChange`: set on pause, cleared on resume/close/ClearActiveSession, returned by `Snapshot()`. Without it, a client reconnecting mid-pause (screen-lock during the phone call — the exact scenario) never learns `serverPaused`.

With (a) in place the pause/resume core (inserted after the rebase, before `enrich`) simplifies to:

```go
	// Idle frame (no distance progress): never a stroke. See policy (a).
	prevDist := -1
	if s.session.lastStroke != nil {
		prevDist = s.session.lastStroke.DistanceM
	}
	idle := s.session.lastStroke != nil && f.DistanceM <= prevDist
	if idle {
		s.session.lastSeen = now
		if !s.session.pausedSinceWall.IsZero() {
			return nil
		}
		// Not paused: classify with the adjusted clock so warmup/rest
		// transitions and cooldown-elapsed completion stay timely.
		adjTime := f.TimeSec - s.session.pausedAccumSec
		return s.classifyIdle(ctx, f.DistanceM, adjTime, out)
	}
	if !s.session.pausedSinceWall.IsZero() {
		// Distance advanced while paused → resume. The device time that
		// elapsed during the pause is excluded from the work clock, so
		// the resuming stroke lands at the work-second the pause began.
		pausedDevice := (f.TimeSec - s.session.pausedAccumSec) - s.session.pausedAtWorkSec
		if pausedDevice > 0 {
			s.session.pausedAccumSec += pausedDevice
		}
		s.session.pausedSinceWall = time.Time{}
		s.clearPausedSnapshot()
		if err := s.emit(ctx, out, event.Event{
			Kind:         event.KindSessionResumed,
			SessionID:    s.session.id,
			SessionPause: &event.SessionPausePayload{AtTimeSec: s.session.pausedAtWorkSec},
		}); err != nil {
			return err
		}
	} else if s.session.lastStroke != nil {
		// Frame-gap pause that never saw idle broadcasts (device went
		// quiet entirely): exclude gaps > PauseTimeout from the clock.
		gap := (f.TimeSec - s.session.pausedAccumSec) - s.session.lastStroke.TimeSec
		if s.opts.PauseTimeout > 0 && gap > s.opts.PauseTimeout.Seconds() {
			s.session.pausedAccumSec += gap
			at := s.session.lastStroke.TimeSec
			for _, k := range []event.Kind{event.KindSessionPaused, event.KindSessionResumed} {
				if err := s.emit(ctx, out, event.Event{
					Kind: k, SessionID: s.session.id,
					SessionPause: &event.SessionPausePayload{AtTimeSec: at},
				}); err != nil {
					return err
				}
			}
		}
	}
	// The work clock: device time minus accumulated pause time. All
	// downstream consumers (phase plan, accumulate, wire, DB, PB
	// windows) see a clock that stops while the rower is stopped.
	f.TimeSec -= s.session.pausedAccumSec
```

`classifyIdle` runs the `Classify` + phase-change-emission + `if complete { closeSession }` portion of `onFrame` against an idle frame's values without producing a stroke (extract that portion into a helper both paths share). `enterPause` additionally must check `s.session.currentPhase != PhaseCooldown` per policy (b), and set `currentSessionPaused` per policy (f). Two accepted, documented residuals: the resume stroke's `StrokeCycleSec`/`EnergyJoules` are 0 (its adjusted time equals the pause-start time — ~2 s undercount per pause), and the frame-gap branch is robust whether the device timer ticks or freezes during the gap (gap computes ~0 if frozen).

- [ ] **Step 4: Fix compilation fallout**

`cmd/splits/main.go:130`: replace `InactivityTimeout: 60 * time.Second,` with:

```go
		PauseTimeout: 10 * time.Second,
		ResumeWindow: cfg.ResumeWindow,
```

`cmd/replay/main.go:121-122` also sets `InactivityTimeout` — update it too. Then `grep -rn "InactivityTimeout" backend/` for the rest (tests asserting the old close-at-60s behaviour become pause-behaviour tests or set `PauseTimeout: 0, ResumeWindow: 60 * time.Second` to retain legacy semantics where the test is about something else). Note: existing tests asserting average power/SPM over sessions containing idle broadcasts will shift — the idle strokes no longer dilute averages (policy (a) fixes a real bug); update expectations, don't preserve the dilution.

- [ ] **Step 5: Run, commit**

```bash
cd backend && go test ./...
git add backend/internal/session backend/cmd/splits/main.go
git commit -m "feat(pause): Paused sub-state — auto-resume, stop-the-clock, 15-min resume window"
```

### Task D3: Config knob + stale-open alignment

**Files:**
- Modify: `backend/internal/config/config.go` (+ test)
- Modify: `backend/cmd/splits/main.go`
- Modify: stale-open threshold (locate: `grep -rn "stale" backend/internal/storage/*.go | grep -i "minute\|threshold\|5"`)

- [ ] **Step 1: Add `SPLITS_RESUME_WINDOW` (default `15m`) to config.go**, following the existing `SPLITS_IDLE_TIMEOUT` parse pattern exactly (same `get2`/`ParseDuration`/error shape), storing `c.ResumeWindow`. Add a config test mirroring the IdleTimeout ones.

- [ ] **Step 2: Align the stale-open threshold.** Find the stale janitor's `5 * time.Minute` (or equivalent) and replace it with the configured ResumeWindow passed down from `main.go` (CONTEXT.md §Stale-open: "a merely-paused session is never stale-open"). Update its tests' injected threshold accordingly.

- [ ] **Step 3: Run, commit**

```bash
cd backend && go test ./...
git add backend/internal/config backend/internal/storage backend/cmd/splits/main.go
git commit -m "feat(pause): SPLITS_RESUME_WINDOW config; stale-open threshold aligned to resume window"
```

### Task D4: Frontend Pausiert state

**Files:**
- Modify: `web/src/live/useLiveDisplay.ts` (`useIsLivePaused`)
- Modify: `web/src/pages/LiveHero.tsx` (passive indicator)
- Test: `web/src/live/useLiveDisplay.test.tsx`

- [ ] **Step 1: OR the server signal into pause detection**

In `useIsLivePaused`, change the final return to:

```ts
  if (state.serverPaused) return true
  const last = state.lastStrokeReceivedAtMs
  if (last === null) return true
  return Date.now() - last >= smoothingConfig.deadReckoning.pauseThresholdMs
```

(The local heuristic stays — it reacts in ~4 s while the backend announces at 10 s.)

- [ ] **Step 2: Passive "Pausiert" chip in LiveHero** — render a small text badge when `useIsLivePaused(state)` is true, styled per the existing hero badge patterns in `LiveHero.module.css` / `WorkProgressBadge`. No modal, no interruption (the PauseDialog behaviour is unchanged — the user accepted it).

- [ ] **Step 3: Test + run + commit**

Test: `serverPaused: true` ⇒ `useIsLivePaused` returns true even with a fresh `lastStrokeReceivedAtMs`.

```bash
cd web && npx vitest run
git add web/src/live/useLiveDisplay.ts web/src/live/useLiveDisplay.test.tsx web/src/pages/LiveHero.tsx
git commit -m "feat(pause): surface backend Pausiert state in live view"
```

### Task D5: Synthetic pause fixture in the golden harness

**Files:**
- Modify: `backend/internal/goldenstream/golden_test.go` (+ `harness.go` helper)
- Create (generated): `specs/int/fixtures/golden/session-synth-pause.jsonl`

- [ ] **Step 1: Add the synthetic frame generator** to `harness.go`:

```go
// synthPauseFrames models the CONTEXT.md §Pause scenario the real
// capture will eventually replace (ADR-0017 fixture-gap note):
// 20 strokes @ 2 s / 10 m, then 90 s of idle broadcasts every 2 s
// (distance frozen, device timer assumed ticking), then 20 strokes.
func synthPauseFrames() []timedFrame {
	var out []timedFrame
	at := 0.0
	dist := 0
	devT := 0.0
	stroke := func() {
		at += 2; devT += 2; dist += 10
		out = append(out, timedFrame{
			Offset: time.Duration(at * float64(time.Second)),
			Frame:  ipm.Frame{TimeSec: devT, DistanceM: dist, SPM: 24, PowerW: 150, CalPerHr: 800, Level: 3},
		})
	}
	idle := func() {
		at += 2; devT += 2
		out = append(out, timedFrame{
			Offset: time.Duration(at * float64(time.Second)),
			Frame:  ipm.Frame{TimeSec: devT, DistanceM: dist, SPM: 0, PowerW: 0, CalPerHr: 0, Level: 3},
		})
	}
	for i := 0; i < 20; i++ { stroke() }
	for i := 0; i < 45; i++ { idle() }
	for i := 0; i < 20; i++ { stroke() }
	return out
}
```

- [ ] **Step 2: Add the golden subtest** with pause-specific assertions: exactly one `session_paused` and one `session_resumed`; **no** `session_end` before the final one; final summary `total_distance_m == 390` and `total_time_sec == 76` — exact, derived as follows: the first stroke (10 m, devT 2 s) is the storage/work anchor (rebased to 0/0, matching the convention pinned by `TestSessionizerSummaryWorkOnlyTotals`); stroke 20 sits at 190 m / 38 s work-clock; the 45 idle broadcasts are swallowed (policy (a)) and pause enters at +10 s; the resume stroke lands at work-second 38; stroke 40 = 390 m / 76 s. NOT ≈ 170 s. Use `harnessOpts()` with `PauseTimeout: 10 * time.Second, ResumeWindow: 15 * time.Minute`. Generate with `-update`.

- [ ] **Step 3: Verify the TS consumer handles the new golden** (it auto-discovers `*.jsonl`): `cd web && npx vitest run src/live/goldenReplay.test.ts` — the `session_paused`/`session_resumed` lines must round-trip the reducer (Task D1 done).

- [ ] **Step 4: Commit**

```bash
git add backend/internal/goldenstream specs/int/fixtures/golden/session-synth-pause.jsonl
git commit -m "test(pause): synthetic pause golden — auto-resume + stop-the-clock pinned (ADR-0017)"
```

> When the real erg capture lands (idle ≥2 min + warmup/pause workout, per ADR-0017), convert it to a CSV fixture, swap `synthPauseFrames` for the file, regenerate goldens, and remove the "assumed ticking" caveat from CONTEXT.md.

### Task D6: E2E — the phone-call scenario (ADR-0014 gate)

Pause/auto-resume is the headline user-facing behavior of this plan; per ADR-0014 it needs a Playwright slice gate, not just Go-level evidence. `ipm.FixtureProducer` already has `Pause()`/`Resume()` and the e2e harness rebuilds the backend per process — the hooks exist.

**Files:**
- Create: `web/e2e/pause-resume.spec.ts` (follow the existing e2e patterns — `grep -rln "seedRower" web/e2e | head -3` for the canonical setup)
- Modify (if needed): the e2e fixture-control endpoint so the spec can trigger `FixtureProducer.Pause()`/`Resume()` mid-replay (check `SPLITS_FIXTURE_PAUSED` and any existing dev-mode control route first)

- [ ] **Step 1: Write the scenario** — start a workout, row past warmup into work, pause the fixture for longer than `PauseTimeout` (run the backend with a short `ResumeWindow` for the negative case). Assert: (a) the "Pausiert" indicator appears; (b) NO session-ended overlay and NO navigation away from the live surface; (c) on resume, the hero distance continues from its pre-pause value and the work countdown continues from where it halted; (d) after session end, the summary totals exclude the pause duration.
- [ ] **Step 2: Negative case** — pause past the (shortened) `ResumeWindow`; assert the session closes and the post-session surface appears.
- [ ] **Step 3: Run the e2e suite + the ADR-0014 critic, commit**

```bash
git add web/e2e
git commit -m "test(e2e): pause mid-work auto-resumes without disruption (ADR-0014 gate for Phase D)"
```

---

## Phase E — PB accuracy: distance candidates work-only

### Task E1: Re-pin `ComputeCandidates` distance candidates to work strokes

B1's warmup-inclusion workaround predates B5; post-B5 the work phase contains the full goal distance, and CONTEXT.md ("Only Work-phase strokes count toward PBs") plus the 2026-06-10 decision make warmup inclusion a correctness bug: a hard warmup can donate meters and time to a "distance PB".

**Files:**
- Modify: `backend/internal/stats/candidates.go:115-129`
- Modify: `backend/internal/storage/persister.go:236-239` (comment only)
- Modify: `backend/internal/storage/stale_janitor.go:231-234` (comment claims warmup is "needed as headroom" — now false)
- Test: `backend/internal/stats/candidates_test.go` (or wherever `TestComputeCandidatesB1_*` live — `grep -rln "B1_" backend/internal/stats`)

- [ ] **Step 1: Write the failing test**

```go
// TestComputeCandidates_DistanceExcludesWarmup: a fast 500 m warmup
// followed by slower 500 m of work must produce a 500 m candidate from
// the WORK strokes only — the warmup sprint must not become the PB.
```

Construct strokes with `Phase: "warmup"` covering 0–500 m at 1:40 pace and `Phase: "work"` covering 500–1000 m at 2:10 pace; assert the 500 m distance candidate's time corresponds to the work window (≈130 s), not the warmup (≈100 s).

- [ ] **Step 2: Run to verify failure, then implement**

In `ComputeCandidates`:

```go
	// Distance candidates are work-only. The B1-era warmup inclusion
	// (warmup as headroom) is retired: since B5, distance goals are
	// measured post-warmup, so the work phase always contains the full
	// goal distance. CONTEXT.md §Workout phases: "Only Work-phase
	// strokes count toward PBs." Empty-string phase keeps legacy
	// pre-phase-tagging strokes eligible.
	distanceStrokes := keepPhases(strokes, "", "work")
```

Update the function doc comment (lines 99-113) to match. In `persister.go:236-238`, update the comment to: "ComputeCandidates filters phases internally (work-only for every candidate type; legacy untagged strokes pass)."

- [ ] **Step 3: Flip the B1 regression tests**

`TestComputeCandidatesB1_FivekGoalReachableAcrossWarmupBoundary` asserted the old workaround. Rewrite it as `TestComputeCandidates_PreB5SessionsYieldNoOversizedCandidate`: with warmup eating headroom (work span < 5000 m), NO 5000 m candidate is produced — and add a comment that pre-B5 DB sessions affected by this lose synthetic 5 km PBs on the next recompute *by design* (accuracy over retention, user decision 2026-06-10).

- [ ] **Step 4: Run, update CONTEXT.md, commit**

```bash
cd backend && go test ./internal/stats/... ./internal/storage/...
```

Append to CONTEXT.md §PB-leader (or §Workout phases) one sentence: "Distance PB candidates are work-only (B1's warmup-headroom workaround retired 2026-06-10; B5 guarantees the goal fits inside the work phase)."

```bash
git add backend/internal/stats backend/internal/storage/persister.go CONTEXT.md
git commit -m "fix(stats): distance PB candidates are work-only — warmup can no longer enter a PB"
```

---

## Phase F — Race correctness

### Task F1: Same-domain GO detection (`goFired`), fixing the clock-domain clamp

`RaceFlow.tsx:246` compares device-seconds (`stroke.time_sec * 1000`) against a `performance.now()`-domain `race_t0` — broken by design. Replace with reducer-owned `goFired`, set by `tick` in the same clock domain that set `race_t0`.

**Files:**
- Modify: `web/src/race/raceLifecycle.ts`
- Modify: `web/src/race/RaceFlow.tsx:241-248`
- Modify: `web/src/race/useRaceLifecycle.ts` (tick loop gating — read the file first)
- Test: `web/src/race/raceLifecycle.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
it('goFired flips when a tick reaches race_t0 during a Falschstart', () => {
  let s = initialRaceLifecycle({ totalMeters: 500 })
  s = raceLifecycle(s, { type: 'confirm' })
  s = raceLifecycle(s, { type: 'bereitTap', t: 100_000 }) // race_t0 = 103_000
  s = raceLifecycle(s, { type: 'stroke', t: 1, dist: 3, userDistance: 3, total: 500, nowMs: 101_000 })
  expect(s.liveKind).toBe('Falschstart')
  expect(s.goFired).toBe(false)
  s = raceLifecycle(s, { type: 'tick', nowMs: 103_100 })
  expect(s.goFired).toBe(true)
  expect(s.goAnchor).toEqual({ t: 1, dist: 3 }) // last pre-GO stroke
})
it('NormalStart sets goFired immediately on Live entry', () => {
  let s = initialRaceLifecycle({ totalMeters: 500 })
  s = raceLifecycle(s, { type: 'confirm' })
  s = raceLifecycle(s, { type: 'bereitTap', t: 0 })
  s = raceLifecycle(s, { type: 'tick', nowMs: 4600 }) // POST_GO
  expect(s.phase).toBe('Live')
  expect(s.goFired).toBe(true)
  expect(s.goAnchor).toBeNull()
})
```

- [ ] **Step 2: Implement in `raceLifecycle.ts`**

State additions (+ `initialRaceLifecycle`: `goFired: false, goAnchor: null`):

```ts
  /** True once the GO! moment has passed (same clock domain as race_t0). */
  goFired: boolean
  /** Last pre-GO stroke (Falschstart only); race distance/time subtract it. */
  goAnchor: { t: number; dist: number } | null
```

`tick` handler — replace the early return with:

```ts
    case 'tick': {
      // GO detection for a Falschstart: ticks keep flowing during
      // pre-GO Live; race_t0 and nowMs share the caller's clock.
      if (
        state.phase === 'Live' &&
        state.falschstart &&
        !state.goFired &&
        state.race_t0 != null &&
        event.nowMs >= state.race_t0
      ) {
        return { ...state, goFired: true, goAnchor: state._prevStroke }
      }
      if (state.phase !== 'Ceremony' || state.bereitTapAtMs == null) return state
      ...
```

Both NormalStart Live entries (tick POST_GO branch and the stroke-during-GO fall-through) add `goFired: true` (leave `goAnchor: null`).

- [ ] **Step 3: Fix the visual clamp in `RaceFlow.tsx`**

```ts
  const preGoFalschstart =
    lifecycle.phase === 'Live' && lifecycle.falschstart && !lifecycle.goFired
  const clampVisualToZero = inCeremony || preGoFalschstart
```

(delete the `stroke.time_sec * 1000 < lifecycle.race_t0` comparison and the now-unused `stroke != null` guard term).

- [ ] **Step 4: Keep ticks flowing pre-GO**

Read `web/src/race/useRaceLifecycle.ts`; ensure its rAF tick loop runs while `phase === 'Ceremony' || (phase === 'Live' && falschstart && !goFired)`. If it currently ticks unconditionally, no change.

- [ ] **Step 5: Run race suites + commit**

```bash
cd web && npx vitest run src/race
git add web/src/race
git commit -m "fix(race): GO detection in one clock domain; Falschstart clamp no longer compares device time to performance.now"
```

### Task F2: Exclude pre-GO meters/seconds from the latched result

CONTEXT.md §Falschstart promises exclusion; nothing implements it. With `goAnchor` from F1 this is arithmetic.

**Files:**
- Modify: `web/src/race/raceLifecycle.ts` (stroke cross check + latch inputs)
- Test: `web/src/race/raceLifecycle.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
it('Falschstart pre-GO meters and seconds are excluded from the latched result', () => {
  let s = initialRaceLifecycle({ totalMeters: 100 })
  s = raceLifecycle(s, { type: 'confirm' })
  s = raceLifecycle(s, { type: 'bereitTap', t: 0 }) // race_t0 = 3000
  s = raceLifecycle(s, { type: 'stroke', t: 2, dist: 8, userDistance: 8, total: 100, nowMs: 1000 }) // Falschstart
  s = raceLifecycle(s, { type: 'tick', nowMs: 3100 }) // GO — goAnchor {t:2, dist:8}
  // Rower reaches 100 race-meters at cumulative 108 m, t=52.
  s = raceLifecycle(s, { type: 'stroke', t: 50, dist: 100, userDistance: 100, total: 100, nowMs: 60_000 })
  expect(s.phase).toBe('Live') // 100 - 8 = 92 race-meters: not finished
  s = raceLifecycle(s, { type: 'stroke', t: 52, dist: 108, userDistance: 108, total: 100, nowMs: 62_000 })
  expect(s.phase).toBe('Finished')
  expect(s.latchedResult!.finalTimeS).toBeCloseTo(50, 5) // 52 - 2 pre-GO seconds
})
```

(Adjust the `latchedResult` field name to `raceResultLatch.ts`'s actual shape — check its exported type first.)

- [ ] **Step 2: Implement**

In the Live stroke branch:

```ts
      if (state.phase === 'Live') {
        if (state.session_start == null) {
          state = { ...state, session_start: event.t }
        }
        // §Falschstart: pre-GO meters/seconds are excluded from race
        // distance and race time. goAnchor is the last pre-GO stroke.
        const a = state.goAnchor
        const raceDist = event.userDistance - (a?.dist ?? 0)
        if (event.total != null && raceDist >= event.total) {
          const totalMeters = state._config.totalMeters ?? event.total
          const latched = computeRaceResultLatch({
            cross: {
              t: event.t - (a?.t ?? 0),
              dist: event.dist - (a?.dist ?? 0),
              watts: event.watts,
              spm: event.spm,
              split: event.split,
            },
            prev: state._prevStroke,
            totalMeters,
            opponents: state._config.opponents ?? {},
          })
          ...
```

Also apply the same `(a?.dist ?? 0)` subtraction to the `sessionEnd` late-latch safeguard (`prev.dist >= total` → `prev.dist - (a?.dist ?? 0) >= total`, and `cross: { t: prev.t - (a?.t ?? 0), dist: prev.dist - (a?.dist ?? 0) }`).

- [ ] **Step 3: Thread the anchor into the canvas distance**

`grep -rn "distance_m" web/src/race/RaceLiveStage.tsx web/src/race/RaceLiveView.tsx` — wherever the user boat position consumes `stroke.distance_m`, subtract `lifecycle.goAnchor?.dist ?? 0` so the boat's race position matches the latch arithmetic.

- [ ] **Step 4: Update the canonical Falschstart e2e — it currently pins the OLD (wrong) semantics.** The existing scenarios (commit `5c021e4`, Falschstart at ATTENTION + SET — locate via `grep -rln -i "falschstart" web/e2e`) were written when pre-GO meters counted; they would keep passing silently while this task changes what they should assert. Extend them: after a Falschstart, the latched race time excludes the pre-GO seconds and the boat/race distance starts from 0 at GO (assert against the fixture's known pre-GO stroke values).

- [ ] **Step 5: Run + commit**

```bash
cd web && npx vitest run src/race
git add web/src/race web/e2e
git commit -m "fix(race): implement CONTEXT.md Falschstart rule — pre-GO meters/seconds excluded"
```

### Task F3: Backend race-GO re-anchor signal

The backend's race totals (and therefore `race_result.go` inputs and PB candidates) currently include pre-GO strokes — the work anchor latches on the Falschstart stroke. Give the frontend a way to tell the backend GO fired; the sessionizer re-anchors exactly like a mid-session attach.

**Files:**
- Modify: `backend/internal/session/sessionizer.go` (channel + handler)
- Modify: API session handlers (locate: `grep -rn "session/end\|/session/start" backend/internal/api/*.go`)
- Modify: `web/src/api/client.ts` (+ call site in `RaceFlow.tsx`)
- Test: `backend/internal/session/sessionizer_test.go`

- [ ] **Step 1: Failing sessionizer test**

```go
// TestRaceGo_ReanchorsWorkTotals: open a race session, feed 3 strokes
// (the Falschstart prelude, 30 m / 6 s), call RaceGo(), feed 10 more
// strokes covering 100 m / 20 s. Expect session_end summary
// TotalDistanceM == 100 and TotalTimeSec == 20 (prelude excluded).
```

- [ ] **Step 2: Implement the sessionizer side**

```go
	raceGoC chan struct{} // buffered 1; see RaceGo()
```

(init in `New`: `raceGoC: make(chan struct{}, 1)`), public method:

```go
// RaceGo marks the GO! moment of a race (CONTEXT.md §Falschstart):
// phase and work anchors re-latch on the next frame and accumulated
// totals reset, so pre-GO strokes are excluded from race totals, the
// persisted race result, and PB candidates. No-op without an open
// session. Safe from any goroutine.
func (s *Sessionizer) RaceGo() {
	select {
	case s.raceGoC <- struct{}{}:
	default:
	}
}
```

`Run` select gains (using Task C0's extracted `accumulator` struct — no manual field list to keep in sync):

```go
		case <-s.raceGoC:
			if s.session != nil {
				st := s.session
				st.phaseAnchorSet = false // next frame re-anchors; plan.Reset() runs there
				st.workAnchorSet = false
				st.acc = accumulator{}
				st.warmupSec, st.restSec, st.cooldownSec, st.phaseLastTime = 0, 0, 0, 0
				st.raceGoStrokeNo = st.strokeSeq + 1 // first post-GO stroke
			}
```

Two documented residuals: RaceGo rides a channel, so frames already queued ahead of it can be accumulated pre-reset (±1-stroke skew vs the frontend's `goAnchor` — acceptable, the latch is the rower-facing truth); and `Run`'s select is order-random, so a RaceGo racing a not-yet-processed StartSession may no-op (irrelevant for the human flow — GO fires seconds after start — but E2E tests must not fire them back-to-back).

- [ ] **Step 2b: Pre-GO strokes must also leave the PB candidate pool.** Zeroing accumulators fixes totals/race-result/lifetime stats, but `ComputeCandidates` re-reads strokes from the DB where pre-GO strokes are tagged `phase='work'` — a Falschstart sprint could still seed a 500 m or best-60s-power PB. Carry `raceGoStrokeNo` (new `sessionState` field, included in `event.SessionSummary` as `RaceGoStrokeNo int` with `json:"-"` — internal, not wire) into `applySessionEnd`, which re-tags before computing candidates:

```go
	if summary.RaceGoStrokeNo > 1 {
		// §Falschstart: pre-GO strokes are warmup for every stats
		// consumer (work-only PB candidates, samples, filterWorkStrokes).
		if _, err := p.DB.ExecContext(ctx,
			`UPDATE strokes SET phase = 'warmup' WHERE session_id = ? AND stroke_no < ?`,
			e.SessionID, summary.RaceGoStrokeNo); err != nil {
			return err
		}
	}
```

placed BEFORE `LoadSessionStrokes`. Add a persister test: Falschstart race session → no PB candidate sourced from pre-GO strokes (depends on Phase E's work-only filter).

- [ ] **Step 3: HTTP endpoint + client + call site**

The concrete pattern (per the backend review): one micro-file per verb — create `api/session_race_go.go` mirroring `api/session_end.go` (handler constructor taking the sessionizer interface, returning 204); register in `router.go:127-132` inside the `if in.Sessionizer != nil` block, wrapped in `gate(...)`. Add `RaceGo()` to the `SessionAttacher` interface (`api/workouts.go:11-18`) — `Inputs.Sessionizer` is typed as that interface — and to the one test fake (`fakeAttacher`, `workouts_test.go:285-294`). Frontend: add `raceGo(): Promise<void>` to `web/src/api/client.ts` (same fetch pattern as the existing `endSession`), and in `RaceFlow.tsx` fire it (fire-and-forget, `.catch(() => {})`) from an effect when `lifecycle.goFired` flips true.

- [ ] **Step 4: Run both suites + commit**

```bash
cd backend && go test ./... && cd ../web && npx vitest run
git add backend/internal/session backend/internal/api web/src/api/client.ts web/src/race/RaceFlow.tsx
git commit -m "feat(race): race-go re-anchor + pre-GO stroke re-tag — Falschstart excluded from totals, results, and PBs"
```

---

## Phase G — Backend-stamped work-relative values + frontend deletion pass

### Task G1: Stamp `work_distance_m` / `work_time_sec` / `phase_distance_m` / `phase_time_sec` on every stroke

**Files:**
- Modify: `backend/internal/event/event.go` (StrokePayload), `backend/internal/event/wire.go` (strokeWire)
- Modify: `backend/internal/session/sessionizer.go`
- Test: `backend/internal/session/sessionizer_test.go`

- [ ] **Step 1: Failing tests** — (a) feed a workout with 60 s warmup then distance work; assert the first work stroke has `WorkDistanceM == 0`, later work strokes have `WorkDistanceM == DistanceM - warmupEndDistance`, warmup strokes have `WorkDistanceM == 0` and `PhaseDistanceM`/`PhaseTimeSec` relative to the phase start. (b) The re-latch case: free-row strokes, then `AttachWorkout` with a NO-warmup workout (work→work, no `phase_change` fires); assert the first post-attach stroke has `PhaseDistanceM == 0` — this pins re-latch point (2) and fails if the anchors are only set inside the phase-change block.

- [ ] **Step 2: Implement**

`StrokePayload` additions (and mirrored `strokeWire` JSON fields `work_distance_m`, `work_time_sec`, `phase_distance_m`, `phase_time_sec`):

```go
	// Work-relative values (CONTEXT.md §Workout phases): distance/time
	// since the first work stroke; 0 during warmup. Stamped by the
	// sessionizer so clients never re-derive phase offsets (ADR-0017
	// review: the frontend's derived copy failed silently for weeks).
	WorkDistanceM int
	WorkTimeSec   float64
	// Phase-relative values: distance/time since the current phase began.
	PhaseDistanceM int
	PhaseTimeSec   float64
```

`sessionState` gains `phaseStartDistance int` and `phaseStartTimeSec float64`, set in three places: (1) inside the existing `if phase != s.session.currentPhase` block, next to `phaseLastTime`; (2) on the phase-anchor re-latch path (`phaseAnchorSet == false` → next frame), covering `handleAttach` and RaceGo — without this, attaching a no-warmup workout mid-session (work→work, no phase change fires) would leave `PhaseDistanceM` carrying the whole pre-attach distance; (3) zeroed at `openSessionInternal`. In `onFrame`, after `stroke.Phase = phase.String()` (and after the phase-change block so the anchors are current):

```go
	stroke.PhaseDistanceM = stroke.DistanceM - s.session.phaseStartDistance
	stroke.PhaseTimeSec = stroke.TimeSec - s.session.phaseStartTimeSec
	if s.session.workAnchorSet {
		stroke.WorkDistanceM = stroke.DistanceM - s.session.workAnchorDistance
		stroke.WorkTimeSec = stroke.TimeSec - s.session.workAnchorTimeSec
	} else if phase == PhaseWork {
		// First work stroke: anchor latches in accumulate below; this
		// stroke is the origin.
		stroke.WorkDistanceM = 0
		stroke.WorkTimeSec = 0
	}
```

- [ ] **Step 3: Run backend suite + commit**

```bash
cd backend && go test ./...
git add backend/internal/event backend/internal/session
git commit -m "feat(wire): stamp work- and phase-relative values on every stroke"
```

### Task G2: Regenerate goldens (reviewed wire change)

- [ ] **Step 1:** `cd backend && go test ./internal/goldenstream -update && go test ./internal/goldenstream`
- [ ] **Step 2:** `git diff specs/int/fixtures/golden` — confirm the only change is the four new stroke fields.
- [ ] **Step 3:** `cd web && npx vitest run src/live/goldenReplay.test.ts` — must still pass (consumer ignores unknown fields).
- [ ] **Step 4:**

```bash
git add specs/int/fixtures/golden
git commit -m "test(golden): regenerate for work/phase-relative stroke fields"
```

### Task G3: Frontend consumes stamped values; anchor derivation deleted

**Files:**
- Modify: `web/src/live/events.ts` (StrokePayload: add `work_distance_m: number`, `work_time_sec: number`, `phase_distance_m: number`, `phase_time_sec: number`)
- Modify: `web/src/live/useLiveDisplay.ts` (phased hooks read stroke fields)
- Modify: `web/src/live/reducer.ts` (delete `phaseAnchor` + `workStartDistanceM`)
- Modify: `web/src/live/segments.ts` + `web/src/live/useWorkoutProgress.ts` (consume `work_distance_m`)
- Modify: consumers found via `grep -rn "phaseAnchor\|workStartDistanceM" web/src --include="*.ts*" | grep -v test`
- Tests: update `reducer.test.ts`, `segments.test.ts`, `useLiveDisplay.test.tsx`, `goldenReplay.test.ts`

- [ ] **Step 1: Golden consumer first (TDD at the seam).** In `goldenReplay.test.ts`, replace the `phaseRelative(...)` assertion with the stamped-field invariants:

```ts
        if (line.event === 'stroke') {
          const d = line.data as {
            distance_m: number; phase?: string
            work_distance_m: number; phase_distance_m: number
          }
          expect(d.work_distance_m).toBeGreaterThanOrEqual(0)
          expect(d.work_distance_m).toBeLessThanOrEqual(d.distance_m)
          expect(d.phase_distance_m).toBeLessThanOrEqual(d.distance_m)
          if (d.phase) expect(state.phase).toBe(d.phase)
        }
```

- [ ] **Step 2: Swap the display layer — and give the phased hooks the tests they never had.** `usePhasedDistance` returns `fmtInt(stroke.phase_distance_m + deadReckonedDelta)` (dead-reckoning still extrapolates between strokes — on top of the stamped base instead of the derived one); same shape for `usePhasedTime` with `phase_time_sec`. These hooks had ZERO tests when the original bug shipped — add `renderHook` cases now (fake timers): warmup stroke → phase-relative value shown; work stroke → stamped work value; no stroke → placeholder; paused → extrapolation frozen. Keep `phaseRelative` exported until Step 4, then delete it with its tests.

- [ ] **Step 3: Segments on `work_distance_m`.** Change `locateSegment(segments, workDistanceM, workTimeSec)` — drop the `workStartDistanceM` parameter and `distOffset`; distance consumption becomes `workDistanceM - seg.startDistanceM`. `useWorkoutProgress` passes `state.stroke.work_distance_m` / `state.stroke.work_time_sec`. **Also delete the module-level `crossedAtByDistanceSeg` WeakMap** (`segments.ts:24`, the fragile latch lost on every react-query refetch): rest/cooldown countdowns following a distance segment now anchor on the stamped `phase_time_sec` instead of a frontend-latched crossing time. Update `segments.test.ts` call sites (the B5 describe block now passes work-relative inputs directly; the order-dependent shared-fixture cases become order-independent once the WeakMap is gone).

- [ ] **Step 4: Delete the reducer anchors.** Remove `phaseAnchor` and `workStartDistanceM` from `LiveState`, `initialLiveState`, `session_start`, the implicit-session base state, and the `phase_change` handler (which shrinks to: idempotency guard on `state.phase === p.to`, set `phase`, wipe sparklines/smoothed). Fix every consumer found by the grep (NumericTile, WorkProgressBadge, SegmentStatus — replace anchor arithmetic with the stroke's stamped fields).

- [ ] **Step 5: Full web suite + golden replay + commit**

```bash
cd web && npx vitest run
git add web/src
git commit -m "refactor(live): consume backend-stamped work/phase values; delete frontend anchor derivation"
```

### Task G4: Unify pause constants

Three constants, two values, one concept: `smoothing.ts:26` (4000 ms dead-reckoning), `liveness.ts:5` (`PAUSE_GAP_MS` 5000), backend `LivePacePauseThreshold` (4 s).

- [ ] **Step 1:** Set `PAUSE_GAP_MS = 4000` in `liveness.ts` with a comment pointing at `smoothingConfig.deadReckoning.pauseThresholdMs` and `livePace.go` as the other two holders of the 4-second pause concept; have `smoothing.ts` import/share one constant where the module graph allows (liveness → smoothing import direction already exists in reducer; pick the dependency-free home: `liveness.ts` exports, `smoothing.ts` consumes).
- [ ] **Step 2:** `cd web && npx vitest run`, fix fallout (reducer pause-gap tests using 4–5 s boundaries), commit:

```bash
git commit -am "chore(live): one pause-gap constant (4 s) shared across display + reducer"
```

### Task G5: Dead-code and dead-parameter sweep

Everything below was identified in the 2026-06-10 reviews with zero production consumers (or provably dead writes). Verify each with the grep shown, delete, run the full suites, one commit.

| Item | Location | Verify |
|---|---|---|
| `liveness.isPaused` | `web/src/live/liveness.ts:29-37` | `grep -rn "isPaused" web/src --include="*.ts*" \| grep -v test \| grep -v useLiveDisplay` → only the definition |
| `tick` action (no-op since B1 moved `nowMs` onto `event`) | `web/src/live/reducer.ts` (`case 'tick'` + the action variant) | `grep -rn "'tick'" web/src \| grep -v test` |
| `raceResultLatch` unused `prev` parameter | `web/src/race/raceResultLatch.ts:55` + ~5 call sites | grep call sites; the comment says "backward-compatibility" — there is no external consumer |
| `_prevStroke` dead writes in `Finished` | `web/src/race/raceLifecycle.ts:241-243` | the only `_prevStroke` consumer (the `sessionEnd` late-latch) is unreachable from `Finished` |
| `DeleteSessionStrokes` | `backend/internal/storage/queries.go:190-193` | `grep -rn "DeleteSessionStrokes" backend \| grep -v _test` → only the definition; doc comment is false since ADR-0011 |
| `SessionCompacted` enum value | `backend/internal/stats/recompute.go:17` | no producer since boot compaction was retired |
| `Broadcaster.Subscribe`'s `afterID` param | `backend/internal/stream/broadcaster.go:33-36` | A10 either started using it or it's still dead — resolve accordingly |
| Stale EMA doc comment | `web/src/live/useLiveDisplay.ts:120-128` | comment claims EMA smoothing; `alpha = 1.0` made it pass-through in May 2026 — rewrite, don't delete |

```bash
cd web && npx vitest run && cd ../backend && go test ./...
git commit -am "chore: delete dead code identified by 2026-06-10 reviews"
```

> Deferred deletion, explicitly tracked: `backend/cmd/replay/parity_test.go`'s two hand-ports of frontend math (`latchInFlight`, `integrateDistance`, ~120 lines of drift-prone duplication) retire only when a **race fixture** joins the golden harness — that needs opponent-curve config and workout attach in the harness, which is real work beyond this plan. Until then the hand-ports stay; they are tested duplication, not dead code. Candidate for the first follow-up after Phase G.

---

## Phase H — Finalise seam (one shutdown path)

### Task H1: `FinaliseSession` — single entry point for ended / cancelled / stale / boot

Three paths finalize sessions today: `persister.applySessionEnd` (normal end), the stale janitor's finalize, and `BootJanitor` (which also hard-deletes zero-stroke ghosts, B4). Each loads strokes and computes candidates separately.

**Files:**
- Create: `backend/internal/storage/finalise.go`
- Modify: `backend/internal/storage/persister.go`, `backend/internal/storage/stale_janitor.go`, `backend/internal/storage/janitor.go`
- Test: `backend/internal/storage/finalise_test.go`

- [ ] **Step 1: The per-path difference matrix** (established by the 2026-06-10 backend review — verify it still holds, then bake it into a comment block at the top of the new file):

| Dimension | persister (`applySessionEnd`) | `FinalizeStaleSession` | `BootJanitor.finaliseOne` |
|---|---|---|---|
| Base summary | sessionizer accumulators (has AvgSPI/Peak) | `buildSummary(strokes)` (no AvgSPI) | `buildSummary(strokes)` (no AvgSPI) |
| `endedAt` | event time | `MAX(strokes.at)` | `time.Now()` |
| Samples input | work-only | work-only | **all phases** (divergence) |
| Race result | computed | forced nil (ADR-0012) | nil |
| Insights | yes | no | no |
| `last_event_id` | `e.ID` | 0 | 0 |
| Flags | none | `["recovered"]` | `["recovered"]` |
| Zero strokes | n/a | **NULL `MAX(at)` scan → 500** (bug) | hard-DELETE row (B4) |
| Recompute trigger | inside | caller (`api/sessions.go:117`) | caller (`janitor.go:136`) |
| `session_finalized` emit | yes | no | no |

- [ ] **Step 2: Write the seam** (signature amended per review — `lastEventID` is load-bearing: `reads.go:126-135` restores the monotonic event-ID counter from `MAX(last_event_id)` at boot, so dropping it would let event IDs restart low after a reboot):

```go
// FinaliseReason records which lifecycle path closed the session.
type FinaliseReason string

const (
	FinaliseEnded FinaliseReason = "ended" // normal session_end (incl. user cancel-with-save)
	FinaliseStale FinaliseReason = "stale" // stale-open janitor / recovery card
	FinaliseBoot  FinaliseReason = "boot"  // boot janitor recovery
)
// NOTE: no FinaliseCancelled — "Speichern" routes through the normal
// EndSession→FinaliseEnded path and "Verwerfen" is DELETE, which never
// finalises. Don't add speculative reasons.

// FinaliseSession is the single seam every shutdown path goes through.
// strokes may be nil (loaded internally) — stale/boot callers that
// already loaded them pass them in to avoid a double read. Reason
// gates: race result + insights computed for FinaliseEnded only
// (stale forces Race=nil per ADR-0012); flags=["recovered"] for
// stale/boot; lastEventID is 0 for stale/boot. Zero-stroke sessions
// return ErrZeroStrokes — boot deletes the row (B4), the stale API
// responds 204 (fixes the NULL MAX(at) 500). The summary write is
// guarded WHERE ended_at IS NULL (idempotent; concurrent finalise
// loses cleanly). Triggers the stats recompute itself — remove the
// caller-side triggers in api/sessions.go and janitor.go.
func FinaliseSession(ctx context.Context, db *sql.DB, sessionID string,
	endedAt time.Time, base event.SessionSummary, strokes []event.StrokePayload,
	lastEventID uint64, reason FinaliseReason,
	sched *stats.RecomputeScheduler) (event.SessionSummary, error)
```

While moving the body across: consolidate the four copies of the work-phase predicate (`persister.filterWorkStrokes`, `stale_janitor.filterWorkStrokesForFinalize`, the inline filter in `janitor.buildSummary`, `stats.keepPhases(s,"","work")`) onto one exported helper, and **pin the boot-path behaviour change with a test**: recovered sessions' samples become work-only (today the boot janitor computes them over all phases — that was a divergence, not a feature).

`applySessionEnd` becomes:

```go
func (p *Persister) applySessionEnd(ctx context.Context, e event.Event) error {
	summary, err := FinaliseSession(ctx, p.DB, e.SessionID, e.SessionEnd.EndedAt,
		e.SessionEnd.Summary, nil, e.ID, FinaliseEnded, p.Scheduler)
	if err != nil {
		return err
	}
	p.emitSessionFinalized(ctx, e.SessionID, summary)
	return nil
}
```

Then move the stale and boot paths onto the same call (preserving their flag/summary-source differences as parameters or small pre-steps), keeping the boot janitor's zero-stroke hard-delete before the call.

- [ ] **Step 3: Tests** — the seam's contract, enumerated (each failing-first):
  - one per reason asserting the summary write, flags, and recompute scheduling (`ended` additionally: race result computed, insights written, `last_event_id` persisted; `stale`: `Race == nil` forced; `boot`: work-only samples — this pins the behavior change from all-phases)
  - **idempotency**: finalise the same session twice → second call is a no-op (RowsAffected 0 on the `ended_at IS NULL` guard), no duplicated candidate rows
  - **zero strokes**: `ErrZeroStrokes` sentinel; boot caller deletes the row (B4 preserved), stale API caller returns 204 (pins the fix for the NULL `MAX(at)` 500)
  - **`lastEventID`**: ended path persists `e.ID`; after a simulated restart, `reads.go`'s counter restore sees it (regression guard for the boot event-ID seed)

  The existing persister/janitor suites are the regression net for everything not listed.

- [ ] **Step 4: Full backend suite + golden harness, commit**

```bash
cd backend && go test ./...
git add backend/internal/storage
git commit -m "refactor(storage): FinaliseSession — one seam for ended/cancelled/stale/boot shutdown"
```

---

## Test evidence map

Every behavior change must carry a failing-first test at the **lowest
level that can express it**; user-visible behavior additionally gets
contract (golden) or e2e evidence. Golden byte-identity proves
*determinism*; hand-derived expected values prove *correctness* — both
are required, and expected values are derived from fixtures/captures,
never copied from harness output (circular). The ADR-0014 e2e gate
applies to the user-visible phases.

| Change | Unit | Contract (golden) | E2E |
|---|---|---|---|
| A1 phase_change wiring | per-kind round-trip; idempotent redelivery | C1 Step 2b workout fixture (phase_change present, non-vacuous) | warmup workout: hero shows work-relative distance |
| A2/A3 reducer guards | session-id guard; anchor reset | replay survives redelivered events | — |
| A4 rest-skip removal | rest persists until elapsed (± warmup offset) | — | — |
| A5/A6/A8 | fake-timer pause; carry-rounding; StrictMode | — | — |
| A9 rowerID fix | scheduler trigger fires; insights rows exist; ghost-with-warmup gap unchanged | — | HITL: verify on Pi post-deploy |
| A10 SSE ordering | interleaved-broadcast no-loss; header precedence | — | — |
| B1 reducer purity | same (state, action, nowMs) ⇒ same state | prerequisite for all goldens | — |
| C0 step seam | full existing sessionizer suite (behavior-preserving) | run-twice byte-identity | — |
| C1–C3 harness | invariant + hand-derived totals (163 m / 48 s class) | the goldens themselves; TS consumer invariants | — |
| D1 pause events | wire matrix; reducer + hydration-compat | pause events round-trip in D5 golden | — |
| D2 pause machine | nine named policy tests (a–f + window + gap + resume) | D5 synth-pause golden: exact 390 m / 76 s | D6 phone-call scenario + negative case |
| D3 config/stale | config parse; janitor threshold | — | — |
| E1 PB work-only | warmup-sprint-not-PB; flipped B1 test | — | HITL: Rekorde check on real DB |
| F1/F2 race clocks | goFired domain test; pre-GO exclusion arithmetic | — | Falschstart e2e updated to NEW semantics |
| F3 race-go | re-anchor totals; pre-GO re-tag → no PB | — | covered by Falschstart e2e |
| G1 stamping | warmup/work stamps; attach re-latch (no phase_change) | G2 reviewed golden diff (only new fields) | — |
| G3 deletion pass | phased hooks get their first tests (renderHook) | TS consumer asserts stamped-field invariants | existing warmup e2e keeps passing unchanged |
| H1 finalise seam | per-reason matrix; double-finalise no-op; zero-stroke sentinels; lastEventID restore | goldens byte-identical (no wire change) | — |

Standing rules for executors:
1. If a step changes behavior and no row above covers it, STOP and add the test first.
2. A golden diff outside C1-creation and G2 is a finding, not noise — investigate before regenerating.
3. When updating an existing test, first run it against the old code to confirm it pinned the old behavior; a test that passes before and after a semantic change is vacuous (see F2's Falschstart e2e).

## Self-review checklist (run after all phases)

- [ ] Both training-session bug reports are addressed: hardware-vs-UI distance (A1 + G1/G3 stamped values), stats outside work phase (A1, E1, D2 stop-the-clock + idle-frame exclusion).
- [ ] All four user priorities hold: PB accuracy (A9, E1, F3 incl. pre-GO re-tag), robust cancel (H1), warmup/cooldown inert (A1, E1, G1), pause never disrupts (D2–D5, A5, A10).
- [ ] A9 verified on the Pi after deploy: insights rows appear for new sessions, PB recompute fires on session end (not just via the B6 sweep), session-ghost opponents load.
- [ ] `go test ./...`, `npx vitest run`, and the Playwright e2e gate (ADR-0014) all green.
- [ ] Golden JSONL regenerated exactly twice (Phase C creation, Phase G2 wire change) — every other phase leaves it byte-identical, proving no accidental wire drift.
- [ ] CONTEXT.md statements match the code afterward: §Pause / Abort (D), §Falschstart (F2/F3), §Workout phases PB rule (E1).
