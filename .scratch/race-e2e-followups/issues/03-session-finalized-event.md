# 0017-03 — Deliver enriched `summary.race` to the frontend via a new `session_finalized` SSE event

Status: ready-for-agent

- **Type**: AFK · Backend + UI
- **Parent**: [PRD-0017](../PRD.md)
- **Surfaced by**: [PRD-0016 / 0016-05](../../e2e-automation/issues/05-canonical-happy-path.md) knock-on investigation (2026-05-14)
- **Related**: PRD-0014 user story 14 (FinishOverlay → RacePostScreen continuous post-flow)

## What to build

When a race-mode session ends, the rower should see `RacePostScreen`
with the final race result (PRD-0014 user story 14). Today the
generic `SessionEndedOverlay` renders instead, because
`latched.summary.race` is null on the frontend.

Root cause confirmed via instrumented reproduction: the **sessionizer
emits the `session_end` SSE event with a basic summary that does NOT
include the `Race` field**. The persister enriches `summary.Race`
later (post-emission), writes the enriched summary to SQLite, but the
SSE pipeline never broadcasts the enriched version. The frontend's
`state.summary.race` stays `null` forever.

Backend DEBUG output during reproduction:

```
DEBUG_RACE_RESULT session=... workout_id="..." workout_mode="race" dist=1027 time=281.0
DEBUG_RACE_RESULT result=&{VsPbSec:<nil> VsGhostSec:0x... GhostKind:synth OpponentIDs:[]}
```

And the corresponding frontend log:

```
LIVEPAGE_DEBUG {isRace: true, hasSummary: true, hasRaceInSummary: false}
```

Backend computes the race result correctly; frontend never sees it.

### Fix shape

Add a new SSE event `session_finalized` (Go: `event.KindSessionFinalized`,
payload: `{ SessionID string; Summary SessionSummary }`). The persister
emits it AFTER the transaction commits (so DB and event agree). The
frontend reducer gains a `case 'session_finalized'` that, if the
payload's session id matches the latched session, replaces
`state.summary` with the enriched one. Old clients that don't
recognise the event ignore it; backwards compatible.

This generalises beyond `race`: future post-persist enrichments
(`PBCandidates`, `Samples`, insights flags) can flow through the same
event without inventing a new mechanism each time.

### Wrinkle: state restore

If the user reloads `/live` between `session_end` and
`session_finalized`, they get the un-enriched summary from the
in-memory reducer or the `SessionSnapshot` mechanism. Out of scope
for this issue — the typical flow stays connected long enough to
receive the second event. A follow-up could extend `SessionSnapshot`
to include the persisted enriched summary if/when that becomes a
real-world problem.

## Acceptance criteria

- [ ] New event kind `KindSessionFinalized` in `backend/internal/event/event.go` with payload `{ SessionID string; Summary SessionSummary }`.
- [ ] Persister emits the new event after the session-end transaction commits successfully.
- [ ] The emission uses the same dispatch channel the sessionizer uses (so SSE broadcast picks it up automatically).
- [ ] Backend Go test: verify a race-mode session that completes triggers BOTH `session_end` (un-enriched) AND `session_finalized` (with `Race` populated) on the same channel.
- [ ] Frontend reducer (`web/src/live/reducer.ts`) gains `case 'session_finalized'`: if `event.data.session_id === state.session?.session_id`, replace `state.summary` with the new payload's summary.
- [ ] Frontend SSE event-type union (`web/src/live/events.ts`) extended with `SessionFinalized` and its payload type.
- [ ] Frontend reducer unit test asserts the replacement happens for the matching session id, AND is ignored for non-matching session ids.
- [ ] PRD-0016 / 0016-05 happy-path E2E spec's `RacePostScreen` assertion passes: after session end, `userTotalSec` is non-zero and `summary.race` is populated. (May also depend on [0017-04](04-stroke-during-go-ceremony.md) — both must land for the spec to be fully green.)
- [ ] No regression in non-race sessions: `session_end` still drives the existing post-session UI.

## E2E walkthrough

Same scenario as PRD-0016 / 0016-05 (canonical race happy-path). After
this fix lands, `RacePostScreen` renders with the persisted race
result; `SessionEndedOverlay` does NOT appear.

## E2E spot-checks

- After session end in race mode, the page shows `RacePostScreen` (not `SessionEndedOverlay`).
- `RacePostScreen.userTotalSec` reflects the actual finish time (>0).
- The `summary.race.vs_ghost_sec` value matches the backend's computed gap within ±0.1 s.

## Blocked by

None — can start immediately. The full PRD-0016 happy-path E2E will only go fully green when [0017-04](04-stroke-during-go-ceremony.md) also lands, but 0017-03 is independently shippable and testable in isolation (backend Go tests + frontend reducer unit tests + a focused E2E that mocks the latch path).
