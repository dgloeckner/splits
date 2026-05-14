# 0015-01 — LivePage viewport fill (race canvas regains height)

Status: ready-for-agent

- **Type**: AFK
- **Parent**: [PRD-0015](../PRD.md)

## What to build

Fix the bug where the race canvas region renders at 0 px height after GO!,
so the rower sees only the stat bar over a black screen with no track or
boats. Root cause: `LivePage`'s page container is `display: grid` with no
explicit height, so `RaceLiveView`'s inner `grid-template-rows: 56px 1fr`
collapses the `1fr` canvas row.

Give the page container a viewport-based fill so the canvas pane has a
real height to fill. Use `min-height: 100dvh` so mobile chrome (URL bar
showing/hiding) does not truncate. Non-race modes are unaffected because
their children define intrinsic heights.

Add a regression test that fails today: render `LivePage` in race mode
inside a sized container and assert the race-canvas region has a non-zero
computed height (or, equivalently, that the canvas's children render at
a non-zero rect).

## Acceptance criteria

- [ ] `LivePage`'s page container fills the viewport (`min-height: 100dvh`).
- [ ] In race mode, the canvas region (where lanes + boats render) has a non-zero height at any common phone or tablet viewport size.
- [ ] Non-race modes (distance, time) render unchanged — no visual regression.
- [ ] Regression test asserts the race canvas region is sized > 0 in race mode.
- [ ] Full test suite green.

## Blocked by

None — can start immediately.
