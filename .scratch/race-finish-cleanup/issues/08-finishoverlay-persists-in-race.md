# 0019-08 — FinishOverlay persists post-session-end in race mode

Status: ready-for-agent

- **Type**: AFK · UI
- **Parent**: [PRD-0019](../PRD.md)

## What to build

Today, when `session_end` fires (whether by Fertig tap or
idle-timeout), the generic `SessionEndedOverlay` ("Session beendet /
Bestleistungen werden berechnet…") slides in and fully occludes the
FinishOverlay. The rower's last view of their race is a generic
"computing PBs" message instead of the latched ENDZEIT / Schnitt /
vs. Ghost / vs. PB. The E2E captures for 0019-02 and 0019-06 both
caught this behaviour.

Per CONTEXT.md `§Finish horn` (updated in the post-E2E grill), the
FinishOverlay **IS** the post-session result surface for race mode.
The SessionEndedOverlay must NOT slide in when `workout.mode ===
'race'`. The FinishOverlay persists until the rower navigates
(Fertig tap or nav-bar tap). No additional "Gespeichert" affirmation
is needed — the latched result and the visible Fertig button are
the affirmation.

## Acceptance criteria

- [ ] When `workout.mode === 'race'` and `session_end` fires, the
      `SessionEndedOverlay` does NOT mount.
- [ ] For non-race modes, `SessionEndedOverlay` behaviour is
      unchanged (regression coverage — distance / time / intervals
      / just_row still show the generic overlay).
- [ ] The FinishOverlay remains mounted across `session_end` in
      race mode; the rower continues to see ENDZEIT / Schnitt /
      vs. Ghost / vs. PB / Fertig button.
- [ ] Tapping Fertig still navigates to Home (idempotent if
      `session_end` already fired via idle-timeout — the
      `endSessionQueue` dedup makes re-enqueuing a no-op).
- [ ] Idle-timeout fallback: if the rower walks away without
      tapping Fertig, the session finalises on the backend, but
      the on-screen FinishOverlay does not auto-dismiss; the rower
      sees their result whenever they return.
- [ ] The `useBootReconcile` path (0019-04) continues to handle
      "app killed mid-paddle-down + reopen with stale cache for a
      now-finalised race session" correctly — no regression.

## E2E walkthrough

Rower completes a 500 m race; FinishOverlay slides in with latched
result + Fertig. **Test 1:** rower taps Fertig — navigates to Home;
FinishOverlay is gone; no SessionEndedOverlay ever appeared. **Test
2:** rower does not tap Fertig; fixture EOF (or short idle-timeout)
fires `session_end` on the backend. The FinishOverlay remains
on screen showing the same latched values. The
`SessionEndedOverlay` does NOT appear. Rower taps Fertig at this
point — still navigates to Home; the second `session_end` is a
no-op via the queue dedup. **Test 3 (regression):** rower runs a
distance-mode workout, completes it, idle-timeout fires — the
`SessionEndedOverlay` DOES appear (current behaviour for non-race
modes).

## E2E spot-checks

- After horn + Fertig click: no element with
  `data-testid="session-ended-overlay"` (or whatever the existing
  testid is — grep for `SessionEndedOverlay` in the FE) appears at
  any point.
- After horn + idle-timeout (no Fertig): `data-testid="finish-
  overlay"` remains in the DOM; `data-testid="session-ended-overlay"`
  does NOT mount.
- For a `distance`-mode session: `data-testid="session-ended-
  overlay"` DOES mount on idle-timeout (regression).
- After horn + Fertig followed by reopen (boot-reconcile path):
  rower lands on Home with unlocked nav, no FinishOverlay still
  showing (handled by useBootReconcile clearing the cached session).

## Blocked by

None — can start immediately.
