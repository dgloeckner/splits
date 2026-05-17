# 0019-04 — Boot-time session reconciliation

Status: ready-for-agent

- **Type**: AFK · UI
- **Parent**: [PRD-0019](../PRD.md)

## What to build

A rower kills the app mid-paddle-down (or the app is otherwise
unclean-shutdown). On reopen, `LiveSessionContext` rehydrates a cached
"active workout" state from before the kill. Meanwhile the backend
may have already finalised the session — but `BottomNav` keys its
`workoutActive` derivation on `state.session?.workout_id && summary
=== null`, so all three tabs read as disabled until the rower
completes an entire new session. Real testing reproduced this exact
trap.

Add a `useBootReconcile` hook in `web/src/live/` that runs exactly
once at app boot. It compares the locally cached `LiveSessionContext`
"active workout" state against the backend's view of that session via
the existing session-detail endpoint.

- BE reports `ended_at IS NOT NULL` for the cached session → drop the
  cached active-workout state, load `summary` from the backend, do
  not surface any recovery card.
- BE reports `ended_at IS NULL` for the cached session and the cached
  state matches → keep the cache, allow the existing ADR-0010 /
  ADR-0012 stale-open recovery flow to run.
- BE has no record of the cached session at all → drop the cache
  silently.

`BottomNav` is unchanged — its `workoutActive` derivation already
keys off `state.session?.workout_id && summary === null`. Once
`useBootReconcile` clears stale cache, the existing condition unlocks
the nav naturally.

Domain rule in CONTEXT.md `§Boot-time session reconciliation`:
already captured.

## Acceptance criteria

- [ ] `useBootReconcile` runs exactly once at boot (not on
      subsequent context updates).
- [ ] BE returns `ended_at` set → cached "active workout" state
      dropped, `summary` loaded from BE.
- [ ] BE returns `ended_at IS NULL` matching cached state → state
      preserved, recovery flow not bypassed.
- [ ] BE returns 404 / no such session → cached state dropped
      silently.
- [ ] After app-kill mid-paddle-down + reopen, the bottom-nav tabs
      are enabled when the backend has finalised the session (the
      original trap).
- [ ] `BottomNav` behaviour during a genuinely-active workout is
      unchanged (regression coverage — tabs still lock when a
      workout is actually in-flight).

## E2E walkthrough

Rower completes a race, taps Fertig — the session is finalised on the
backend. Test then simulates an app-kill with the local
`LiveSessionContext` still holding the "active workout" state for
that session (mimicking the real-world unclean shutdown). The app
reboots. `useBootReconcile` queries the backend, sees `ended_at`
set, drops the stale cache, and the rower lands on Home with all
three bottom-nav tabs enabled. No recovery card appears.

## E2E spot-checks

- After reboot, `data-testid="bottom-nav-workout"`,
  `data-testid="bottom-nav-historie"`, and
  `data-testid="bottom-nav-profil"` are all interactive (no
  `aria-disabled="true"` or `data-locked="true"`).
- After reboot with a finalised session in the cache, no element
  with `data-testid="stale-open-recovery-card"` is rendered.
- During a genuinely-active workout (no shutdown), the same nav
  testids remain locked (regression).
- `useBootReconcile` fires exactly once per app boot (assert via a
  spy on the underlying fetch, or via test-only instrumentation).

## Blocked by

None — can start immediately.
