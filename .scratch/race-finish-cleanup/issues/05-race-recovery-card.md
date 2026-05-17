# 0019-05 — Race-mode stale-open recovery card — verify and fix if broken

Status: ready-for-agent

- **Type**: AFK · UI
- **Parent**: [PRD-0019](../PRD.md)

## What to build

The CONTEXT.md `§Stale-open session` rules and ADR-0010 / ADR-0012
specify that a race-mode session whose backend row is `ended_at IS
NULL` for >5 minutes should surface the `Frühere Session abschließen?`
recovery card on reopen with **Finalize and Discard options only**
(no "rejoin live", because race-mode sessions are non-resumable).

The original grill flagged that this surface may be silently broken —
the rower experienced a locked nav with no card on reopen after
killing the app. This is independent of issue 0019-04 (boot
reconciliation): that work handles cases where the BE already
finalised the session; this work handles cases where the BE row is
genuinely still stale-open.

Add a Playwright test that seeds a race-mode stale-open session and
asserts the recovery card renders with Finalize and Discard options
(no rejoin). If the test passes against the current implementation,
close the issue as already-working. If it fails, fix the surface
until it passes.

## Acceptance criteria

- [ ] Playwright test exists that seeds a race-mode session with
      `ended_at IS NULL` past the staleness threshold, then opens
      the app as the matching rower.
- [ ] The test asserts the `Frühere Session abschließen?` card
      renders for that session.
- [ ] The test asserts the card offers Finalize and Discard options
      only — no "rejoin live" option (per ADR-0012).
- [ ] The test asserts Finalize closes the session with
      `summary_json.race = null` (per ADR-0012).
- [ ] The test asserts Discard removes the session per existing
      stale-open semantics.
- [ ] Non-race-mode stale-open recovery is unchanged (regression
      coverage — the standard 3-button card with rejoin still works).

## E2E walkthrough

The test seeds a backend session with `mode='race'`,
`workout.params={meters:500}`, `ended_at IS NULL`, and the most
recent stroke timestamp older than the staleness threshold. It then
opens the app as that rower. Home renders the
`Frühere Session abschließen?` card for the stale race. The card
offers exactly two actions: Finalize and Discard (no Rejoin live).
The rower taps Finalize; the backend row updates with `ended_at`
set and `summary_json.race = null`. A second scenario taps Discard
instead; the backend session is removed per the existing discard
path.

## E2E spot-checks

- `data-testid="stale-open-recovery-card"` is present on Home for
  the seeded session.
- Inside that card, `data-testid="stale-recovery-finalize"` and
  `data-testid="stale-recovery-discard"` are present and
  interactive.
- Inside that card, no element with
  `data-testid="stale-recovery-rejoin"` is present.
- After Finalize: the backend session row has
  `ended_at IS NOT NULL` and `summary_json.race = null`.
- After Discard: the backend session row is absent (or marked as
  per the existing discard semantics).
- Regression: for a non-race stale-open session, the same
  `stale-recovery-rejoin` testid IS present alongside the other
  two.

## Blocked by

None — can start immediately.
