# 0017-01 — User + opponent boats visible at the start line during Ceremony(ATTENTION)

Status: ready-for-agent

- **Type**: AFK · UI
- **Parent**: [PRD-0017](../PRD.md)
- **Surfaced by**: [PRD-0016 / 0016-05](../../e2e-automation/issues/05-canonical-happy-path.md)
- **Related**: [ADR-0013](../../../specs/adr/0013-race-canvas-mounts-at-attention.md), PRD-0015 user story 1

## What to build

PRD-0015 / 0015-02 (per ADR-0013) made the race canvas mount at
`Ceremony(ATTENTION)` so GO! produces no mount/swap flash, but the
boats are not actually visible on the frame the canvas first mounts.
The PRD-0016 canonical happy-path walkthrough surfaced this: the
`<span data-testid="boat-user">` is in the DOM during ATTENTION, but
Playwright's `toBeVisible` check returns "hidden" (zero bounding box).

Root cause (suspected): `RaceCanvas` reads viewport size via a
`ResizeObserver` that fires asynchronously after mount. On the first
frame `size = { w: 0, h: 0 }`, so `canvasH = max(0, h - 56) = 0`,
each `Lane` has zero height, and the sprite span either has no
positioning context (zero parent height) or fails the `onScreen`
predicate (`Math.abs(offsetPx) <= paneWidth/2 - SPRITE_HALF_WIDTH`
with `paneWidth = 0`).

Fix the gap so the rower sees their boat (and ghost + PB) at the
start line on the same visual frame the canvas appears.

Likely approaches (pick whichever is cleanest after exploration):

- **Synchronous initial size via `useLayoutEffect`** — measure the
  container's `getBoundingClientRect` synchronously before paint,
  seed the `size` state with that value. The `ResizeObserver` then
  takes over for subsequent changes.
- **Initial size from the parent's known bounds** — pass viewport
  dimensions from `LivePage` (which already fills `100dvh`) into
  `RaceCanvas` as initial props.
- **Soft fallback in `Lane`** — if `paneWidth === 0`, render the
  sprite at a stable known offset (e.g. centered) rather than gating
  on `onScreen`. Less faithful to the production rendering once
  layout settles, but bulletproof on first frame.
- **Intrinsic minimum size on `BoatSprite`** — give the SVG a fixed
  px width/height so Playwright sees a non-zero bounding box even if
  the lane is still being measured.

Whichever path is taken, the user boat MUST be visible (non-zero
bounding box per Playwright) by the time `data-ceremony-phase="attention"`
appears on screen.

## Acceptance criteria

- [ ] In the PRD-0016 canonical happy-path E2E, `expect(raceFlow.userBoat()).toBeVisible()` passes during the ATTENTION screenshot step (`02-attention.png`).
- [ ] Ghost and PB boats (when present in the opponent fetch) are also visible during ATTENTION.
- [ ] No regression in the post-GO! / Live / Finished phases — boats continue to render correctly with their existing layout logic.
- [ ] Visible-from-mount behaviour survives across phone (`viewport ≤ 480 px wide`) and tablet (`viewport ≥ 768 px wide`) variants.
- [ ] The fix does not break the Falschstart `userDistance = 0` visual clamp added in 0015-02: a stroke during ATTENTION/SET must NOT advance the visible boat.
- [ ] Component tests for `RaceCanvas` cover the zero-size-initial-mount case (assert the sprite renders at center regardless of `viewportWidth=0`).
- [ ] The E2E happy-path spec's boat-visibility spot-check (currently a documented known-failure) becomes a hard assertion.

## E2E walkthrough

Same scenario as PRD-0016 / 0016-05 (canonical race happy-path). The
existing screenshots `01-bereit.png` and `02-attention.png` already
exercise the path; the `userBoat()` assertion at ATTENTION goes from
documented-known-failure to required-pass.

## E2E spot-checks

- `boat-user` is visible (non-zero bounding box) during `data-ceremony-phase="attention"`.
- `boat-ghost` and `boat-pb` are visible when their respective opponents are present.
- The user boat does NOT advance horizontally during ATTENTION/SET, even if a stroke is forwarded into the reducer (Falschstart visual clamp from 0015-02).
- No flicker between BereitScreen unmount and the first canvas frame.

## Blocked by

None — can start immediately.
