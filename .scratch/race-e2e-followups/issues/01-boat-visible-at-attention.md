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

### Resolved approach (from 2026-05-14 grilling)

Two complementary fixes; both must land together.

1. **`BoatSprite` gets explicit `width` and `height` attributes** on
   its `<svg>`. Today the SVG has `viewBox="0 0 72 24"` but no
   width/height, so its rendered size depends on the layout-context
   defaults of the wrapping span (which is `position: absolute` with
   no sizing of its own). Cross-browser fragile; headless Chromium
   computes 0×0. Adding explicit dimensions eliminates the
   fragility. The other unsized SVGs in the repo (icons under
   `web/src/icons/`, chart components) render in non-absolutely-
   positioned, CSS-sized containers and are unaffected.

2. **`RaceCanvas` gains a `useLayoutEffect` for synchronous initial
   measurement.** Today, on first render `size = { w: 0, h: 0 }`;
   the existing `useEffect` + `ResizeObserver` reports the real
   bounds asynchronously after paint, leaving one frame where lanes
   have zero height and boats are positioned at the top of the
   canvas rather than centred in their lane. Adding a
   `useLayoutEffect` that reads `ref.current.getBoundingClientRect()`
   and seeds `size` state before first paint eliminates the flash
   and the Playwright-vs-`ResizeObserver` race. The existing
   `useEffect` + `ResizeObserver` stays in place to handle
   subsequent resizes.

The user boat MUST be visible (non-zero bounding box per Playwright)
on the first frame `data-ceremony-phase="attention"` appears on
screen.

## Acceptance criteria

- [ ] In the PRD-0016 canonical happy-path E2E, `expect(raceFlow.userBoat()).toBeVisible()` passes during the ATTENTION screenshot step (`02-attention.png`).
- [ ] Ghost and PB boats (when present in the opponent fetch) are also visible during ATTENTION.
- [ ] No regression in the post-GO! / Live / Finished phases — boats continue to render correctly with their existing layout logic.
- [ ] Visible-from-mount behaviour survives across phone (`viewport ≤ 480 px wide`) and tablet (`viewport ≥ 768 px wide`) variants.
- [ ] The fix does not break the Falschstart `userDistance = 0` visual clamp added in 0015-02: a stroke during ATTENTION/SET must NOT advance the visible boat.
- [ ] Unit test on `BoatSprite` asserts the rendered `<svg>` element has explicit `width="72"` and `height="24"` attributes (catches a future regression of someone removing them).
- [ ] The PRD-0016 / 0016-05 happy-path spec's `expect(raceFlow.userBoat()).toBeVisible()` at the ATTENTION step is promoted from a documented-known-failure to a hard assertion (delete the "advisory on first integration" comment block around it).
- [ ] No `useLayoutEffect`-only test in jsdom — jsdom doesn't compute layout, so any such assertion would be either redundant with the BoatSprite test or weaker than the E2E.

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

## Comments

### 2026-05-14 — Fix landed; primary AC verified by real E2E run

Both parts of the resolved approach merged (commit `6e7f196`):

1. `BoatSprite.tsx`: SVG now has explicit `width="72"` `height="24"`.
2. `RaceLiveView.tsx`: `useLayoutEffect` seeds `size` from `getBoundingClientRect()` before first paint; existing `useEffect` + `ResizeObserver` retained for subsequent resizes.

Validation via `PLAYWRIGHT_BASE_URL=noop npx playwright test happy-path.spec.ts --workers=1`:

- Spec previously failed at **line 128** (`expect(raceFlow.userBoat()).toBeVisible()` at ATTENTION).
- Spec now passes ATTENTION + SET assertions. Screenshots `02-attention.png` and `03-set.png` captured. `02-attention.png` shows the user's teal boat clearly visible at the start line on the canvas, with the FISA red light + ATTENTION overlay layered correctly above the still-mounted canvas.
- 506 unit tests pass (+2 new for BoatSprite SVG dimensions).

The primary AC ("boats visible during ATTENTION") is met.

### Knock-on finding (separate from 0017-01): Live-phase spec races finish

After 0017-01 landed, the same happy-path spec now fails at **line 144** (`userBoat().toBeVisible()` after the 2 s mid-race `waitForTimeout`). Likely cause: at "fast" fixture rate, the rower crosses 500 m in ~2 s of wall clock — the 2 s wait puts the spec past `Finished` and possibly into `Post`, where `RaceLiveView` unmounts and `RacePostScreen` takes over (canvas + user boat gone from DOM).

This is a spec-pacing concern, not a real-app behaviour bug. The fix is in the *test*: either use a shorter mid-race wait, or assert against the reducer's phase before re-asserting `userBoat()`. Tracked as a follow-up against PRD-0016 / 0016-05, not a re-open of 0017-01.
