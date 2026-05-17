# 0019-03 — Fertig button + remove "Paddelst aus..." label

Status: ready-for-agent

- **Type**: AFK · UI
- **Parent**: [PRD-0019](../PRD.md)

## What to build

Today there is no user-actionable way to end a race after the finish
horn. The only exit path is idle-timeout `session_end`, which can fail
to fire (low-amplitude paddle-down strokes, screen lock, slow timer)
— in real testing the rower had to kill the app. The FinishOverlay's
`Paddelst aus...` label is also grammatically broken and asserts an
action the rower usually isn't performing while reading the overlay.

Add a **Fertig** button to `FinishOverlay`. It is enabled from the
moment the overlay mounts. Tapping it immediately fires `session_end`
via the existing `endSessionQueue` path (the same path used by the
manual abort flow — same end-point, different trigger), dismisses the
race surface, and returns the rower to Home.

Remove the `Paddelst aus...` label from the overlay header. The header
is just `Ziel!`. No replacement string.

The idle-timeout `session_end` path is unchanged — it remains the
passive fallback for rowers who walk away.

Button label is **Fertig** (working name per CONTEXT.md `§Finish
horn`). Intentionally not "Beenden", which reads as Abort — and per
CONTEXT.md `§Pause / Abort`, abort is unavailable post-horn because
the result is already latched.

## Acceptance criteria

- [ ] `FinishOverlay` renders a "Fertig" button when given a result.
- [ ] The button is enabled from the moment the overlay mounts.
- [ ] Tapping "Fertig" invokes the `onFinish` callback exactly once.
- [ ] The wired callback (in `RaceFlow` or equivalent parent) fires
      `session_end` via the existing `endSessionQueue` path.
- [ ] After tapping "Fertig", the race surface dismisses and the
      rower lands on Home.
- [ ] No `Paddelst aus...` text appears anywhere in the rendered
      output.
- [ ] The idle-timeout `session_end` path continues to fire for
      rowers who walk away without tapping anything (regression
      coverage).

## E2E walkthrough

Rower completes a 500 m race; FinishOverlay slides in showing
`Ziel!`, the latched results, and a "Fertig" button. The rower taps
"Fertig". The race surface dismisses immediately, the rower lands on
Home, and the bottom-nav tabs are interactive. A second scenario:
rower completes a race, does not tap Fertig, and walks away; after the
idle-timeout elapses, `session_end` fires automatically and the rower
lands on Home on next interaction.

## E2E spot-checks

- `data-testid="finish-overlay"` does not contain the text
  `Paddelst aus`.
- `data-testid="finish-overlay"` contains a button with
  `data-testid="finish-fertig"` (or accessible name "Fertig"),
  enabled immediately on overlay mount.
- Tapping `data-testid="finish-fertig"` results in navigation to `/`
  (Home) within a short timeout.
- After the Fertig tap, the persisted session row in the backend has
  `ended_at IS NOT NULL`.
- Idle-timeout fallback scenario: with no `Fertig` tap and no
  strokes for the idle threshold, the session is finalised by the
  existing idle-timeout path (regression).

## Blocked by

None — can start immediately.

## Comments

**2026-05-17 — wiring.** Fertig is wired in `LivePage` as
`enqueueEndSession(sessionId) → processPendingEndSessions() → abort()
→ nav('/')`, mirroring the existing X-abort path used by
`WorkoutProgressStrip` and PauseDialog Save. The race surface
dismissal is not driven directly by the click — it falls out of the
existing reducer transition once the backend acks `session_end`,
keeping Fertig and idle-timeout on the same downstream path.

**2026-05-17 — idle-timeout regression.** The unit-level idle-timeout
regression test proxies the backend timer via `liveState.summary`
arrival (backend timeout → `session_end` event → reducer surfaces
`summary` → Post). The actual idle timer is exercised by an E2E spot-
check, not at unit level.

**2026-05-17 — non-blocking nits parked.** Code-quality review flagged
five small follow-ups: wrap `handleFinish` in `useCallback`, replace
`onClick={() => onFinish?.()}` with `onClick={onFinish}`, extract a
`setupRaceToFinished()` test helper, consider CSS theme tokens for
the `.fertig` button, drop a redundant test rename. None blocking.
