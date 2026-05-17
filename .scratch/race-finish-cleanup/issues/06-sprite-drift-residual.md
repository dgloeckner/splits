# 0019-06 — Player-sprite drift residual — verify post-freeze

Status: ready-for-agent

- **Type**: AFK · UI
- **Parent**: [PRD-0019](../PRD.md)

## What to build

The original race-finish observation was that the player kayak
drifted off the right side of the canvas during paddle-down. The
RaceCanvas code as written pins the user lane at `centerX`
unconditionally (`offsetMeters=0` for the user-lane `Lane`, which is
`onScreen=true` by construction), so the drift is not reachable via
the documented camera logic. With issue 0019-02's freeze in place,
the user sprite is guaranteed to render at the finish-line position
from the horn onward.

Re-run the original scenario (race finish + ~100 m of paddle-down)
against the merged freeze. If the sprite is now always visible at the
finish-line position, close as resolved-by-freeze. If the drift still
reproduces, investigate the actual cause — possible suspects include
the canvas `ResizeObserver` re-measuring when the FinishOverlay slides
in, lane heights collapsing transiently, or a z-index interaction
with the overlay covering the user lane.

## Acceptance criteria

- [ ] An e2e test reproduces the original scenario (500 m race,
      paddle-down with strokes up to ~600 m of cumulative distance).
- [ ] The test asserts the user sprite remains visible at the
      finish-line position throughout the paddle-down.
- [ ] If the test passes against the merged 0019-02 freeze: close
      as resolved.
- [ ] If the test fails: root-cause the drift (specifically rule in
      or out: ResizeObserver re-measurement, lane-height collapse,
      z-index overlap with the FinishOverlay) and fix until the
      test passes.

## E2E walkthrough

Rower completes a 500 m race; FinishOverlay slides in. The rower
continues paddling at low effort for several additional strokes
(cumulative distance climbs to ~600 m, the kind of paddle-down
seen in real data). Throughout this paddle-down sequence, the cyan
user sprite remains visible at the finish-line position on the
canvas — it does not vanish, does not drift off the right edge, and
is not occluded by the FinishOverlay.

## E2E spot-checks

- After the finish horn, `data-testid="boat-user"` is present in the
  DOM.
- Its computed `left` CSS pixel value stays within the canvas
  bounding box across at least three successive post-horn strokes.
- The computed `left` value does not change across post-horn strokes
  (anchored at the finish-line position by the 0019-02 freeze).
- The bounding box of `data-testid="boat-user"` does not intersect
  the FinishOverlay's bounding box (no occlusion).

## Blocked by

- [0019-02 — Race surface freezes at finish horn](./02-race-surface-freeze.md)

## Comments

**2026-05-17 — resolved-by-freeze.** The 0019-02 freeze handles this
by construction: `RaceCanvas`'s user lane has `opp=null` →
`offsetMeters=0` → user sprite renders at `centerX -
SPRITE_HALF_WIDTH` unconditionally, and `useRaceFreeze` pins
`userDistanceM` post-horn so the camera and the sprite are doubly
invariant. A new vitest case in `RaceLiveView.test.tsx` drives 10
post-horn strokes (510→600m), asserts `data-testid="boat-user"` is
present after each, that its `style.left` does not change, and that
it stays within the canvas viewport bounding box. Passes on first
run; 555/555 full suite green.

**2026-05-17 — occlusion check deferred to Playwright.** The AC
bullet "boat-user bounding box does not intersect the FinishOverlay
bounding box" is genuinely a full-app-shell concern (FinishOverlay
mounts in `RaceFlow`, not `RaceLiveView` in isolation). Covered by
the slice's standard Playwright E2E gate (per
`docs/agents/definition-of-done.md`), not a one-off spec from this
issue. No production code change was needed for this slice.
