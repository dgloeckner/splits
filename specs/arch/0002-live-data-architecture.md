# ARCH-0002: Live Data Architecture — Clocks, Sessions, Replay

- **Status**: Accepted (documents the architecture established by the
  2026-06-10 plan, `docs/superpowers/plans/2026-06-10-stability-accuracy-replay-harness.md`;
  implementation lands phase by phase)
- **Date**: 2026-06-10
- **Supersedes**: the stage-boundary and enrichment sections of ARCH-0001
- **Depends on**: ADR-0007 (ingestion pipeline), ADR-0011 (replay-grade
  persistence), ADR-0017 (golden replay harness), CONTEXT.md (§Workout
  phases, §Pause / Abort, §Falschstart, §Finish horn)
- **Audience**: developers, architects, new project members, AI agents

## 0. The one rule

**The backend derives; the frontend displays.**

Every number the rower sees (work distance, phase time, pace, pause
state) is computed once, in the Sessionizer, and stamped onto the wire.
The frontend never re-derives offsets, anchors, or phase context from
event history. This rule exists because its violation was the root
cause of the 2026-06 bug class: a frontend that derived work distance
from a single `phase_change` event failed silently for weeks when that
event was never delivered.

## 1. System at a glance

One erg, one Raspberry Pi, one Go process, N browser clients (PWA).
SQLite is the only store. No cloud.

```
 FDF ergometer                    Go backend (Pi)                          Browser (PWA)
┌────────────┐   serial   ┌──────────────────────────────┐    SSE    ┌──────────────────┐
│ IPM console│ ─────────► │ ipm: parse A8 frames         │ ────────► │ channel.ts       │
│ (A8 frames │  9600 8N1  │   ▼                          │           │   ▼              │
│  ~1/sec)   │            │ session.Sessionizer          │           │ reducer.ts       │
└────────────┘            │   anchors · phases · pause   │           │  (pure fold over │
                          │   enrichment · lifecycle     │           │   events+nowMs)  │
                          │   ▼            ▼             │           │   ▼              │
                          │ pipeline    storage          │           │ display hooks    │
                          │ ring+bcast  persister→SQLite │           │ (dead-reckoning, │
                          │   ▼            ▼             │           │  formatting only)│
                          │ stream/sse  stats (PBs,      │           └──────────────────┘
                          │             trends, janitors)│
                          └──────────────────────────────┘
```

The Sessionizer is deliberately the deep module: everything between
"raw cumulative device counters" and "meaningful session events"
happens inside it, behind a small interface (`Run`, `StartSession`,
`EndSession`, `AttachWorkout`, `RaceGo`, `Snapshot`).

## 2. Clocks and anchors

The device emits **cumulative** counters: distance since console
memory start (wraps at 100 km), time since device session start. The
console LCD shows these — they are the "hardware truth" the app must
be explainable against, never equal to.

The Sessionizer rebases through three anchors and one accumulator,
producing the domains below. All anchors live backend-side; the wire
carries only final values.

```
device domain      ──storage anchor──►  session domain  ──pause accum──►  work clock
(cumulative,           (latched at        (t=0, d=0 at      (pausedAccumSec    (what the wire,
 wraps, includes        first frame        first frame)      subtracted:        DB, phases, PBs
 pre-session            of session)                          clock STOPS        and totals see)
 strokes)                                                    while paused)
                                                                  │
                                              phase anchor ◄──────┤  per-phase origin (re-latched
                                              work anchor  ◄──────┘  on attach / RaceGo; both live
                                                                     in the ADJUSTED domain)
```

Per-stroke stamped fields (wire names): `distance_m` / `time_sec`
(session domain, pause-adjusted), `work_distance_m` / `work_time_sec`
(since first work stroke; 0 during warmup), `phase_distance_m` /
`phase_time_sec` (since current phase began), `phase`.

Domain mixing is the local bug class. Rules:

- Anchors are latched **after** rebase and pause adjustment, from the
  same values downstream consumers see.
- `race_t0` (frontend) is `performance.now()`-domain and must never be
  compared against device seconds. GO detection is reducer state
  (`goFired`), not a cross-domain comparison.
- Wall clock (`opts.Now`, injected) is only for lifecycle decisions
  (pause entry, resume window) — never for metric values.

## 3. Session lifecycle

```
              StartSession            distance frozen / no frames
                  │                        ≥ PauseTimeout (10 s)
                  ▼                   ┌──────────────────────────┐
   (no session) ────► OPEN ──────────►│         PAUSED           │
        ▲             │  ▲            │ work clock stopped;      │
        │             │  └────────────│ idle frames swallowed;   │
        │             │   distance    │ countdowns halted        │
        │             │   advances    └──────────┬───────────────┘
        │             │   (auto-resume,          │ paused ≥ ResumeWindow (15 min)
        │             ▼    no user action)       ▼
        └────────── CLOSED ◄─────────────────────┘
                      ▲
        also: explicit EndSession · cooldown elapsed (PhaseDone) ·
              race idle-timeout after the finish horn
```

Properties:

- **A short interruption never ends a session or loses strokes.** A
  phone call pauses; the next distance-advancing frame resumes,
  landing on the exact work-second the pause began.
- **Idle frames are never strokes.** Distance-frozen frames update
  liveness and (when not paused) drive phase classification and
  cooldown completion — they are not emitted, enriched, or
  accumulated. Averages cannot be diluted by idle broadcasts.
- **Pause never arms during Cooldown** — cooldown idleness is
  expected and flows to the §Session end auto-close.
- The wire announces `session_paused` / `session_resumed`; the
  reconnect snapshot includes pause state, so a client that
  screen-locked mid-pause learns it is paused.
- `sessions.ended_at IS NULL` in SQLite is the lifecycle source of
  truth; in-memory state revalidates against it (ADR-0010).

## 4. Finalisation: one seam

Every path that closes a session converges on
`storage.FinaliseSession(…, reason)`:

```
 normal end (incl. user "Speichern") ──► reason=ended ─┐
 stale-open janitor / recovery card  ──► reason=stale ─┤──► FinaliseSession
 boot janitor (crash recovery)       ──► reason=boot  ─┘    │ load strokes (work-only filter)
                                                            │ samples · PB candidates · race result
 "Verwerfen" / DELETE never finalises                       │ idempotent summary write (ended_at IS NULL guard)
 (hard delete is its own path)                              │ schedule stats recompute
                                                            └ ended: emit session_finalized
```

Reason gates the differences (race result + insights: ended only;
`flags=["recovered"]`: stale/boot; `last_event_id`: ended only).
Zero-stroke sessions are a sentinel: boot deletes the ghost row (B4),
the stale API no-ops. The every-minute janitor's stale-stats sweep
(B6) remains as a self-heal backstop, not a load-bearing path.

## 5. Phases and the work-only invariant

`session/phaseplan.go` classifies every stroke into
`warmup | work | rest | cooldown` against the attached workout's
segment plan, on **pause-adjusted, phase-anchor-relative** values.
The phase is stamped on the stroke and persisted (ADR-0011 keeps all
strokes, all phases, forever — they are the replay input).

The invariant (CONTEXT.md §Workout phases): **only Work-phase strokes
count toward metrics** — session totals, averages, PB candidates,
trends, lifetime stats. Warmup/cooldown are conveniences; they affect
nothing. Enforcement points:

- totals: `accumulator.Add` runs only for `PhaseWork` strokes
- PB candidates: `stats.ComputeCandidates` filters work-only (the
  former B1 warmup-headroom exception is retired)
- persisted samples: work-only filter in `FinaliseSession`
- distance goals: measured post-warmup (B5, `warmupEndDistance`)

## 6. Race mode

Race adds three concepts on top of the normal lifecycle
(CONTEXT.md §Race):

- **`race_t0` / GO!**: the frontend race lifecycle reducer (pure,
  `web/src/race/raceLifecycle.ts`) owns ceremony timing and sets
  `goFired` + `goAnchor` (last pre-GO stroke). On GO the frontend
  calls `POST /api/v1/session/race-go`; the Sessionizer re-anchors
  work/phase and zeroes the accumulator, and at finalisation pre-GO
  strokes are re-tagged `warmup`. Result: a Falschstart's pre-GO
  meters/seconds exist in no total, no race result, and no PB.
- **Finish horn**: latched in the frontend reducer on the first
  stroke whose race distance ≥ total; `latchedResult` freezes the
  whole race surface. The backend computes the persisted result
  independently from work-anchored totals; the golden harness pins
  their agreement.
- **Post-horn strokes are cooldown** — stripped from totals like any
  cooldown.

## 7. Wire contract and reconnects

SSE events (INT-0002): `session_start`, `stroke`, `phase_change`,
`level_change`, `workout_attached`, `session_paused`,
`session_resumed`, `session_end`, `session_finalized`, `device`.
`event.EventName` + `event.Marshal` are the single wire encoder; the
`TestEventNameMatrix` guards name/marshal split-brain.

Reconnect model:

```
client ──(Last-Event-ID, beats stale ?since)──► sse handler
   1. subscribe to broadcaster FIRST (no event-loss window)
   2. snapshot: session_start · workout_attached · phase_change ·
      session_paused  — for cursors already past these events
   3. ring replay (cap 10000) for everything since the cursor
   4. live fan-out; slow clients are dropped, never block others
```

The reducer treats redelivery as the norm: `session_end`,
`session_finalized`, and `phase_change` handlers are idempotent and
session-id-guarded.

## 8. Frontend state model

`web/src/live/reducer.ts` is a **pure fold**: state' = f(state, event,
nowMs). The arrival clock is stamped on the action by the dispatcher;
the reducer reads no wall clock. Display hooks (`useLiveDisplay.ts`)
own the only wall-clock behaviour — dead-reckoning between strokes,
pause display, countdown ticking — on top of wire values.

What the frontend is allowed to keep as state: the latest stroke, the
session shell, sparklines, smoothing, channel status, `serverPaused`.
What it must not do: latch anchors, subtract offsets, classify phases,
or re-implement any backend derivation. If a display needs a number
the wire doesn't carry, the fix is a backend stamp, not a frontend
derivation.

## 9. Testing architecture: the golden seam (ADR-0017)

```
 specs/int/fixtures/ipm/*.csv         specs/int/fixtures/golden/*.jsonl
 (raw A8 payloads, real captures      (committed SSE event streams —
  + synthetic pause fixture)           THE contract between Go and TS)
        │                                      ▲              │
        ▼                                      │              ▼
 ipm.DecodeA8 (production parser)       go test ./internal/goldenstream    web: goldenReplay.test.ts
        │                                      │ -update regenerates       replays JSONL through the
        ▼                                      │ (reviewed like an API     REAL reducer; asserts
 Sessionizer synchronous seam ─────────────────┘  change)                  display invariants
 (OpenSession · ProcessFrame ·
  CloseOpenSession; injected clock
  + injected session ids)
```

Properties: byte-stable run-to-run (no entropy, no goroutines, no wall
clock in the replay path); "matches the hardware" is assertable
because the wire carries the console's own displayed values
(cumulative distance, device split-pace). Every distance/pace/phase
bug report becomes a fixture: capture or synthesize frames, assert the
expected numbers, fix until green. The Playwright e2e gate (ADR-0014)
remains the UX gate; this is the numeric gate.

## 10. Load-bearing invariants

| Invariant | Owner |
|---|---|
| Work clock stops while paused; pause time is in no metric | Sessionizer pause accum |
| Idle frames are never strokes | Sessionizer idle policy |
| Only Work strokes count toward any metric or PB | accumulator + `FinaliseSession` + `ComputeCandidates` |
| Pre-GO race strokes count nowhere | RaceGo re-anchor + finalise re-tag |
| All strokes, all phases, persist forever (replay input) | persister (ADR-0011) |
| One finalisation path; idempotent; reason-gated | `FinaliseSession` |
| Reducer is pure; redelivery-safe; clock comes from the action | `reducer.ts` |
| Frontend derives nothing; missing numbers become backend stamps | §0 rule |
| Golden JSONL changes only via reviewed `-update` | ADR-0017 |
| Backend DB is the session-lifecycle source of truth | ADR-0010 |

## 11. Reading order for new contributors

1. `CONTEXT.md` — the domain language (authoritative over code names)
2. This document
3. `specs/adr/0017-…` (replay harness), `0011-…` (persistence), `0010-…` (lifecycle)
4. `backend/internal/session/sessionizer.go` — read with §2–§3 beside it
5. `web/src/live/reducer.ts` + `useLiveDisplay.ts`
6. `specs/int/0001-ipm-serial-protocol.md` — only when touching the device layer
