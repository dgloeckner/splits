# FEAT-0008: Visual Design System & Responsive UX

- **Status**: Draft
- **Depends on**: ADR-0003 (Go + React, vanilla CSS + CSS custom
  properties, self-hosted fonts)
- **Referenced by**: FEAT-0001 (live view), FEAT-0003 (history),
  FEAT-0004 (statistics), FEAT-0006 (PWA shell)

## Summary

A single in-repo design system that makes the PWA feel **energetic,
modern, and charismatic** across phones, tablets, and desktops, and that
works equally well in light and dark mode. No external component
library; the system is a small set of CSS tokens, a handful of
primitive components, and a responsive layout strategy that every view
in the app shares.

## Design direction

Target feel: the kind of app a rower actually wants open on the ergo
handle-bar — athletic, unfussy, legible from a sweaty metre away, but
with enough personality that it doesn't read as "admin dashboard". The
nearest reference points are Strava's big-type history screens and the
Concept2 ErgData live view, with a warmer palette and tighter
typographic hierarchy.

Explicitly **not**:
- Corporate-SaaS Material-Design look with dense toolbars
- Skeuomorphic gauges / needle dials
- Cartoonish gamification (no badges, no XP bars)

## Responsive strategy

Mobile-first. One codebase, one layout tree, progressive enhancement
via container queries where supported and media queries as fallback.

| Breakpoint label | Min width | Primary target                |
|------------------|-----------|-------------------------------|
| `xs`             | 0 px      | Small phones (≥ 360 px)       |
| `sm`             | 480 px    | Large phones, small foldables |
| `md`             | 768 px    | Tablets (portrait)            |
| `lg`             | 1024 px   | Tablets (landscape), small laptops |
| `xl`             | 1280 px   | Desktop                        |

- Layout uses CSS Grid + Flexbox; no px-based layouts. Spacing is on a
  4 pt scale token (`--space-1`…`--space-12`).
- Typography uses a fluid clamp scale (`clamp(min, preferred, max)`)
  so the live-view digits scale with viewport width without needing
  a breakpoint per viewport.
- Layout examples:
  - **Live view**:
    - `xs`/`sm`: single column, **split** takes ~45 % of viewport
      height with tabular digits, secondary metrics below.
    - `md`: same but wider digits, splits shown with tenths.
    - `lg`/`xl`: split + pace chart side-by-side, SPM/W/cal panels
      around it.
  - **Session history list**:
    - `xs`/`sm`: single-column cards.
    - `md`: two-column grid.
    - `lg`/`xl`: two-column grid + a sticky filters panel.
  - **Session detail**:
    - `xs`/`sm`: stacked — summary, power chart, pace chart, strokes
      table — one per vertical band.
    - `md`+: summary + charts in a 2-up grid, table below.
- Interactive targets ≥ 44 px on touch viewports; pointer-type media
  query (`@media (pointer: fine)`) tightens spacing on desktop.

## Light and dark mode

- `:root` declares the **light** token values; `:root[data-theme="dark"]`
  overrides for dark.
- Initial theme resolves from `prefers-color-scheme`; a setting in the
  PWA overrides to explicit light/dark and persists the choice.
- Theme switches without a flash on load: the theme class is written
  inline in the `<head>` from `localStorage` before React mounts.
- All components reference semantic tokens (`--color-bg`,
  `--color-text`, `--color-accent`, …) — never raw hex.

## Typography

- **Primary family** (body + UI): a modern humanist sans with strong
  tabular-numeral support (e.g. **Manrope**, **Inter**, or **Geist**).
  Single variable font file, weights 400–800. Tabular numerals enabled
  globally via `font-feature-settings: "tnum" 1;` on any numeric node.
- **Display** (live-view digits, large stats): the same family in its
  heaviest weight with `font-stretch` extended where available, **or**
  a sibling face (e.g. **Recursive Sans Casual**) for more character.
  Final choice is a design pass during M2; both are self-hosted as
  `.woff2` under `web/public/fonts/`.
- Type scale, fluid:
  - `display-xl` — live-view split and time digits
  - `display` — big session-detail stat numbers
  - `heading-1` / `-2` / `-3` — view and section titles
  - `body` / `body-sm` / `caption`
- Line height relaxed (1.35–1.5) for body, tight (1.05) for displays.
- Letterform choice **must** support `lnum`/`tnum` OpenType features —
  non-negotiable for the live digits, which otherwise jitter as values
  change.

## Colour system

Tokens defined once, referenced everywhere.

- **Neutrals** (warm): a 12-step scale from near-white to near-black.
  Light mode uses steps 0–3 for surfaces, 8–12 for text; dark mode
  inverts.
- **Accent**: a single energetic signature colour — lean toward
  **electric teal / aqua** (e.g. `#00C2A8`) or **sunrise orange**
  (`#FF7A1A`). Decide during the M2 design pass; the system picks up
  whichever via the `--color-accent` token.
- **Semantic**: `success` (warm green), `warning` (amber), `danger`
  (clean red). Each has `-bg`, `-fg`, and `-accent` variants.
- **Gradients** reserved for display moments (session summary hero, PB
  celebration banner) — never in chrome or controls.
- Contrast: every text-on-surface combination meets WCAG AA (4.5:1 for
  body, 3:1 for large display text).

## Motion

- Short, purposeful. Defaults: 120 ms for state changes, 220 ms for
  view transitions, ease-out.
- Live-view digit changes **do not animate** — changes must be
  instantaneous, the user's eye is already parsing them.
- A subtle accent pulse on each stroke arrival (≤ 80 ms opacity
  ramp on a thin border line) confirms the live stream is alive.
- `prefers-reduced-motion: reduce` disables all non-essential motion.

## Icons and imagery

- Icons: inline SVG React components under `web/src/icons/`. Stroke
  width standardised (2 px at 24 px viewbox). No icon font.
- No stock photography. Session charts and per-stroke data are the
  visual content.
- Rower avatars: generated from the rower's initial on a tinted token
  background, unless/until the user uploads an image (post-v1).

## User stories

- As a rower, I want the live view to be **readable at a 1 m glance**,
  in any lighting, on a phone in portrait mode on the ergo.
- As a rower, I want the app to feel like **one coherent design** on my
  phone during the row and my laptop while browsing history later.
- As a rower, I want the app to **respect my system dark/light mode**
  automatically, and let me override per-app.
- As a user showing a trainer, I want the history views to **look good
  on a tablet / desktop browser**, not just be phone screens stretched
  to fit.

## Acceptance criteria

- [ ] Single `src/styles/tokens.css` defines all colour, spacing,
      radius, font-size, line-height, and elevation tokens. No
      component ever hard-codes a hex, px, or ms value.
- [ ] Light and dark themes pass WCAG AA contrast checks for all
      text + chrome combinations in Chrome DevTools' audit.
- [ ] Live view remains usable and legible down to a 360 × 640 viewport
      (iPhone SE) and up to 1920 × 1080 desktop without horizontal
      scroll or cramped digits.
- [ ] Session list and session detail each have at least two distinct
      responsive layouts (phone vs tablet/desktop) verified in manual
      review.
- [ ] Initial theme renders without a flash: `prefers-color-scheme`
      resolves before first paint.
- [ ] `prefers-reduced-motion` disables all non-essential animation.
- [ ] Fonts are self-hosted `.woff2` under `web/public/fonts/`, loaded
      with `font-display: swap`, and precached by the service worker so
      the first offline launch still looks correct.
- [ ] A visual regression test (Playwright) captures the live view at
      `xs`, `md`, and `xl` in both themes and fails on unreviewed
      pixel-level drift.

## Non-goals

- A third-party UI library (Material, Chakra, Radix full install,
  etc.). Radix *primitives* (unstyled a11y building blocks) are
  permissible if we need them for menus/dialogs; decide per-primitive.
- Tailwind or any atomic-CSS framework. The small, focused CSS
  variable system is the whole design system.
- Animation library (Framer Motion etc.) — native CSS transitions
  cover everything in v1.
- Print stylesheet — not a realistic need for a rowing app.
- RTL support in v1. Structure the CSS so that logical properties
  (`margin-inline`, `padding-block`) are used throughout, so RTL is
  possible later without a rewrite.

## Open questions

- **Concrete font pick**: Manrope vs Inter vs Geist as primary; paired
  display face if any. Decide during the M2 design pass — pick one,
  keep the option to swap via the `--font-family-*` tokens.
- **Accent colour**: teal vs orange vs something else. Resolve in the
  same design pass; a short live-mode usability check (row in the dark
  with each variant) is the tie-breaker.
- **Chart aesthetic**: bars/areas/lines. Lean toward thin lines +
  filled under-area for pace/power over time; revisit in FEAT-0003.
- **Container queries** vs media queries for component-level
  responsiveness: container queries where layout depends on
  **available width** (cards inside a grid), media queries where it
  depends on **viewport** (top-level layout). Decide per component.