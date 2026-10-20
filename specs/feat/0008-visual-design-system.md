# FEAT-0008: Visual Design System & Responsive UX

- **Status**: Shipped
- **Depends on**: ADR-0003 (Go + React, vanilla CSS + CSS custom
  properties, self-hosted fonts)
- **Referenced by**: FEAT-0001 (live view), FEAT-0001a (customisable
  dashboard), FEAT-0003 (history), FEAT-0003a (enhanced history &
  trends), FEAT-0004 (statistics), FEAT-0005a (workout selection),
  FEAT-0006 (PWA shell)

## Summary

A single in-repo design system, **"Precision Sport-Instrumentalism"**,
with the creative north star **"The Precision Chronometer"**. The PWA
must read less like a website and more like a custom-milled piece of
hardware — high-contrast, data-dense, legible from a sweaty metre away.
No external component library; the system is a small set of CSS tokens,
a handful of primitive components, and a responsive layout strategy
that every view in the app shares.

## Brand mark

The canonical logo source is **`home_ergo_pyramid_logo_family.svg`** at the
repo root — a single multi-variant artboard containing:

- **Primärmarke**: three primary-mark variants
  - Monochrom hell (black mark on light surface)
  - Monochrom dunkel (white mark on dark surface)
  - **Akzent auf dunkel** — the in-app default
- **Größenreihe**: the same mark at 512 / 192 / 96 / 48 px showing
  optical adjustments per size.
- Wordmarks (horizontal + vertical) and favicon sizes further down
  the artboard.

The mark itself is a **pyramid of five vertical bars** (centre tallest,
flanks decaying via opacity 1.0 → 0.55 → 0.3) over a **horizontal
"water line"** in the accent colour. The pyramid encodes progression
/ pyramid-workouts; the water line echoes rowing.

PWA icons (`pwa-192.png`, `pwa-512.png`, `favicon.svg`) and any
marketing surfaces derive from this file; do not hand-paint new
variants.

## Canonical visual prototype

The authoritative visual reference is the **Stitch project**
`projects/16112355480769913997` ("Home Ergo Tracker"). It contains the
resolved design theme and mocked screens for every M2-forward feature:

- Live-Ansicht (Refined, Edit Mode, Workout Aktiv, Tablet Portrait/Landscape)
- Workout-Auswahl flow: Ziel (1/4), Distanz / Zeit / Intervalle / Pyramide (2/3), Intensität (3/4), Intervalle-Konfiguration (3/4), Bereit? Confirmation (4/4)
- Workout abgeschlossen variants: Geschafft, Neue Bestzeit, Effizienz-Profi, Konstanz-Meister, Power-Peak
- Historie: Sessions Liste (Refined), Trends (Refined), Tablet variants
- Sitzungs-Details and Sitzungs-Details Deep Dive
- **User Profile** (Mobile, Tablet Portrait, Tablet Landscape) **and "User Profile (Light Mode)"** — the only screen currently rendered in both themes; it hosts the theme switcher (see FEAT-0004)
- Tile-Picker Modal (and Linked variant for long-press-from-live)

When a concrete spec conflicts with the prototype, the prototype wins
until both are updated in lock-step.

## Design direction

**Functional Brutalism** — every element exists to serve a metric.
**Instrumental Depth** — surfaces suggest a backlit physical screen via
tonal layering, not gradients or shadows. **German Sachlichkeit** —
objective, authoritative, unfussy copy; no gamification chrome.

Explicitly **not**:

- Corporate-SaaS Material-Design look with dense toolbars
- Skeuomorphic gauges / needle dials
- Cartoonish gamification (no badges, XP bars, confetti)
- Soft / friendly consumer-fitness aesthetic

## Colour

**Dark mode is the default and the design target.** Light mode is a
legibility fallback, not a co-equal theme.

Resolved tokens (from the Stitch theme; mirrored as CSS custom
properties in `src/styles/tokens.css`):

| Token                          | Value     | Usage                               |
|--------------------------------|-----------|-------------------------------------|
| `--color-surface`              | `#131313` | Base background                      |
| `--color-surface-container-lowest` | `#0d0e0e` | Input wells                     |
| `--color-surface-container-low` | `#1b1c1c` | Large layout blocks                  |
| `--color-surface-container`    | `#1f2020` | Interactive / nested cards           |
| `--color-surface-container-high`| `#292a2a` | Secondary button bg, higher nest     |
| `--color-surface-container-highest` | `#343535` | Progress-bar track              |
| `--color-on-surface`           | `#e4e2e1` | Primary text, hero digits            |
| `--color-on-surface-variant`   | `#bcc9ca` | Labels, captions                     |
| `--color-outline-variant`      | `#3d494a` | Ghost borders (20 % opacity only)    |
| `--color-primary`              | `#5dd7e4` | Accent, active states, hero-split    |
| `--color-primary-container`    | `#00a3af` | Primary button / functional gradients|
| `--color-on-primary`           | `#00363b` | Text on primary                      |
| `--color-tertiary`             | `#ffb786` | PB ribbons, warnings — sparingly     |
| `--color-error`                | `#ffb4ab` | Destructive / unreachable            |

### Rules

- **No 1 px dividers.** Section boundaries come from background shifts
  across the surface-container hierarchy. Gaps (16 / 24 px) replace
  lines.
- **No decorative gradients.** A subtle vertical `primary` →
  `primary-container` gradient is allowed only on primary actions and
  active workout states (the "Active Glow").
- **No heavy shadows.** Depth via tonal layering. If a card must
  float: `box-shadow: 0 12px 32px rgba(0, 0, 0, 0.4)` only.
- **Active glow** on live indicators (running timer, stroke-pulse,
  active segment): soft `primary` outer glow via `drop-shadow`.
- **Glassmorphism** only for floating overlays (e.g. pause menu,
  tile-picker on phone): `surface-container` at 70 % opacity + 20 px
  backdrop-blur.
- Contrast: every text-on-surface combination meets WCAG AA (4.5:1
  body, 3:1 large display).

## Typography

Paired families, both self-hosted as `.woff2` under
`web/public/fonts/`, loaded with `font-display: swap`, precached by
the service worker:

- **Space Grotesk** — all numeric data and headings ("data authority")
- **Inter** — body copy, labels, system UI ("legibility")

| Token           | Size / line | Family         | Usage                                  |
|-----------------|-------------|----------------|----------------------------------------|
| `display-lg`    | 72 / 1.1    | Space Grotesk  | Hero split (FEAT-0001), big stats      |
| `headline-sm`   | 20 / 1.2    | Space Grotesk  | Section headers ("Letzte Aktivität")   |
| `title-md`      | 16 / 1.25   | Space Grotesk  | Unit indicators after hero numbers      |
| `body-lg`       | 16 / 1.5    | Inter          | Descriptions, settings, notes           |
| `label-sm`      | 11 / 1.0    | Inter          | Data labels (e.g. "SCHLÄGE/MIN")        |

Rules:

- **Labels / captions** are always **uppercase** with `0.05em`
  letter-spacing — mimics professional telemetry.
- **Tabular numerals** required for every numeric node:
  `font-feature-settings: "tnum" 1, "lnum" 1;`.
- Line-height: relaxed (1.35–1.5) for body, tight (1.05–1.2) for
  displays.
- **Live-view digits do not animate** on value change — instant
  updates.

## Elevation & depth — the layering principle

Depth is achieved via **tonal layering**, not shadows:

- **Surface hierarchy**: `surface` → `surface-container-low` →
  `surface-container` → `surface-container-high`. Each step up is a
  cell lifting from its parent.
- **Ghost borders** (`outline-variant` at 20 % opacity) replace
  traditional 1 px dividers in form fields.
- **Active glow** (see Colour) signifies "live instrument".

## Spacing, grid, radius

- **8 pt base grid.** All spacing tokens are multiples of 8 — `--space-1`
  = 8 px, `--space-2` = 16 px, `--space-3` = 24 px, … (expose `4` as a
  half-step only where a 4 pt inset is unavoidable).
- **24 px minimum** between major data blocks ("Atemraum").
- **Radius**: 8 px for buttons (`--radius-button`), 12 px for cards
  (`--radius-card`). **Nothing larger than 12 px.**
- Progress-bar indicators: **no rounded ends** (keep "instrument-sharp").

## Components (excerpt — primitives live in `web/src/components/`)

### Buttons (Schaltflächen)

- **Primary**: bg `primary` (#5dd7e4), text `on-primary` (#00363b),
  radius 8 px. "Start", "Speichern", "Workout starten".
- **Secondary**: bg `surface-container-high`, text `on-surface`.
- **Tertiary**: no bg, `primary` text. "Abbrechen", "Details".

### Metric cards (Leistungskarten)

Three-part stack, no dividers:

1. `label-sm` in `on-surface-variant` (e.g. `DISTANZ`)
2. `display-lg` in `on-surface` (e.g. `2000`)
3. `title-md` unit indicator (e.g. `m`)

16 px internal padding (2 × 8 pt grid).

### Input fields

- Resting: bg `surface-container-lowest`, ghost border (20 %
  `outline-variant`).
- Active: border → 100 % `primary`.

### Progress bars

- Track: `surface-container-highest`.
- Indicator: solid `primary`, **no rounded ends**.

## Copy

- **German throughout the app.** "Training starten", not "Los geht's".
- Authoritative, objective, unfussy. No emoji in chrome (a PB ribbon
  `🏆` is the documented exception).
- Labels uppercase + tracked. Body copy sentence-case.
- **Numbers use the German decimal comma** — `1:48,0`, `28,6`, `9,55`
  — wherever the app prints a fraction, so the server-rendered insight
  texts (FEAT-0011) and the client-rendered values read alike on one
  screen. One formatter per metric (`formatMetric`,
  `web/src/components/charts/format.ts`) owns precision and separator;
  call sites never format a metric by hand. Applied on the session
  detail page first (#40); other screens follow as they are touched.

## Responsive strategy

Mobile-first. One codebase, one layout tree. Progressive enhancement
via container queries where supported, media queries as fallback.

| Breakpoint | Min width | Primary target                    |
|------------|-----------|-----------------------------------|
| `xs`       | 0 px      | Small phones (≥ 360 px)           |
| `sm`       | 480 px    | Large phones, small foldables     |
| `md`       | 768 px    | Tablets (portrait)                |
| `lg`       | 1024 px   | Tablets (landscape), small laptops|
| `xl`       | 1280 px   | Desktop                            |

- CSS Grid + Flexbox; no px-based layouts.
- Typography scales fluidly via `clamp()` so hero digits grow with
  viewport without a breakpoint per device.
- Interactive targets ≥ 44 px on touch; `@media (pointer: fine)`
  tightens spacing on desktop.

Layout examples (authoritative mocks live in the Stitch project):

- **Live view**:
  - `xs`/`sm`: single column, hero split ~45 % of viewport height,
    2×3 tile grid below.
  - `md`: same structure, wider digits.
  - `lg`/`xl`: hero + pace chart side-by-side; expanded tile grid
    (3×3 or 2×4).
- **Session history**:
  - `xs`/`sm`: single-column cards + infinite scroll.
  - `md`: two-column grid.
  - `lg`/`xl`: two-column grid + sticky filter panel.
- **Session detail**:
  - `xs`/`sm`: stacked hero + four charts + splits table.
  - `md`+: charts in a 2-up grid, hero full-width on top, table below.

## Light and dark mode

Both themes are first-class. **Dark is the design target** for the
live-view and most instrumental surfaces, but light must be equally
polished — the Stitch prototype includes "User Profile (Light Mode)"
as the reference rendering.

- `:root[data-theme="dark"]` and `:root[data-theme="light"]` each
  declare a full set of semantic tokens. Light tokens still obey the
  no-1-px-dividers / tonal-layering rules, just inverted with warm
  off-whites for surface and deep charcoal for text.
- Initial theme resolution order:
  1. Explicit user override from `localStorage` (set via the Theme
     Switcher in User Profile / FEAT-0004) — highest priority.
  2. `prefers-color-scheme` OS setting.
  3. Dark as the default when preference is "no preference".
- The theme class is written inline in `<head>` from `localStorage`
  before React mounts — no flash.
- Theme switch is **global** (applied to `<html>`), takes effect
  instantly, and persists per user profile.
- All components reference semantic tokens — never raw hex.

## Motion

- Short, purposeful. Defaults: 120 ms state changes, 220 ms view
  transitions, ease-out.
- Hero digit changes do **not** animate.
- Stroke-pulse (FEAT-0001): ≤ 80 ms opacity ramp on a thin accent
  ring per stroke arrival.
- Active workout segment: soft primary glow via `drop-shadow`.
- `prefers-reduced-motion: reduce` disables all non-essential motion.

## Icons and imagery

- Icons: inline SVG React components under `web/src/icons/`. Stroke
  width 2 px at 24 px viewbox. No icon font.
- No stock photography; charts and per-stroke data are the visuals.
- Rower avatars: generated from initial on a tinted token background
  until the user uploads (post-v1).

## User stories

- As a rower, I want the live view to be **readable at a 1 m glance**
  in any lighting, on a phone in portrait mode on the ergo.
- As a rower, I want the app to feel like **one coherent instrument**
  on my phone during the row and my laptop while browsing history later.
- As a rower, I want **instant digit updates** on the live view — no
  animation between values.
- As a user showing a trainer, I want history views to **look right on
  tablet / desktop**, not a stretched phone screen.

## Acceptance criteria

- [ ] Single `src/styles/tokens.css` defines all colour, spacing,
      radius, font-size, line-height, motion tokens. No component ever
      hard-codes a hex, px, or ms value.
- [ ] Colour tokens match the table above byte-for-byte.
- [ ] Typography uses **Space Grotesk** for numerics and headings and
      **Inter** for body / labels; both self-hosted as `.woff2`.
- [ ] Tabular numerals (`tnum`, `lnum`) active on every numeric node.
- [ ] **No 1 px solid dividers** anywhere in the app; section
      boundaries use background shifts + gaps.
- [ ] **No rounded corners > 12 px** anywhere.
- [ ] WCAG AA contrast verified in Chrome DevTools for both themes.
- [ ] Live view remains usable at 360 × 640 up to 1920 × 1080 without
      horizontal scroll or cramped digits.
- [ ] Session list and detail each have ≥ 2 distinct responsive
      layouts, matching the Stitch mocks within reason.
- [ ] Initial theme renders without flash.
- [ ] `prefers-reduced-motion` disables non-essential motion.
- [ ] Fonts precached by the service worker; first offline launch
      looks correct.
- [ ] A Playwright visual-regression test captures the live view at
      `xs`, `md`, and `xl` and fails on unreviewed drift.

## Non-goals

- Third-party UI library (Material, Chakra, Radix full install).
  Radix *primitives* (unstyled a11y building blocks) permissible
  per-component if needed.
- Tailwind or any atomic-CSS framework.
- Animation library (Framer Motion etc.) — native CSS transitions
  cover v1.
- Print stylesheet.
- RTL in v1. Use logical properties (`margin-inline`, `padding-block`)
  throughout so RTL is possible later.

## Resolved design decisions (previously open questions)

- ~~Font pick~~: **Space Grotesk + Inter** (Stitch theme).
- ~~Accent colour (UI)~~: **electric teal** `#5dd7e4` / `#00a3af` (Stitch).
- ~~Light vs dark priority~~: both first-class; **dark is the default**,
  light is fully designed (see Stitch "User Profile (Light Mode)")
  and user-switchable.
- ~~Ship light in M2?~~ **Yes** — theme switcher lives on the User
  Profile (FEAT-0004).
- ~~Brand mark~~: **yes** — the pyramid + water-line mark in
  `home_ergo_pyramid_logo_family.svg`, not typography alone.
- ~~Accent-colour mismatch between logo and UI~~: resolved — the logo
  SVG (`home_ergo_pyramid_logo_family.svg`) and the Stitch theme are
  now aligned.
- ~~Chart aesthetic~~: thin lines, filled under-area for pace/power
  over time; zone bands as background for HF. Final chart primitives
  in FEAT-0003a.
- ~~Container queries vs media queries~~: container queries where
  layout depends on available width (cards inside a grid), media
  queries for top-level viewport layout.

## Open questions

- Do we need full **light-mode colour tokens** (all surface/container
  steps + tertiary + secondary), or is a narrower set enough for the
  screens that render in light? The prototype only shows light on the
  profile so far.
- Tablet-landscape hero: does the pace chart sit to the right of the
  hero, or below it inside the hero block? Prototype shows right;
  revisit once the SSE data rate is confirmed.
