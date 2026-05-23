# 0019-09 — Layout: respect bottom-nav reserved zone in fixed overlays/cards

Status: ready-for-agent

- **Type**: AFK · UI
- **Parent**: [PRD-0019](../PRD.md)

## What to build

Two E2E findings from the 0019 slice cluster surfaced the same
class of bug: a key interactive control sits at the very bottom of
the mobile viewport and is either clipped or visually crowded by
the persistent `BottomNav`.

- **FinishOverlay's Fertig button** — even at the mobile viewport
  390×844, partially below the fold at mount.
- **StaleSessionCard's Discard button** — partially occluded by
  `BottomNav` on the same viewport.

`AppLayout.module.css` already exposes `--layout-bottom-nav-h` and
applies `padding-bottom: var(--layout-bottom-nav-h)` to its main
content slot. Fixed-position overlays/cards positioned with `bottom:
0` (or equivalent) escape that padding. The rule going forward is:
**any fixed-position bottom-anchored element whose content includes
interactive controls must offset by `var(--layout-bottom-nav-h)`** —
either via `bottom: var(--layout-bottom-nav-h)`, or via
`padding-bottom: max(env(safe-area-inset-bottom), var(--layout-
bottom-nav-h))` if the overlay must visually extend to the screen
edge while its interactive content respects the nav.

This slice applies the rule to the two known offenders and adds an
E2E assertion that catches regressions across both surfaces.

## Acceptance criteria

- [ ] On the mobile viewport 390×844, the FinishOverlay's
      `data-testid="finish-fertig"` button is fully visible at
      mount (no scroll required); its bounding rect does not
      intersect the `BottomNav` bounding rect.
- [ ] On the same viewport, the StaleSessionCard's
      `data-testid="stale-recovery-discard"` button is fully
      visible; its bounding rect does not intersect the
      `BottomNav` bounding rect.
- [ ] Visual layout of both surfaces at desktop viewports is not
      regressed (the rule applies equally on desktop since the
      nav is always present).
- [ ] If `--layout-bottom-nav-h` is not exposed on a CSS scope
      reachable from these components, expose it consistently
      (it should already be on `:root` or a wrapping element;
      verify and fix if not).
- [ ] No production change to `BottomNav` itself; only the
      offending overlays/cards.

## E2E walkthrough

**Scenario A — Fertig visibility.** Rower completes a 500 m race
on 390×844. FinishOverlay slides in. The Fertig button is fully
visible without scrolling and sits clearly above the BottomNav.

**Scenario B — Discard visibility.** Open the app as a rower with
a seeded stale-open session. The
`stale-open-recovery-card` mounts on Home. Finalize and Discard
buttons are both fully visible above the BottomNav.

## E2E spot-checks

- Scenario A: `boundingBox(finish-fertig).y + boundingBox(finish-
  fertig).height <= boundingBox(bottom-nav-workout).y`
  (Fertig is fully above the nav).
- Scenario A: full Fertig button rect is within `[0, viewportHeight]`
  (no clipping).
- Scenario B: `boundingBox(stale-recovery-discard).y +
  boundingBox(stale-recovery-discard).height <=
  boundingBox(bottom-nav-workout).y`.
- Scenario B: full Discard button rect is within `[0,
  viewportHeight]`.
- Regression: existing freeze / fertig / boot-reconcile / recovery-
  card / sprite-drift specs continue to pass unchanged.

## Blocked by

None — can start immediately.

## Follow-up (not in this slice)

The initial fix used `bottom: var(--layout-bottom-nav-h)` / `margin-bottom:
var(--layout-bottom-nav-h)`, which reads the bare 64px token but ignores
the `env(safe-area-inset-bottom)` that `BottomNav.module.css` adds on top
via its own `padding-bottom`. On iPhones with a home indicator the rendered
nav is ~98px tall, so the original fix left Fertig/Discard ~34px short of
clearance on real iOS. Patched by switching both rules to
`calc(var(--layout-bottom-nav-h) + env(safe-area-inset-bottom))`.

The existing Playwright spot-checks did not catch this because the headless
test viewport reports `env(safe-area-inset-bottom) = 0` — both the buggy
and the patched form satisfy the bbox assertion there. Follow-up: add a
Playwright project (or per-test fixture) that simulates a non-zero
safe-area inset (e.g. emulate an iPhone device descriptor, or inject a
`<meta>` / CSS override that forces the inset) so this regression class is
catchable headlessly in CI.
