# ADR-0010: Session Lifecycle, Phase-Aware UX, and Resumability

- **Status**: Accepted (2026-05-10)
- **Date**: 2026-05-10

## Context

A real-world failure on the Pi exposed a chain of bugs in the session
lifecycle. Reproduction (5K Distance workout, 120 s warmup, 120 s
cooldown):

1. iPhone screen power-saved during cooldown.
2. Strokes stopped arriving at the backend.
3. Frontend pause-detection auto-popped `AbortWorkoutDialog`
   ("Speichern / Weiter / Verwerfen") *during cooldown*, where idleness
   is expected, not a real "did the rower stop?" signal.
4. User tapped "Speichern". `PauseDialog.tsx` fires `endSession()` with
   `.catch(() => {})` AND immediately navigates to `/`.
5. `endSession()` POST silently fails (phone backgrounded, connection
   dead). User lands on home, sees no `SessionEndedOverlay`.
6. DB row stays `ended_at = NULL` forever. `applySessionEnd` never
   runs. PB never recomputes. The "5K PB shows -" bug.

Four distinct issues compound here, only one of which is the literal
PB bug:

- **Wake-lock**: nothing requests `screen-wake-lock`, so iOS power-save
  reliably revokes the live session's connection mid-row.
- **Phase-blind pause detection**: idle-timeout fires identically in
  warmup, work, and cooldown. The dialog has no way to know it is
  interrupting an *expected* idle window.
- **Fire-and-forget end**: navigation happens regardless of whether the
  end-event reaches the backend, with no retry, no surfacing of failure,
  no resume on reconnect.
- **No phase-elapses-=>-session-end UX**: `PhasePlan.Classify` already
  returns `PhaseDone` when cooldown elapses. The backend knows. The
  client never surfaces it. The only path to a clean save is a manual
  tap.

The data model also makes the user distrustful of the app: the IPM
hardware shows cumulative distance (warmup + work) and never resets
between phases, while the app silently filters warmup strokes out of
PB candidates. The user reports "did I really row 5K after warm-up?"
because the two displays disagree by exactly the warmup distance and
nothing in the live UI reconciles them.

## Options considered

### Option A — Patch each symptom independently

Add wake-lock here, fix the silent catch there, add a cooldown screen
later. No unifying principle.

Pro: cheapest change-by-change.

Con: the symptoms are coupled. Patching wake-lock alone still leaves
the phase-blind dialog problem; patching the dialog alone still leaves
the fire-and-forget end problem. We end up with three half-fixes that
together still allow the original chain to recur.

### Option B — Phase-aware lifecycle + resumable end (chosen)

Treat the session lifecycle as one design surface with three
commitments:

1. **The phase model is canonical.** Pause-detection, end-of-session,
   and abort UX all branch on the current `Phase`. Idleness inside
   `PhaseWarmup` or `PhaseCooldown` is not a pause — it is *expected*.
2. **Cooldown elapses → results.** When `PhasePlan` returns
   `PhaseDone`, the client surfaces the `SessionEndedOverlay` and the
   backend records `session_end`. No save-prompt. A "Skip cooldown"
   control finalizes early.
3. **End-of-session is recoverable.** A wake-lock holds the screen on
   for the common case. For the *uncommon* case where it is revoked
   anyway (iOS PWA: switching apps, OS dimming, browser quirks), the
   backend treats an open session with no strokes for > N minutes as
   recoverable: when any client reconnects with that session_id, it is
   offered a "Finalize previous session?" card.

Pro: every issue in the chain is closed, and future similar failures
have a defined recovery path.

Con: more moving parts; backend gains a janitor responsibility for
stale-open sessions; the wake-lock is best-effort by platform fiat.

### Option C — Hard-line wake-lock only

Insist the screen never sleeps; do nothing for resume.

Pro: simpler.

Con: iOS Safari PWA wake-lock is documented as not honored across
visibility changes. Building a load-bearing assumption on it is
fragile.

## Decision

**Option B.** Concretely:

### 1. Phase-aware UX

- The auto-popping `PauseDialog` only fires while `currentPhase ==
  PhaseWork`. In `PhaseWarmup` and `PhaseCooldown` it is suppressed —
  idleness inside those phases is normal.
- Warmup and cooldown each get a dedicated big-countdown view (large
  remaining-time digits, phase label). Same component, different
  copy.
- A small ✕ icon (already implemented in `WorkoutProgressStrip.tsx`)
  opens the existing `AbortWorkoutDialog` (Speichern / Weiter /
  Verwerfen) on demand in *any* phase. Tap-to-open, never auto-popped
  during warmup/cooldown.
- During the work phase of any structured Distance workout, a
  persistent badge under the progress strip shows
  `<workDistanceM> / <targetM> m`. A user-addable "Distance to go"
  tile is also exposed via the FEAT-0001a tile catalogue.

### 2. Auto-end on cooldown completion

- When `PhasePlan.Classify` returns `(_, true)` (PhaseDone), the
  backend emits `session_end` directly; no client tap required.
- The `SessionEndedOverlay` appears on the live screen. The user can
  acknowledge to start a new session or view details. No
  navigation-away on save.

### 3. Wake-lock (best-effort)

- The live page requests `navigator.wakeLock.request('screen')` on
  session-start and re-requests on `visibilitychange` to `visible`.
- Failures are logged but not blocking.

### 4. Resumable session-end

- Backend exposes a janitor-flagged "open session with no strokes for
  > 5 minutes" notion. It does not auto-finalize, but exposes the
  session via the existing session-list as `status: stale-open`.
- On client reconnect, if the rower has a stale-open session, the
  home page offers a "Frühere Session abschließen?" card with three
  options: "Beenden mit gerudertem Stand" (synthesize `session_end`
  from the last stroke), "Verwerfen" (delete), "Weiter rudern" (rejoin
  live).
- `endSession()` becomes resilient: failure surfaces via a toast and
  schedules a retry. Navigation does not happen until the POST has
  either succeeded or been queued for retry.

## Consequences

Easier:

- The PB pipeline is no longer at the mercy of a single fire-and-forget
  POST. Every completed session is recoverable.
- Cooldown becomes a first-class UX state with its own screen and
  honest semantics.
- Future phases (intervals with rest, pyramids) inherit the same
  phase-aware suppression rules for free.

Harder / new work:

- A janitor for stale-open sessions has to be added to the backend.
- Client must distinguish "no strokes because between drives" from "no
  strokes because the connection died" — currently conflated. The
  resume card resolves the latter on reconnect; the wake-lock reduces
  its incidence; only the cross-product (phone died AND user never
  came back) leaks through, and that case is bounded by the janitor.
- The existing `PauseDialog` must learn the phase plan; today it knows
  only "paused / not paused".
- iOS PWA wake-lock is platform-flaky; expect bug reports about it
  not always holding.

## See also

- ADR-0007 (event-ingestion pipeline) — provides the substrate for
  resumable end.
- FEAT-0001a (tile catalogue) — the home of the opt-in "Distance to
  go" tile.
- ADR-0011 (replay-grade persistence + windowed split) — companion ADR;
  windowed split needs strokes retained, which ADR-0011 establishes.
