# UI Foundation + Live View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Take the frontend from "empty scaffold with a HealthIndicator" to a working Live View — design-system tokens + primitives, routed app shell, SSE-driven state, the fixed hero block, and the customisable 2×3 tile grid with picker. This is the primary interaction surface of the app; everything else (history, profile, goals, workout builder, PWA offline cache) gets its own follow-up plan once this lands.

**Architecture:** React 19 + TypeScript. Vanilla CSS with tokens in `src/styles/tokens.css`, component-scoped `*.module.css` files (built-in Vite support, no extra deps). `react-router-dom` for routing. Context + `useReducer` for live-session state (no Redux / TanStack Query in this phase — those arrive with history in the next plan). Custom `useEventSource` hook wraps native `EventSource` with a test seam (a `Channel` abstraction) so tests drive the reducer without real SSE. Self-hosted fonts via `@fontsource-variable/*` packages (precached by the existing service worker config). Component tests with `vitest` + `@testing-library/react`. End-to-end sanity via Playwright (Playwright is already the project's E2E choice per FEAT-0008).

**Tech Stack additions in this plan:**
- `react-router-dom@^7`
- `@fontsource-variable/space-grotesk`, `@fontsource-variable/inter`
- `vitest`, `@vitest/ui`, `jsdom`, `@testing-library/react`, `@testing-library/jest-dom`, `@testing-library/user-event`
- `@playwright/test` (dev-only, for the visual-regression smoke)

**Spec references:**
- [`specs/feat/0008-visual-design-system.md`](../../specs/feat/0008-visual-design-system.md) (FEAT-0008) — tokens, typography, components, responsive strategy.
- [`specs/feat/0001-realtime-live-view.md`](../../specs/feat/0001-realtime-live-view.md) (FEAT-0001) — hero block.
- [`specs/feat/0001a-customizable-live-dashboard.md`](../../specs/feat/0001a-customizable-live-dashboard.md) (FEAT-0001a) — tile grid + picker.
- [`specs/feat/0001a-tile-catalogue.md`](../../specs/feat/0001a-tile-catalogue.md) — canonical tile index.
- [`specs/feat/0007-rowing-metrics-catalogue.md`](../../specs/feat/0007-rowing-metrics-catalogue.md) — metric definitions for tile bindings.
- [`specs/int/0002-live-stream-sse.md`](../../specs/int/0002-live-stream-sse.md) (INT-0002) — SSE wire format.

**Out of scope (deferred to follow-up plans):**
- Session history list & detail (FEAT-0003, FEAT-0003a)
- User profiles, QR pairing, rower switching (FEAT-0002)
- Per-user statistics & theme switcher UI (FEAT-0004) — **but** the theme infrastructure (tokens, pre-mount resolution, toggle function) is built here so FEAT-0004 only has to add the UI surface.
- Training goals (FEAT-0005)
- Workout builder + workout-aware live view (FEAT-0005a)
- PWA offline data caching (FEAT-0006) — the service-worker app-shell is already registered in M1; data caching is a separate plan.
- HR source integration (INT-0001 HR open question). HR-gated tiles appear in the picker as disabled.
- Multiple rower profiles. For this plan there is a single implicit profile; tile choices persist to `localStorage` under a fixed key. The follow-up FEAT-0002 plan swaps the storage key for a per-rower one.

**Resolved design decisions (locked during this plan):**
- Tile-picker: **flat list** (matches Stitch prototype). The three-category split described in FEAT-0001a's narrative is deferred; the picker entries are ordered by tile type (Numeric → Sparkline → Zone Badge) within the flat list so adding headers later is a no-op.
- Sparkline Y-scale: **auto-fit** per tile (FEAT-0001a open question, resolved to auto-fit for legibility).
- Tile-picker while live: **hero keeps updating** behind the bottom-sheet (FEAT-0001a open question, resolved as leaning).
- Storage key for tile layout: `home-ergo:tile-layout:v1`. Incrementing the `v1` suffix is the migration path; no schema migration in this plan.
- Ordering: **position-driven** (row/col). The picker opens for a specific slot; selecting a tile swaps that slot. No implicit "add to next empty".

---

## File Structure

Files created or modified in this plan (all under `web/`):

```
web/
├── package.json                            (modified: new deps + scripts)
├── vite.config.ts                          (modified: vitest config, fontsource manifest hints)
├── tsconfig.app.json                       (modified: "types" for vitest + testing-library)
├── playwright.config.ts                    (new)
├── public/
│   └── fonts/                              (new — but @fontsource ships the woff2 via npm, so this stays empty unless we self-host manually)
├── src/
│   ├── main.tsx                            (modified: mount <AppRouter>, remove <App/> demo)
│   ├── App.tsx                             (removed — placeholder from M1)
│   ├── App.css                             (removed — placeholder from M1)
│   ├── HealthIndicator.tsx                 (moved → src/app/HealthIndicator.tsx, unchanged)
│   ├── setupTests.ts                       (new — jest-dom matchers)
│   ├── styles/
│   │   ├── tokens.css                      (new)
│   │   ├── reset.css                       (new)
│   │   ├── base.css                        (new — typography scales, html/body)
│   │   └── theme.ts                        (new — TS re-export of token names + ThemeKind type)
│   ├── theme/
│   │   ├── preMountScript.ts               (new — built into index.html inline)
│   │   ├── useTheme.ts                     (new — React hook for read/set)
│   │   └── useTheme.test.ts                (new)
│   ├── app/
│   │   ├── AppRouter.tsx                   (new)
│   │   ├── AppLayout.tsx                   (new — shell w/ <Outlet> + bottom nav)
│   │   ├── AppLayout.module.css            (new)
│   │   ├── BottomNav.tsx                   (new)
│   │   ├── BottomNav.module.css            (new)
│   │   ├── NotFound.tsx                    (new)
│   │   ├── ErrorBoundary.tsx               (new)
│   │   └── HealthIndicator.tsx             (moved from src/, unchanged)
│   ├── icons/
│   │   ├── index.ts                        (new — barrel export)
│   │   ├── IconBase.tsx                    (new — shared <svg> wrapper)
│   │   ├── IconBolt.tsx                    (new)
│   │   ├── IconChart.tsx                   (new)
│   │   ├── IconHeart.tsx                   (new)
│   │   ├── IconHome.tsx                    (new)
│   │   ├── IconHistory.tsx                 (new)
│   │   ├── IconProfile.tsx                 (new)
│   │   ├── IconClose.tsx                   (new)
│   │   └── IconInfo.tsx                    (new)
│   ├── components/
│   │   ├── Button/
│   │   │   ├── Button.tsx                  (new)
│   │   │   ├── Button.module.css           (new)
│   │   │   └── Button.test.tsx             (new)
│   │   ├── MetricCard/
│   │   │   ├── MetricCard.tsx              (new)
│   │   │   ├── MetricCard.module.css       (new)
│   │   │   └── MetricCard.test.tsx         (new)
│   │   ├── Sheet/
│   │   │   ├── Sheet.tsx                   (new — bottom-sheet on phone, modal on ≥ md)
│   │   │   ├── Sheet.module.css            (new)
│   │   │   └── Sheet.test.tsx              (new)
│   │   └── Sparkline/
│   │       ├── Sparkline.tsx               (new — SVG path, 60 s rolling window)
│   │       ├── Sparkline.module.css        (new)
│   │       └── Sparkline.test.tsx          (new)
│   ├── live/
│   │   ├── events.ts                       (new — TS types mirroring INT-0002)
│   │   ├── channel.ts                      (new — Channel abstraction + EventSourceChannel + MockChannel)
│   │   ├── channel.test.ts                 (new)
│   │   ├── useEventSource.ts               (new — hook wrapping a Channel)
│   │   ├── useEventSource.test.ts          (new)
│   │   ├── reducer.ts                      (new — LiveState + live reducer)
│   │   ├── reducer.test.ts                 (new)
│   │   ├── LiveSessionContext.tsx          (new — provider wiring hook + reducer)
│   │   └── LiveSessionContext.test.tsx     (new)
│   ├── tiles/
│   │   ├── registry.ts                     (new — tile definitions per tile-catalogue)
│   │   ├── registry.test.ts                (new)
│   │   ├── selectors.ts                    (new — pure fns: LiveState → tile value)
│   │   ├── selectors.test.ts               (new)
│   │   ├── layout.ts                       (new — load/save tile layout to localStorage)
│   │   ├── layout.test.ts                  (new)
│   │   ├── NumericTile.tsx                 (new)
│   │   ├── NumericTile.module.css          (new)
│   │   ├── SparklineTile.tsx               (new)
│   │   ├── SparklineTile.module.css        (new)
│   │   ├── ZoneBadgeTile.tsx               (new)
│   │   ├── ZoneBadgeTile.module.css        (new)
│   │   ├── Tile.tsx                        (new — router that picks the concrete tile component)
│   │   └── Tile.test.tsx                   (new)
│   ├── pages/
│   │   ├── LivePage.tsx                    (new)
│   │   ├── LivePage.module.css             (new)
│   │   ├── LivePage.test.tsx               (new)
│   │   ├── LiveHero.tsx                    (new)
│   │   ├── LiveHero.module.css             (new)
│   │   ├── LiveHero.test.tsx               (new)
│   │   ├── StrokePulse.tsx                 (new)
│   │   ├── StrokePulse.module.css          (new)
│   │   ├── TileGrid.tsx                    (new)
│   │   ├── TileGrid.module.css             (new)
│   │   ├── TilePicker.tsx                  (new)
│   │   ├── TilePicker.module.css           (new)
│   │   └── TilePicker.test.tsx             (new)
│   └── util/
│       ├── format.ts                       (new — mmss, number formatters — tabular-safe)
│       └── format.test.ts                  (new)
└── tests/e2e/
    └── live-view.spec.ts                   (new — Playwright smoke at xs/md/xl)
```

**Conventions enforced by this layout:**

- Each component has its own folder with `Component.tsx`, `Component.module.css`, and `Component.test.tsx`. Vite supports CSS modules out of the box — no config.
- Three feature namespaces: `app/` (shell), `live/` (data plumbing), `tiles/` (tile grid + picker logic), `pages/` (visual composition).
- Pure functions live in `util/`, `tiles/selectors.ts`, `tiles/layout.ts`, `live/reducer.ts`. These are the easiest to test and the hottest dependencies — keep them thin.
- No components over ~200 lines. If a file grows, split it in the PR where the growth happens.

---

## Task 1: Install dependencies & wire vitest

**Files:**
- Modify: `web/package.json`
- Modify: `web/vite.config.ts`
- Modify: `web/tsconfig.app.json`
- Create: `web/src/setupTests.ts`

- [ ] **Step 1: Install runtime deps**

From `web/`:

```bash
npm install react-router-dom@^7 @fontsource-variable/space-grotesk @fontsource-variable/inter
```

Expected: `package.json` gains the three `dependencies`; `package-lock.json` updates.

- [ ] **Step 2: Install dev deps**

```bash
npm install -D vitest @vitest/ui jsdom @testing-library/react @testing-library/jest-dom @testing-library/user-event @playwright/test
```

Expected: dev deps added; no errors.

- [ ] **Step 3: Install Playwright browsers**

```bash
npx playwright install chromium
```

Expected: Chromium downloads into the Playwright cache (this can take ~30 s). We only install chromium because the Playwright test in this plan is a smoke, not a cross-browser matrix.

- [ ] **Step 4: Add test scripts to `package.json`**

Under `"scripts"`, add:

```json
"test": "vitest run",
"test:watch": "vitest",
"test:ui": "vitest --ui",
"e2e": "playwright test"
```

The existing `dev`, `build`, `preview`, `lint`, `format`, `typecheck` stay. The final `scripts` block should look like:

```json
"scripts": {
  "dev": "vite",
  "build": "tsc -b && vite build",
  "preview": "vite preview",
  "lint": "eslint .",
  "format": "prettier --write .",
  "typecheck": "tsc -b --noEmit",
  "test": "vitest run",
  "test:watch": "vitest",
  "test:ui": "vitest --ui",
  "e2e": "playwright test"
}
```

- [ ] **Step 5: Wire vitest in `vite.config.ts`**

Add a `test` block and a triple-slash reference so TS sees the `test` property. The final file reads:

```ts
/// <reference types="vitest" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      devOptions: { enabled: true },
      manifest: {
        name: 'Home Ergo Tracker',
        short_name: 'Home Ergo',
        start_url: '/',
        display: 'standalone',
        background_color: '#131313',
        theme_color: '#131313',
        icons: [
          { src: '/pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/pwa-512.png', sizes: '512x512', type: 'image/png' },
        ],
      },
    }),
  ],
  server: {
    proxy: { '/api': 'http://localhost:8080' },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/setupTests.ts'],
    css: true,
  },
})
```

If your M1 scaffold's `vite.config.ts` already has fields here you don't recognise, preserve them — only add the `test:` block and the triple-slash reference.

- [ ] **Step 6: Add vitest globals to `tsconfig.app.json`**

In `web/tsconfig.app.json`, the `compilerOptions.types` array must include:

```json
"types": ["vitest/globals", "@testing-library/jest-dom"]
```

If `types` doesn't exist yet, add it as a new key.

- [ ] **Step 7: Create `src/setupTests.ts`**

```ts
import '@testing-library/jest-dom/vitest'
```

- [ ] **Step 8: Verify the test runner boots**

```bash
cd web && npm test
```

Expected: vitest reports "No test files found" and exits 0 (or exits with a specific no-tests code — either way the runner must load without config errors).

- [ ] **Step 9: Commit**

```bash
git add web/package.json web/package-lock.json web/vite.config.ts web/tsconfig.app.json web/src/setupTests.ts
git commit -m "feat(web): add vitest, react-router, self-hosted fonts, testing-library"
```

---

## Task 2: Design tokens — `tokens.css`

**Files:**
- Create: `web/src/styles/tokens.css`
- Create: `web/src/styles/theme.ts`

The tokens are the foundation; every component from here down references `var(--token-name)` and never raw values. Dark is the default; `:root[data-theme="light"]` overrides for light. All values come straight from FEAT-0008.

- [ ] **Step 1: Write `src/styles/tokens.css`**

```css
/*
 * Design tokens — FEAT-0008.
 * Every colour, spacing, radius, type size, and motion duration in the
 * app comes from here. Components use var(--name); no raw hex or px in
 * component CSS (other than 1:1 passthroughs of these tokens).
 *
 * Dark is the default target. Light overrides below.
 */

:root {
  /* Colour — dark (default) */
  --color-surface: #131313;
  --color-surface-container-lowest: #0d0e0e;
  --color-surface-container-low: #1b1c1c;
  --color-surface-container: #1f2020;
  --color-surface-container-high: #292a2a;
  --color-surface-container-highest: #343535;
  --color-on-surface: #e4e2e1;
  --color-on-surface-variant: #bcc9ca;
  --color-outline-variant: #3d494a;
  --color-primary: #5dd7e4;
  --color-primary-container: #00a3af;
  --color-on-primary: #00363b;
  --color-tertiary: #ffb786;
  --color-error: #ffb4ab;

  /* Spacing — 8pt grid (plus one half-step 4px for rare insets) */
  --space-0-5: 4px;
  --space-1: 8px;
  --space-2: 16px;
  --space-3: 24px;
  --space-4: 32px;
  --space-5: 40px;
  --space-6: 48px;
  --space-8: 64px;
  --space-10: 80px;

  /* Radius */
  --radius-button: 8px;
  --radius-card: 12px;

  /* Typography — font stacks (Space Grotesk + Inter, self-hosted via @fontsource-variable) */
  --font-display: 'Space Grotesk Variable', 'Space Grotesk', system-ui, sans-serif;
  --font-body: 'Inter Variable', 'Inter', system-ui, sans-serif;

  /* Typography — sizes (line-heights are tight for displays, relaxed for body) */
  --text-display-lg: clamp(56px, 12vw, 72px);
  --text-display-lg-lh: 1.1;
  --text-headline-sm: 20px;
  --text-headline-sm-lh: 1.2;
  --text-title-md: 16px;
  --text-title-md-lh: 1.25;
  --text-body-lg: 16px;
  --text-body-lg-lh: 1.5;
  --text-label-sm: 11px;
  --text-label-sm-lh: 1.0;

  /* Motion */
  --motion-state: 120ms;
  --motion-view: 220ms;
  --motion-ease: cubic-bezier(0.2, 0.7, 0.2, 1); /* ease-out */

  /* Layout — bottom nav */
  --layout-bottom-nav-h: 64px;

  /* Feature gates */
  --stroke-pulse-glow: 0 0 12px rgba(93, 215, 228, 0.6);
}

:root[data-theme='light'] {
  --color-surface: #f8f6f3;
  --color-surface-container-lowest: #ffffff;
  --color-surface-container-low: #eeece8;
  --color-surface-container: #e4e2dd;
  --color-surface-container-high: #d8d5cf;
  --color-surface-container-highest: #c8c4bd;
  --color-on-surface: #1b1c1c;
  --color-on-surface-variant: #3d494a;
  --color-outline-variant: #3d494a;
  --color-primary: #00a3af;
  --color-primary-container: #5dd7e4;
  --color-on-primary: #00363b;
  --color-tertiary: #8b4e1a;
  --color-error: #ba1a1a;
}

@media (prefers-reduced-motion: reduce) {
  :root {
    --motion-state: 0ms;
    --motion-view: 0ms;
  }
}
```

Note: the light-mode palette is a minimum viable set (FEAT-0008 open question #1). It covers every semantic slot used by components in this plan. The full fidelity of the Stitch "User Profile (Light Mode)" screen is a FEAT-0004-plan concern.

- [ ] **Step 2: Write `src/styles/theme.ts`**

```ts
// TS-side re-export of token names. Use this in components that need a
// token name as a string (e.g. to pass to an SVG style attribute).
// Components setting static CSS properties should use the CSS variable
// directly in a .module.css file instead.

export type ThemeKind = 'system' | 'dark' | 'light'

export const TOKENS = {
  colorSurface: 'var(--color-surface)',
  colorSurfaceContainerLow: 'var(--color-surface-container-low)',
  colorSurfaceContainer: 'var(--color-surface-container)',
  colorSurfaceContainerHigh: 'var(--color-surface-container-high)',
  colorSurfaceContainerHighest: 'var(--color-surface-container-highest)',
  colorOnSurface: 'var(--color-on-surface)',
  colorOnSurfaceVariant: 'var(--color-on-surface-variant)',
  colorPrimary: 'var(--color-primary)',
  colorPrimaryContainer: 'var(--color-primary-container)',
  colorOnPrimary: 'var(--color-on-primary)',
  colorTertiary: 'var(--color-tertiary)',
  colorError: 'var(--color-error)',
  radiusCard: 'var(--radius-card)',
  radiusButton: 'var(--radius-button)',
} as const
```

- [ ] **Step 3: Commit**

```bash
git add web/src/styles/tokens.css web/src/styles/theme.ts
git commit -m "feat(web): design tokens for dark + light themes"
```

---

## Task 3: Typography base + CSS reset

**Files:**
- Create: `web/src/styles/reset.css`
- Create: `web/src/styles/base.css`
- Modify: `web/src/main.tsx`

- [ ] **Step 1: Write `src/styles/reset.css`**

```css
/*
 * Minimal reset. Narrower than Normalize — we only override what
 * browser defaults fight against in this codebase.
 */

*,
*::before,
*::after {
  box-sizing: border-box;
}

html,
body,
#root {
  margin: 0;
  padding: 0;
  height: 100%;
  background: var(--color-surface);
  color: var(--color-on-surface);
}

body {
  font-family: var(--font-body);
  font-size: var(--text-body-lg);
  line-height: var(--text-body-lg-lh);
  -webkit-font-smoothing: antialiased;
  text-rendering: optimizeLegibility;
}

button,
input,
select,
textarea {
  font: inherit;
  color: inherit;
}

button {
  background: transparent;
  border: none;
  cursor: pointer;
  padding: 0;
}

a {
  color: inherit;
  text-decoration: none;
}

ul,
ol {
  list-style: none;
  margin: 0;
  padding: 0;
}

/* Tabular numerals on anything explicitly opted-in. */
.tnum {
  font-feature-settings: 'tnum' 1, 'lnum' 1;
  font-variant-numeric: tabular-nums lining-nums;
}

/* Labels per FEAT-0008 — uppercase, tracked. */
.label-sm {
  font-family: var(--font-body);
  font-size: var(--text-label-sm);
  line-height: var(--text-label-sm-lh);
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--color-on-surface-variant);
}
```

- [ ] **Step 2: Write `src/styles/base.css`**

```css
/*
 * Typography scale utilities per FEAT-0008. Used sparingly — prefer
 * component-scoped styles. These exist so pages can reach for
 * display-lg etc. without re-declaring font-family + size pairs.
 */

.display-lg {
  font-family: var(--font-display);
  font-size: var(--text-display-lg);
  line-height: var(--text-display-lg-lh);
  font-weight: 500;
  font-feature-settings: 'tnum' 1, 'lnum' 1;
  font-variant-numeric: tabular-nums lining-nums;
}

.headline-sm {
  font-family: var(--font-display);
  font-size: var(--text-headline-sm);
  line-height: var(--text-headline-sm-lh);
  font-weight: 500;
}

.title-md {
  font-family: var(--font-display);
  font-size: var(--text-title-md);
  line-height: var(--text-title-md-lh);
  font-weight: 500;
}

.body-lg {
  font-family: var(--font-body);
  font-size: var(--text-body-lg);
  line-height: var(--text-body-lg-lh);
}
```

- [ ] **Step 3: Import fonts and styles from `main.tsx`**

Replace the current content of `web/src/main.tsx` with:

```tsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'

import '@fontsource-variable/space-grotesk'
import '@fontsource-variable/inter'
import './styles/tokens.css'
import './styles/reset.css'
import './styles/base.css'

import { AppRouter } from './app/AppRouter'

registerSW({ immediate: true })

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppRouter />
  </StrictMode>,
)
```

`AppRouter` doesn't exist yet (Task 6). Temporarily, to avoid a build failure between steps, create a stub:

- [ ] **Step 4: Write the temporary `AppRouter` stub**

Create `web/src/app/AppRouter.tsx`:

```tsx
export function AppRouter() {
  return <div>App shell comes in Task 6.</div>
}
```

- [ ] **Step 5: Remove the M1 placeholder files**

```bash
cd web && rm src/App.tsx src/App.css
```

Move `HealthIndicator.tsx` into the app folder (it's used by Task 6's layout):

```bash
cd web && mkdir -p src/app && git mv src/HealthIndicator.tsx src/app/HealthIndicator.tsx
```

- [ ] **Step 6: Build to verify everything compiles**

```bash
cd web && npm run typecheck && npm run build
```

Expected: both green. The build should include `Space Grotesk Variable` and `Inter Variable` woff2 assets under `dist/assets/`.

- [ ] **Step 7: Commit**

```bash
git add web/src/styles web/src/main.tsx web/src/app/AppRouter.tsx web/src/app/HealthIndicator.tsx
git add -u web/src/App.tsx web/src/App.css web/src/HealthIndicator.tsx
git commit -m "feat(web): load fonts and base styles; stub AppRouter"
```

---

## Task 4: Theme resolution — pre-mount script

**Files:**
- Create: `web/src/theme/preMountScript.ts`
- Modify: `web/index.html`

The theme class must be on `<html>` *before* React mounts — otherwise users who prefer light see a dark flash, and vice versa. We ship a tiny inline script in `index.html` that reads `localStorage` first, then `prefers-color-scheme`, and sets `data-theme`.

- [ ] **Step 1: Write the script as a TS file first**

The TS file is the source of truth for tests and future changes; `index.html` has a byte-for-byte copy inlined.

Create `web/src/theme/preMountScript.ts`:

```ts
// Source of truth for the pre-mount theme resolver. The contents of
// `PRE_MOUNT_THEME_SCRIPT` must be copied verbatim into the inline
// <script> in web/index.html. A test in Task 5 asserts they stay in
// sync.

export const STORAGE_KEY = 'home-ergo:theme'

// Written as a plain string (not a function reference) so it can be
// inlined into index.html. Resolution order:
//   1. localStorage override (ThemeKind = 'dark' | 'light' | 'system')
//   2. prefers-color-scheme
//   3. Default: dark
export const PRE_MOUNT_THEME_SCRIPT = `(function(){
  try {
    var stored = localStorage.getItem('home-ergo:theme');
    var resolved = 'dark';
    if (stored === 'light' || stored === 'dark') {
      resolved = stored;
    } else {
      var mql = window.matchMedia('(prefers-color-scheme: light)');
      if (mql && mql.matches) resolved = 'light';
    }
    document.documentElement.setAttribute('data-theme', resolved);
  } catch (e) {
    document.documentElement.setAttribute('data-theme', 'dark');
  }
})();`
```

- [ ] **Step 2: Inline the script in `index.html`**

Read the current `web/index.html`. In the `<head>` block, add the script as the *first* child of `<head>` (so nothing renders before the theme class is set):

```html
<!DOCTYPE html>
<html lang="de">
  <head>
    <script>(function(){
  try {
    var stored = localStorage.getItem('home-ergo:theme');
    var resolved = 'dark';
    if (stored === 'light' || stored === 'dark') {
      resolved = stored;
    } else {
      var mql = window.matchMedia('(prefers-color-scheme: light)');
      if (mql && mql.matches) resolved = 'light';
    }
    document.documentElement.setAttribute('data-theme', resolved);
  } catch (e) {
    document.documentElement.setAttribute('data-theme', 'dark');
  }
})();</script>
    <meta charset="UTF-8" />
    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="theme-color" content="#131313" />
    <title>Home Ergo Tracker</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

If your existing `index.html` has other `<link>`/`<meta>` tags, preserve them; the only inserts are the inline theme `<script>`, `lang="de"` on `<html>`, and the `theme-color` meta.

- [ ] **Step 3: Commit**

```bash
git add web/src/theme/preMountScript.ts web/index.html
git commit -m "feat(web): pre-mount theme resolver (no FOUC)"
```

---

## Task 5: Theme hook — failing test then implementation

**Files:**
- Create: `web/src/theme/useTheme.ts` (stub first)
- Create: `web/src/theme/useTheme.test.ts`

- [ ] **Step 1: Write the stub**

Create `web/src/theme/useTheme.ts`:

```ts
import { useState } from 'react'
import { STORAGE_KEY } from './preMountScript'

export type ThemeKind = 'system' | 'dark' | 'light'

export function useTheme(): [ThemeKind, (t: ThemeKind) => void] {
  const [theme] = useState<ThemeKind>('system')
  return [theme, () => {}]
}

export function __internals() {
  return { STORAGE_KEY }
}
```

- [ ] **Step 2: Write the failing test**

Create `web/src/theme/useTheme.test.ts`:

```ts
import { renderHook, act } from '@testing-library/react'
import { describe, it, expect, beforeEach } from 'vitest'
import { useTheme } from './useTheme'
import { PRE_MOUNT_THEME_SCRIPT, STORAGE_KEY } from './preMountScript'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const indexHtmlPath = join(here, '..', '..', 'index.html')

describe('useTheme', () => {
  beforeEach(() => {
    localStorage.clear()
    document.documentElement.removeAttribute('data-theme')
  })

  it('reads initial theme from data-theme attribute (dark)', () => {
    document.documentElement.setAttribute('data-theme', 'dark')
    const { result } = renderHook(() => useTheme())
    expect(result.current[0]).toBe('dark')
  })

  it('reads initial theme from data-theme attribute (light)', () => {
    document.documentElement.setAttribute('data-theme', 'light')
    const { result } = renderHook(() => useTheme())
    expect(result.current[0]).toBe('light')
  })

  it("reports 'system' when localStorage is empty and data-theme matches OS", () => {
    // If nothing stored, the hook says "system" even though data-theme
    // is the resolved value from the pre-mount script.
    document.documentElement.setAttribute('data-theme', 'dark')
    const { result } = renderHook(() => useTheme())
    expect(result.current[0]).toBe('system')
  })

  it('reports stored override', () => {
    localStorage.setItem(STORAGE_KEY, 'light')
    document.documentElement.setAttribute('data-theme', 'light')
    const { result } = renderHook(() => useTheme())
    expect(result.current[0]).toBe('light')
  })

  it('writes setTheme to localStorage and data-theme', () => {
    document.documentElement.setAttribute('data-theme', 'dark')
    const { result } = renderHook(() => useTheme())
    act(() => result.current[1]('light'))
    expect(localStorage.getItem(STORAGE_KEY)).toBe('light')
    expect(document.documentElement.getAttribute('data-theme')).toBe('light')
  })

  it("setTheme('system') clears localStorage and resolves against prefers-color-scheme", () => {
    localStorage.setItem(STORAGE_KEY, 'light')
    document.documentElement.setAttribute('data-theme', 'light')
    const { result } = renderHook(() => useTheme())
    act(() => result.current[1]('system'))
    expect(localStorage.getItem(STORAGE_KEY)).toBe(null)
    // jsdom defaults prefers-color-scheme: light → no match, so resolves to dark.
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
  })

  it('index.html inline script matches PRE_MOUNT_THEME_SCRIPT', () => {
    const html = readFileSync(indexHtmlPath, 'utf-8')
    // Strip all whitespace for resilience to formatter drift.
    const normalise = (s: string) => s.replace(/\s+/g, '')
    expect(normalise(html)).toContain(normalise(PRE_MOUNT_THEME_SCRIPT))
  })
})
```

- [ ] **Step 3: Run the tests — they must fail**

```bash
cd web && npm test
```

Expected: six of the seven tests fail (the `useTheme` stub returns `'system'` always and `setTheme` is a no-op). The seventh (HTML sync) should pass — it was the contract established in Task 4.

- [ ] **Step 4: Implement `useTheme`**

Replace `web/src/theme/useTheme.ts` with:

```ts
import { useCallback, useEffect, useState } from 'react'
import { STORAGE_KEY } from './preMountScript'

export type ThemeKind = 'system' | 'dark' | 'light'

type Resolved = 'dark' | 'light'

function readStored(): ThemeKind {
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    if (v === 'dark' || v === 'light') return v
  } catch {
    /* localStorage disabled */
  }
  return 'system'
}

function resolveSystem(): Resolved {
  try {
    if (window.matchMedia('(prefers-color-scheme: light)').matches) return 'light'
  } catch {
    /* matchMedia missing */
  }
  return 'dark'
}

function apply(resolved: Resolved) {
  document.documentElement.setAttribute('data-theme', resolved)
}

export function useTheme(): [ThemeKind, (t: ThemeKind) => void] {
  const [theme, setThemeState] = useState<ThemeKind>(() => readStored())

  useEffect(() => {
    if (theme !== 'system') return
    // When on system, listen to OS changes so the resolved attribute
    // tracks the OS without a user interaction.
    const mql = window.matchMedia('(prefers-color-scheme: light)')
    const onChange = () => apply(mql.matches ? 'light' : 'dark')
    mql.addEventListener?.('change', onChange)
    return () => mql.removeEventListener?.('change', onChange)
  }, [theme])

  const setTheme = useCallback((next: ThemeKind) => {
    try {
      if (next === 'system') {
        localStorage.removeItem(STORAGE_KEY)
        apply(resolveSystem())
      } else {
        localStorage.setItem(STORAGE_KEY, next)
        apply(next)
      }
    } catch {
      // localStorage disabled; still apply in-memory.
      apply(next === 'system' ? resolveSystem() : next)
    }
    setThemeState(next)
  }, [])

  return [theme, setTheme]
}
```

- [ ] **Step 5: Run the tests — they must pass**

```bash
cd web && npm test
```

Expected: all seven tests pass.

- [ ] **Step 6: Commit**

```bash
git add web/src/theme/useTheme.ts web/src/theme/useTheme.test.ts
git commit -m "feat(web): useTheme hook with system/dark/light and HTML-sync test"
```

---

## Task 6: Icons

**Files:**
- Create: `web/src/icons/IconBase.tsx`
- Create: `web/src/icons/IconBolt.tsx`
- Create: `web/src/icons/IconChart.tsx`
- Create: `web/src/icons/IconHeart.tsx`
- Create: `web/src/icons/IconHome.tsx`
- Create: `web/src/icons/IconHistory.tsx`
- Create: `web/src/icons/IconProfile.tsx`
- Create: `web/src/icons/IconClose.tsx`
- Create: `web/src/icons/IconInfo.tsx`
- Create: `web/src/icons/index.ts`

All icons are 24×24, stroke-width 2, `currentColor` — per FEAT-0008. Shapes are minimal originals (not trademarked third-party sets).

- [ ] **Step 1: Write the shared base**

Create `web/src/icons/IconBase.tsx`:

```tsx
import type { SVGProps, ReactNode } from 'react'

type Props = SVGProps<SVGSVGElement> & { title?: string; children: ReactNode }

export function IconBase({ title, children, ...rest }: Props) {
  return (
    <svg
      width={24}
      height={24}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      role={title ? 'img' : 'presentation'}
      aria-hidden={title ? undefined : true}
      aria-label={title}
      {...rest}
    >
      {children}
    </svg>
  )
}
```

- [ ] **Step 2: Write each icon**

Create `web/src/icons/IconHome.tsx`:

```tsx
import { IconBase } from './IconBase'
import type { SVGProps } from 'react'

export function IconHome(props: SVGProps<SVGSVGElement>) {
  return (
    <IconBase {...props}>
      <path d="M3 11 12 3l9 8v9a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1Z" />
    </IconBase>
  )
}
```

Create `web/src/icons/IconHistory.tsx`:

```tsx
import { IconBase } from './IconBase'
import type { SVGProps } from 'react'

export function IconHistory(props: SVGProps<SVGSVGElement>) {
  return (
    <IconBase {...props}>
      <path d="M3 12a9 9 0 1 0 3-6.7" />
      <path d="M3 4v5h5" />
      <path d="M12 7v5l3 2" />
    </IconBase>
  )
}
```

Create `web/src/icons/IconProfile.tsx`:

```tsx
import { IconBase } from './IconBase'
import type { SVGProps } from 'react'

export function IconProfile(props: SVGProps<SVGSVGElement>) {
  return (
    <IconBase {...props}>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 20a8 8 0 0 1 16 0" />
    </IconBase>
  )
}
```

Create `web/src/icons/IconBolt.tsx`:

```tsx
import { IconBase } from './IconBase'
import type { SVGProps } from 'react'

export function IconBolt(props: SVGProps<SVGSVGElement>) {
  return (
    <IconBase {...props}>
      <path d="M13 2 4 14h7l-1 8 9-12h-7l1-8Z" />
    </IconBase>
  )
}
```

Create `web/src/icons/IconChart.tsx`:

```tsx
import { IconBase } from './IconBase'
import type { SVGProps } from 'react'

export function IconChart(props: SVGProps<SVGSVGElement>) {
  return (
    <IconBase {...props}>
      <path d="M3 17 9 11l4 4 8-8" />
      <path d="M21 3v6" />
      <path d="M21 3h-6" />
    </IconBase>
  )
}
```

Create `web/src/icons/IconHeart.tsx`:

```tsx
import { IconBase } from './IconBase'
import type { SVGProps } from 'react'

export function IconHeart(props: SVGProps<SVGSVGElement>) {
  return (
    <IconBase {...props}>
      <path d="M12 20s-7-4.5-9-9a5 5 0 0 1 9-3 5 5 0 0 1 9 3c-2 4.5-9 9-9 9Z" />
    </IconBase>
  )
}
```

Create `web/src/icons/IconClose.tsx`:

```tsx
import { IconBase } from './IconBase'
import type { SVGProps } from 'react'

export function IconClose(props: SVGProps<SVGSVGElement>) {
  return (
    <IconBase {...props}>
      <path d="M5 5 19 19" />
      <path d="M19 5 5 19" />
    </IconBase>
  )
}
```

Create `web/src/icons/IconInfo.tsx`:

```tsx
import { IconBase } from './IconBase'
import type { SVGProps } from 'react'

export function IconInfo(props: SVGProps<SVGSVGElement>) {
  return (
    <IconBase {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 8.5v.01" />
      <path d="M12 12v4" />
    </IconBase>
  )
}
```

- [ ] **Step 3: Write the barrel**

Create `web/src/icons/index.ts`:

```ts
export { IconBase } from './IconBase'
export { IconBolt } from './IconBolt'
export { IconChart } from './IconChart'
export { IconClose } from './IconClose'
export { IconHeart } from './IconHeart'
export { IconHistory } from './IconHistory'
export { IconHome } from './IconHome'
export { IconInfo } from './IconInfo'
export { IconProfile } from './IconProfile'
```

- [ ] **Step 4: Verify the build**

```bash
cd web && npm run typecheck
```

Expected: exits 0.

- [ ] **Step 5: Commit**

```bash
git add web/src/icons
git commit -m "feat(web): inline SVG icon components (24px, stroke-2)"
```

---

## Task 7: Button component — failing test then implementation

**Files:**
- Create: `web/src/components/Button/Button.tsx`
- Create: `web/src/components/Button/Button.module.css`
- Create: `web/src/components/Button/Button.test.tsx`

- [ ] **Step 1: Write the stub**

Create `web/src/components/Button/Button.tsx`:

```tsx
import type { ButtonHTMLAttributes } from 'react'

type Variant = 'primary' | 'secondary' | 'tertiary'

type Props = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }

export function Button(_: Props) {
  return null
}
```

Create `web/src/components/Button/Button.module.css` with the final styles up-front (tests assert class names via computed styles, but we only check the DOM — the CSS file can land ready):

```css
.button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 44px;
  padding: 0 var(--space-3);
  border-radius: var(--radius-button);
  font-family: var(--font-display);
  font-size: var(--text-title-md);
  font-weight: 500;
  letter-spacing: 0.02em;
  cursor: pointer;
  transition: background-color var(--motion-state) var(--motion-ease),
    color var(--motion-state) var(--motion-ease);
}

.button:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

.primary {
  background: var(--color-primary);
  color: var(--color-on-primary);
}

.primary:hover:not(:disabled) {
  background: var(--color-primary-container);
  color: var(--color-on-primary);
}

.secondary {
  background: var(--color-surface-container-high);
  color: var(--color-on-surface);
}

.secondary:hover:not(:disabled) {
  background: var(--color-surface-container-highest);
}

.tertiary {
  background: transparent;
  color: var(--color-primary);
  min-height: 40px;
  padding: 0 var(--space-2);
}

.tertiary:hover:not(:disabled) {
  color: var(--color-primary-container);
}
```

- [ ] **Step 2: Write the failing test**

Create `web/src/components/Button/Button.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import { Button } from './Button'
import styles from './Button.module.css'

describe('Button', () => {
  it('renders children as the accessible name', () => {
    render(<Button>Starten</Button>)
    expect(screen.getByRole('button', { name: 'Starten' })).toBeInTheDocument()
  })

  it("defaults to variant='primary'", () => {
    render(<Button>Go</Button>)
    const btn = screen.getByRole('button')
    expect(btn).toHaveClass(styles.button)
    expect(btn).toHaveClass(styles.primary)
  })

  it.each([
    ['primary', 'primary'],
    ['secondary', 'secondary'],
    ['tertiary', 'tertiary'],
  ] as const)('applies the %s variant class', (variant, expected) => {
    render(<Button variant={variant}>x</Button>)
    expect(screen.getByRole('button')).toHaveClass(styles[expected])
  })

  it('fires onClick', async () => {
    const user = userEvent.setup()
    const onClick = vi.fn()
    render(<Button onClick={onClick}>Go</Button>)
    await user.click(screen.getByRole('button'))
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('respects disabled and prevents click', async () => {
    const user = userEvent.setup()
    const onClick = vi.fn()
    render(
      <Button onClick={onClick} disabled>
        Go
      </Button>,
    )
    await user.click(screen.getByRole('button'))
    expect(onClick).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 3: Run the test — it must fail**

```bash
cd web && npm test -- Button
```

Expected: every test fails because `Button` returns `null`.

- [ ] **Step 4: Implement**

Replace `Button.tsx`:

```tsx
import type { ButtonHTMLAttributes } from 'react'
import styles from './Button.module.css'

type Variant = 'primary' | 'secondary' | 'tertiary'

type Props = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }

export function Button({ variant = 'primary', className, children, ...rest }: Props) {
  const cls = [styles.button, styles[variant], className].filter(Boolean).join(' ')
  return (
    <button className={cls} {...rest}>
      {children}
    </button>
  )
}
```

- [ ] **Step 5: Run the tests — they must pass**

```bash
cd web && npm test -- Button
```

Expected: all five pass.

- [ ] **Step 6: Commit**

```bash
git add web/src/components/Button
git commit -m "feat(web): Button component (primary/secondary/tertiary)"
```

---

## Task 8: MetricCard — three-part stack

**Files:**
- Create: `web/src/components/MetricCard/MetricCard.tsx`
- Create: `web/src/components/MetricCard/MetricCard.module.css`
- Create: `web/src/components/MetricCard/MetricCard.test.tsx`

`MetricCard` is the primitive used by every numeric tile and the hero's secondary row. Per FEAT-0008: label (uppercase, tracked), large value, unit.

- [ ] **Step 1: Write the failing test**

Create `web/src/components/MetricCard/MetricCard.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { MetricCard } from './MetricCard'

describe('MetricCard', () => {
  it('renders label, value, and unit', () => {
    render(<MetricCard label="Distanz" value="1:54.3" unit="/ 500m" />)
    expect(screen.getByText('Distanz')).toBeInTheDocument()
    expect(screen.getByText('1:54.3')).toBeInTheDocument()
    expect(screen.getByText('/ 500m')).toBeInTheDocument()
  })

  it('renders without unit', () => {
    render(<MetricCard label="SPM" value="27" />)
    expect(screen.getByText('SPM')).toBeInTheDocument()
    expect(screen.getByText('27')).toBeInTheDocument()
  })

  it('renders idle placeholder "—" when value is null', () => {
    render(<MetricCard label="DPS" value={null} unit="m" />)
    expect(screen.getByText('—')).toBeInTheDocument()
  })

  it("label uses uppercase via the 'label-sm' class", () => {
    render(<MetricCard label="Watt" value="230" unit="W" />)
    expect(screen.getByText('Watt')).toHaveClass('label-sm')
  })

  it('value uses tabular numerals for consistent digit widths', () => {
    render(<MetricCard label="x" value="1234" />)
    expect(screen.getByText('1234')).toHaveClass('tnum')
  })
})
```

- [ ] **Step 2: Write the stub**

Create `web/src/components/MetricCard/MetricCard.tsx`:

```tsx
export function MetricCard(_: {
  label: string
  value: string | number | null
  unit?: string
  size?: 'sm' | 'md' | 'lg'
}) {
  return null
}
```

Create `web/src/components/MetricCard/MetricCard.module.css`:

```css
.card {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  padding: var(--space-2);
  background: var(--color-surface-container);
  border-radius: var(--radius-card);
}

.label {
  color: var(--color-on-surface-variant);
}

.valueRow {
  display: flex;
  align-items: baseline;
  gap: var(--space-1);
}

.value {
  font-family: var(--font-display);
  color: var(--color-on-surface);
  font-weight: 500;
}

.md .value {
  font-size: 32px;
  line-height: 1.1;
}

.sm .value {
  font-size: 20px;
  line-height: 1.2;
}

.lg .value {
  font-size: var(--text-display-lg);
  line-height: var(--text-display-lg-lh);
}

.unit {
  font-family: var(--font-display);
  font-size: var(--text-title-md);
  line-height: var(--text-title-md-lh);
  color: var(--color-on-surface-variant);
}
```

- [ ] **Step 3: Run the test — it must fail**

```bash
cd web && npm test -- MetricCard
```

Expected: all fail (stub returns `null`).

- [ ] **Step 4: Implement**

Replace `MetricCard.tsx`:

```tsx
import styles from './MetricCard.module.css'

type Props = {
  label: string
  value: string | number | null
  unit?: string
  size?: 'sm' | 'md' | 'lg'
}

export function MetricCard({ label, value, unit, size = 'md' }: Props) {
  const displayValue = value === null || value === undefined ? '—' : String(value)
  return (
    <div className={`${styles.card} ${styles[size]}`}>
      <span className={`${styles.label} label-sm`}>{label}</span>
      <div className={styles.valueRow}>
        <span className={`${styles.value} tnum`}>{displayValue}</span>
        {unit && <span className={styles.unit}>{unit}</span>}
      </div>
    </div>
  )
}
```

- [ ] **Step 5: Run the tests — they must pass**

```bash
cd web && npm test -- MetricCard
```

Expected: all five pass.

- [ ] **Step 6: Commit**

```bash
git add web/src/components/MetricCard
git commit -m "feat(web): MetricCard three-part stack (label/value/unit)"
```

---

## Task 9: Format utilities

**Files:**
- Create: `web/src/util/format.ts`
- Create: `web/src/util/format.test.ts`

Every tile and the hero call into these. Pure, branch-heavy, well-unit-tested.

- [ ] **Step 1: Write the failing test**

Create `web/src/util/format.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { mmss, pace500m, fmtInt, fmtFloat, fmtMeters } from './format'

describe('mmss', () => {
  it.each([
    [0, '0:00.0'],
    [5.3, '0:05.3'],
    [65.4, '1:05.4'],
    [600, '10:00.0'],
    [3599.9, '59:59.9'],
  ])('formats %s seconds as %s', (input, expected) => {
    expect(mmss(input)).toBe(expected)
  })

  it('returns an em-dash for null / undefined / NaN', () => {
    expect(mmss(null)).toBe('—')
    expect(mmss(undefined)).toBe('—')
    expect(mmss(NaN)).toBe('—')
  })
})

describe('pace500m', () => {
  it('formats a pace-seconds-per-500m integer as m:ss.0', () => {
    expect(pace500m(132)).toBe('2:12.0')
    expect(pace500m(115)).toBe('1:55.0')
  })

  it('returns an em-dash when null or <= 0', () => {
    expect(pace500m(null)).toBe('—')
    expect(pace500m(0)).toBe('—')
    expect(pace500m(-5)).toBe('—')
  })
})

describe('fmtInt', () => {
  it('formats integers with no decimals', () => {
    expect(fmtInt(245)).toBe('245')
    expect(fmtInt(0)).toBe('0')
  })

  it('returns em-dash for null', () => {
    expect(fmtInt(null)).toBe('—')
  })
})

describe('fmtFloat', () => {
  it('formats with given decimal places', () => {
    expect(fmtFloat(8.43, 1)).toBe('8.4')
    expect(fmtFloat(8.45, 1)).toBe('8.5')
    expect(fmtFloat(8, 2)).toBe('8.00')
  })

  it('returns em-dash for null', () => {
    expect(fmtFloat(null, 1)).toBe('—')
  })
})

describe('fmtMeters', () => {
  it('formats distances as plain integers with no thousands separator', () => {
    // FEAT-0008: tabular numerals; thousands separator is a readability
    // judgement call deferred to the next iteration. Keep it plain.
    expect(fmtMeters(342)).toBe('342')
    expect(fmtMeters(1234)).toBe('1234')
    expect(fmtMeters(0)).toBe('0')
  })
})
```

- [ ] **Step 2: Run — must fail**

```bash
cd web && npm test -- format
```

Expected: module-not-found.

- [ ] **Step 3: Implement**

Create `web/src/util/format.ts`:

```ts
const DASH = '—'

export function mmss(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return DASH
  const s = Math.max(0, seconds)
  const mins = Math.floor(s / 60)
  const secs = s - mins * 60
  // Always one decimal place; tenths are part of the live-view feel.
  return `${mins}:${secs.toFixed(1).padStart(4, '0')}`
}

export function pace500m(paceSecondsPer500m: number | null | undefined): string {
  if (paceSecondsPer500m === null || paceSecondsPer500m === undefined) return DASH
  if (!Number.isFinite(paceSecondsPer500m) || paceSecondsPer500m <= 0) return DASH
  return mmss(paceSecondsPer500m)
}

export function fmtInt(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return DASH
  return String(Math.trunc(v))
}

export function fmtFloat(v: number | null | undefined, decimals: number): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return DASH
  return v.toFixed(decimals)
}

export function fmtMeters(meters: number | null | undefined): string {
  return fmtInt(meters)
}
```

- [ ] **Step 4: Run — must pass**

```bash
cd web && npm test -- format
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add web/src/util
git commit -m "feat(web): tabular-friendly format utilities (mmss, pace500m, ints, floats)"
```

---

## Task 10: Live-stream event types

**Files:**
- Create: `web/src/live/events.ts`

Types mirror INT-0002 byte-for-byte. No runtime code; the payoff is every consumer gets completion + compile-time coverage of event-kind switches.

- [ ] **Step 1: Write**

```ts
// Wire types for the /api/v1/stream SSE endpoint. See
// specs/int/0002-live-stream-sse.md.

export type LiveEventKind =
  | 'stroke'
  | 'session_start'
  | 'session_end'
  | 'level_change'
  | 'ping'
  | 'eof'
  | 'error'

export type StrokePayload = {
  session_id: string
  stroke: number
  time_sec: number
  distance_m: number
  spm: number
  power_w: number
  cal_per_hr: number
  level: number
  dps: number
  stroke_cycle_sec: number
  pace_sec_per_500m: number
  energy_joules: number
}

export type SessionStartPayload = {
  session_id: string
  started_at: string
  rower_id: string
  rower_name: string
  initial_level: number
}

export type SessionEndSummary = {
  total_distance_m: number
  total_time_sec: number
  total_strokes: number
  avg_power_w: number
  peak_power_w: number
  avg_spm: number
  avg_dps: number
  avg_pace_sec_per_500m: number
  session_calories: number
}

export type SessionEndPayload = {
  session_id: string
  ended_at: string
  summary: SessionEndSummary
}

export type LevelChangePayload = {
  from: number
  to: number
  at_stroke: number
  at_time_sec: number
}

export type EofPayload = { session_id: string }

export type LiveEvent =
  | { kind: 'stroke'; id: number; data: StrokePayload }
  | { kind: 'session_start'; id: number; data: SessionStartPayload }
  | { kind: 'session_end'; id: number; data: SessionEndPayload }
  | { kind: 'level_change'; id: number; data: LevelChangePayload }
  | { kind: 'ping'; id: number | null; data: Record<string, never> }
  | { kind: 'eof'; id: number | null; data: EofPayload }
  | { kind: 'error'; id: number | null; data: { message: string } }
```

- [ ] **Step 2: Typecheck**

```bash
cd web && npm run typecheck
```

Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add web/src/live/events.ts
git commit -m "feat(web): live-stream event type definitions mirroring INT-0002"
```

---

## Task 11: Channel abstraction + MockChannel — failing test then implementation

**Files:**
- Create: `web/src/live/channel.ts`
- Create: `web/src/live/channel.test.ts`

A `Channel` is anything that pushes `LiveEvent`s and can be closed. `EventSourceChannel` is the production impl; `MockChannel` is the test seam. This lets the reducer, context, and Live page be tested without the JSDOM-missing `EventSource`.

- [ ] **Step 1: Write the failing test**

Create `web/src/live/channel.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'
import { MockChannel } from './channel'
import type { LiveEvent, StrokePayload } from './events'

function makeStroke(id: number, overrides: Partial<StrokePayload> = {}): LiveEvent {
  return {
    kind: 'stroke',
    id,
    data: {
      session_id: '01HV...',
      stroke: id,
      time_sec: id * 2,
      distance_m: id * 8,
      spm: 27,
      power_w: 200,
      cal_per_hr: 800,
      level: 3,
      dps: 8.1,
      stroke_cycle_sec: 2.2,
      pace_sec_per_500m: 132,
      energy_joules: 500,
      ...overrides,
    },
  }
}

describe('MockChannel', () => {
  it('delivers pushed events to the onEvent listener', () => {
    const ch = new MockChannel()
    const onEvent = vi.fn()
    ch.subscribe({ onEvent, onStatus: vi.fn() })
    ch.push(makeStroke(1))
    ch.push(makeStroke(2))
    expect(onEvent).toHaveBeenCalledTimes(2)
    expect(onEvent).toHaveBeenNthCalledWith(1, makeStroke(1))
  })

  it('buffers events pushed before subscribe and delivers them on subscribe', () => {
    const ch = new MockChannel()
    ch.push(makeStroke(1))
    ch.push(makeStroke(2))
    const onEvent = vi.fn()
    ch.subscribe({ onEvent, onStatus: vi.fn() })
    expect(onEvent).toHaveBeenCalledTimes(2)
  })

  it('reports status changes (idle → connecting → open → closed)', () => {
    const ch = new MockChannel()
    const onStatus = vi.fn()
    ch.subscribe({ onEvent: vi.fn(), onStatus })
    ch.setStatus('connecting')
    ch.setStatus('open')
    ch.close()
    expect(onStatus.mock.calls.map((c) => c[0])).toEqual([
      'idle',
      'connecting',
      'open',
      'closed',
    ])
  })

  it('close stops further event delivery', () => {
    const ch = new MockChannel()
    const onEvent = vi.fn()
    ch.subscribe({ onEvent, onStatus: vi.fn() })
    ch.push(makeStroke(1))
    ch.close()
    ch.push(makeStroke(2))
    expect(onEvent).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 2: Write the stub**

Create `web/src/live/channel.ts`:

```ts
import type { LiveEvent } from './events'

export type ChannelStatus = 'idle' | 'connecting' | 'open' | 'closed' | 'error'

export type Subscriber = {
  onEvent: (e: LiveEvent) => void
  onStatus: (s: ChannelStatus) => void
}

export interface Channel {
  subscribe(sub: Subscriber): void
  close(): void
}

export class MockChannel implements Channel {
  subscribe(_sub: Subscriber): void {}
  close(): void {}
  push(_e: LiveEvent): void {}
  setStatus(_s: ChannelStatus): void {}
}
```

- [ ] **Step 3: Run — must fail**

```bash
cd web && npm test -- channel
```

Expected: all four tests fail (no-op stub).

- [ ] **Step 4: Implement `MockChannel` + stub `EventSourceChannel`**

Replace `web/src/live/channel.ts`:

```ts
import type { LiveEvent } from './events'

export type ChannelStatus = 'idle' | 'connecting' | 'open' | 'closed' | 'error'

export type Subscriber = {
  onEvent: (e: LiveEvent) => void
  onStatus: (s: ChannelStatus) => void
}

export interface Channel {
  subscribe(sub: Subscriber): void
  close(): void
}

/**
 * In-memory test channel. Pushes events to the current subscriber (or
 * buffers until one arrives). Every subscriber gets one implicit
 * `onStatus('idle')` on subscribe so consumers don't need to special-
 * case an initial undefined status.
 */
export class MockChannel implements Channel {
  private sub: Subscriber | null = null
  private buffer: LiveEvent[] = []
  private status: ChannelStatus = 'idle'
  private closed = false

  subscribe(sub: Subscriber): void {
    this.sub = sub
    sub.onStatus(this.status)
    for (const e of this.buffer) sub.onEvent(e)
    this.buffer = []
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    this.setStatus('closed')
    this.sub = null
  }

  push(e: LiveEvent): void {
    if (this.closed) return
    if (this.sub) this.sub.onEvent(e)
    else this.buffer.push(e)
  }

  setStatus(s: ChannelStatus): void {
    this.status = s
    this.sub?.onStatus(s)
  }
}

/**
 * Production channel — wraps EventSource.
 *
 * URL: /api/v1/stream (credentials included; same-origin cookie auth).
 * Persists `lastEventId` in localStorage so cold reloads resume
 * (INT-0002 client expectations).
 */
export class EventSourceChannel implements Channel {
  private es: EventSource | null = null
  private sub: Subscriber | null = null
  private readonly storageKey = 'home-ergo:last-event-id'

  subscribe(sub: Subscriber): void {
    this.sub = sub
    sub.onStatus('connecting')

    const last = this.readLastEventId()
    const url = last ? `/api/v1/stream?since=${encodeURIComponent(last)}` : '/api/v1/stream'

    const es = new EventSource(url, { withCredentials: true })
    this.es = es

    es.onopen = () => sub.onStatus('open')
    es.onerror = () => sub.onStatus('error')

    const handle = <T>(kind: Exclude<LiveEvent['kind'], 'ping' | 'eof' | 'error'>) => {
      es.addEventListener(kind, (raw) => {
        const ev = raw as MessageEvent
        try {
          const data = JSON.parse(ev.data) as T
          const id = Number(ev.lastEventId)
          if (Number.isFinite(id)) this.writeLastEventId(String(id))
          sub.onEvent({ kind, id, data } as LiveEvent)
        } catch (e) {
          sub.onEvent({
            kind: 'error',
            id: null,
            data: { message: `malformed ${kind} payload` },
          })
        }
      })
    }

    handle('stroke')
    handle('session_start')
    handle('session_end')
    handle('level_change')

    es.addEventListener('ping', () =>
      sub.onEvent({ kind: 'ping', id: null, data: {} as Record<string, never> }),
    )
    es.addEventListener('eof', (raw) => {
      const ev = raw as MessageEvent
      try {
        const data = JSON.parse(ev.data) as { session_id: string }
        sub.onEvent({ kind: 'eof', id: null, data })
      } catch {
        sub.onEvent({
          kind: 'error',
          id: null,
          data: { message: 'malformed eof payload' },
        })
      }
    })
  }

  close(): void {
    this.es?.close()
    this.es = null
    this.sub?.onStatus('closed')
    this.sub = null
  }

  private readLastEventId(): string | null {
    try {
      return localStorage.getItem(this.storageKey)
    } catch {
      return null
    }
  }

  private writeLastEventId(v: string): void {
    try {
      localStorage.setItem(this.storageKey, v)
    } catch {
      /* ignore */
    }
  }
}
```

- [ ] **Step 5: Run — must pass**

```bash
cd web && npm test -- channel
```

Expected: all four pass.

- [ ] **Step 6: Commit**

```bash
git add web/src/live/channel.ts web/src/live/channel.test.ts
git commit -m "feat(web): Channel abstraction with Mock + EventSource impls"
```

---

## Task 12: Live reducer — failing test then implementation

**Files:**
- Create: `web/src/live/reducer.ts`
- Create: `web/src/live/reducer.test.ts`

The reducer is the brain of the live view: accepts `LiveEvent`s, produces a `LiveState` with the current session, latest stroke, rolling sparkline windows, and connection status.

- [ ] **Step 1: Write the failing test**

Create `web/src/live/reducer.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { liveReducer, initialLiveState, type LiveState } from './reducer'
import type { LiveEvent, StrokePayload, SessionStartPayload } from './events'

function stroke(id: number, payload: Partial<StrokePayload>): LiveEvent {
  return {
    kind: 'stroke',
    id,
    data: {
      session_id: 'S1',
      stroke: id,
      time_sec: id * 2,
      distance_m: id * 8,
      spm: 27,
      power_w: 200,
      cal_per_hr: 800,
      level: 3,
      dps: 8,
      stroke_cycle_sec: 2.2,
      pace_sec_per_500m: 132,
      energy_joules: 500,
      ...payload,
    },
  }
}

function start(ss: Partial<SessionStartPayload> = {}): LiveEvent {
  return {
    kind: 'session_start',
    id: 0,
    data: {
      session_id: 'S1',
      started_at: '2026-04-20T10:00:00Z',
      rower_id: 'R1',
      rower_name: 'Daniel',
      initial_level: 3,
      ...ss,
    },
  }
}

describe('liveReducer', () => {
  it('initial state has no session, waiting status', () => {
    expect(initialLiveState.status).toBe('idle')
    expect(initialLiveState.session).toBe(null)
    expect(initialLiveState.stroke).toBe(null)
  })

  it('status event updates connectionStatus', () => {
    const s = liveReducer(initialLiveState, {
      type: 'status',
      status: 'open',
    })
    expect(s.status).toBe('open')
  })

  it('session_start sets session and clears any prior stroke', () => {
    let s: LiveState = initialLiveState
    s = liveReducer(s, { type: 'event', event: stroke(1, {}) })
    s = liveReducer(s, { type: 'event', event: start() })
    expect(s.session).not.toBe(null)
    expect(s.session!.rower_name).toBe('Daniel')
    expect(s.stroke).toBe(null)
    expect(s.sparklines.power.length).toBe(0)
    expect(s.sparklines.split.length).toBe(0)
  })

  it('stroke updates latest stroke and appends to sparkline windows', () => {
    let s = liveReducer(initialLiveState, { type: 'event', event: start() })
    s = liveReducer(s, { type: 'event', event: stroke(1, { power_w: 210, pace_sec_per_500m: 130 }) })
    s = liveReducer(s, { type: 'event', event: stroke(2, { power_w: 215, pace_sec_per_500m: 128 }) })
    expect(s.stroke!.stroke).toBe(2)
    expect(s.sparklines.power.map((p) => p.value)).toEqual([210, 215])
    expect(s.sparklines.split.map((p) => p.value)).toEqual([130, 128])
  })

  it('sparkline windows drop points older than 60 s', () => {
    let s = liveReducer(initialLiveState, { type: 'event', event: start() })
    s = liveReducer(s, { type: 'event', event: stroke(1, { time_sec: 0, power_w: 100 }) })
    s = liveReducer(s, { type: 'event', event: stroke(2, { time_sec: 30, power_w: 200 }) })
    s = liveReducer(s, { type: 'event', event: stroke(3, { time_sec: 80, power_w: 300 }) })
    // With the latest stroke at t=80, the window covers [20, 80]. The
    // point at t=0 drops; the one at t=30 stays.
    expect(s.sparklines.power.map((p) => p.value)).toEqual([200, 300])
  })

  it('session_end clears live stroke but keeps session summary', () => {
    let s = liveReducer(initialLiveState, { type: 'event', event: start() })
    s = liveReducer(s, { type: 'event', event: stroke(1, {}) })
    s = liveReducer(s, {
      type: 'event',
      event: {
        kind: 'session_end',
        id: 2,
        data: {
          session_id: 'S1',
          ended_at: '2026-04-20T10:05:00Z',
          summary: {
            total_distance_m: 1035,
            total_time_sec: 284,
            total_strokes: 124,
            avg_power_w: 259,
            peak_power_w: 322,
            avg_spm: 26.3,
            avg_dps: 8.35,
            avg_pace_sec_per_500m: 137,
            session_calories: 112,
          },
        },
      },
    })
    expect(s.stroke).toBe(null)
    expect(s.session).not.toBe(null)
    expect(s.summary?.total_strokes).toBe(124)
  })

  it('ping does not mutate state (identity-stable)', () => {
    const before = liveReducer(initialLiveState, { type: 'event', event: start() })
    const after = liveReducer(before, {
      type: 'event',
      event: { kind: 'ping', id: null, data: {} },
    })
    expect(after).toBe(before)
  })
})
```

- [ ] **Step 2: Implement**

Create `web/src/live/reducer.ts`:

```ts
import type {
  LiveEvent,
  SessionStartPayload,
  StrokePayload,
  SessionEndSummary,
} from './events'
import type { ChannelStatus } from './channel'

const SPARKLINE_WINDOW_SEC = 60

export type SparklinePoint = { time_sec: number; value: number }

export type LiveState = {
  status: ChannelStatus
  session: SessionStartPayload | null
  stroke: StrokePayload | null
  summary: SessionEndSummary | null
  sparklines: {
    power: SparklinePoint[]
    split: SparklinePoint[]
    dps: SparklinePoint[]
    spm: SparklinePoint[]
  }
  lastStrokeReceivedAtMs: number | null
}

export const initialLiveState: LiveState = {
  status: 'idle',
  session: null,
  stroke: null,
  summary: null,
  sparklines: { power: [], split: [], dps: [], spm: [] },
  lastStrokeReceivedAtMs: null,
}

export type LiveAction =
  | { type: 'status'; status: ChannelStatus }
  | { type: 'event'; event: LiveEvent }
  | { type: 'tick'; nowMs: number }

function trimWindow(points: SparklinePoint[], now: number): SparklinePoint[] {
  const cutoff = now - SPARKLINE_WINDOW_SEC
  let i = 0
  while (i < points.length && points[i].time_sec < cutoff) i++
  return i === 0 ? points : points.slice(i)
}

export function liveReducer(state: LiveState, action: LiveAction): LiveState {
  switch (action.type) {
    case 'status':
      if (state.status === action.status) return state
      return { ...state, status: action.status }

    case 'tick':
      return state

    case 'event': {
      const ev = action.event
      switch (ev.kind) {
        case 'ping':
        case 'error':
          return state

        case 'eof':
          return { ...state, stroke: null }

        case 'session_start':
          return {
            ...state,
            session: ev.data,
            stroke: null,
            summary: null,
            sparklines: { power: [], split: [], dps: [], spm: [] },
            lastStrokeReceivedAtMs: null,
          }

        case 'stroke': {
          const p = ev.data
          const appendOrTrim = (series: SparklinePoint[], value: number) => {
            const next = [...series, { time_sec: p.time_sec, value }]
            return trimWindow(next, p.time_sec)
          }
          return {
            ...state,
            stroke: p,
            sparklines: {
              power: appendOrTrim(state.sparklines.power, p.power_w),
              split: appendOrTrim(state.sparklines.split, p.pace_sec_per_500m),
              dps: appendOrTrim(state.sparklines.dps, p.dps),
              spm: appendOrTrim(state.sparklines.spm, p.spm),
            },
            lastStrokeReceivedAtMs: Date.now(),
          }
        }

        case 'session_end':
          return {
            ...state,
            stroke: null,
            summary: ev.data.summary,
          }

        case 'level_change':
          // Convenience event; stroke already carries the new level.
          return state
      }
    }
  }
}
```

- [ ] **Step 3: Run — must pass**

```bash
cd web && npm test -- reducer
```

Expected: all seven tests pass.

- [ ] **Step 4: Commit**

```bash
git add web/src/live/reducer.ts web/src/live/reducer.test.ts
git commit -m "feat(web): liveReducer with 60s sparkline window"
```

---

## Task 13: LiveSessionContext + useEventSource hook

**Files:**
- Create: `web/src/live/useEventSource.ts`
- Create: `web/src/live/useEventSource.test.ts`
- Create: `web/src/live/LiveSessionContext.tsx`
- Create: `web/src/live/LiveSessionContext.test.tsx`

The provider wires a `Channel` into the `liveReducer` and exposes the state to consumers. The `channel` is injectable so tests pass a `MockChannel`.

- [ ] **Step 1: Write `useEventSource.ts`**

```ts
import { useEffect, useReducer } from 'react'
import type { Channel } from './channel'
import { liveReducer, initialLiveState, type LiveState } from './reducer'

export function useEventSource(channel: Channel): LiveState {
  const [state, dispatch] = useReducer(liveReducer, initialLiveState)

  useEffect(() => {
    channel.subscribe({
      onEvent: (event) => dispatch({ type: 'event', event }),
      onStatus: (status) => dispatch({ type: 'status', status }),
    })
    return () => channel.close()
  }, [channel])

  return state
}
```

- [ ] **Step 2: Write `useEventSource.test.ts`**

```ts
import { renderHook, act, waitFor } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { useEventSource } from './useEventSource'
import { MockChannel } from './channel'

describe('useEventSource', () => {
  it('subscribes and relays status + events into reducer state', async () => {
    const ch = new MockChannel()
    const { result } = renderHook(() => useEventSource(ch))

    expect(result.current.status).toBe('idle')

    act(() => ch.setStatus('open'))
    await waitFor(() => expect(result.current.status).toBe('open'))

    act(() =>
      ch.push({
        kind: 'session_start',
        id: 0,
        data: {
          session_id: 'S1',
          started_at: '2026-04-20T10:00:00Z',
          rower_id: 'R1',
          rower_name: 'Daniel',
          initial_level: 3,
        },
      }),
    )
    await waitFor(() => expect(result.current.session?.rower_name).toBe('Daniel'))
  })

  it('closes the channel on unmount', () => {
    const ch = new MockChannel()
    const { unmount } = renderHook(() => useEventSource(ch))
    unmount()
    // After close, subsequent pushes are silent — the test is
    // structural (no throw) rather than assertional.
    expect(() => ch.push({ kind: 'ping', id: null, data: {} })).not.toThrow()
  })
})
```

- [ ] **Step 3: Write `LiveSessionContext.tsx`**

```tsx
import { createContext, useContext, useMemo, type ReactNode } from 'react'
import { EventSourceChannel, type Channel } from './channel'
import { useEventSource } from './useEventSource'
import type { LiveState } from './reducer'

const LiveSessionContext = createContext<LiveState | null>(null)

type Props = {
  children: ReactNode
  /** Optional injection point for tests. Defaults to EventSourceChannel. */
  channel?: Channel
}

export function LiveSessionProvider({ children, channel }: Props) {
  const resolved = useMemo(() => channel ?? new EventSourceChannel(), [channel])
  const state = useEventSource(resolved)
  return <LiveSessionContext.Provider value={state}>{children}</LiveSessionContext.Provider>
}

export function useLiveSession(): LiveState {
  const v = useContext(LiveSessionContext)
  if (!v) throw new Error('useLiveSession must be used inside <LiveSessionProvider>')
  return v
}
```

- [ ] **Step 4: Write `LiveSessionContext.test.tsx`**

```tsx
import { render, screen, act, waitFor } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { LiveSessionProvider, useLiveSession } from './LiveSessionContext'
import { MockChannel } from './channel'

function Probe() {
  const s = useLiveSession()
  return (
    <div>
      <span data-testid="status">{s.status}</span>
      <span data-testid="rower">{s.session?.rower_name ?? 'none'}</span>
    </div>
  )
}

describe('LiveSessionProvider', () => {
  it('exposes state to consumers via useLiveSession', async () => {
    const ch = new MockChannel()
    render(
      <LiveSessionProvider channel={ch}>
        <Probe />
      </LiveSessionProvider>,
    )

    expect(screen.getByTestId('status')).toHaveTextContent('idle')
    expect(screen.getByTestId('rower')).toHaveTextContent('none')

    act(() => ch.setStatus('open'))
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('open'))
  })

  it('throws a clear error if used outside the provider', () => {
    const Boom = () => {
      useLiveSession()
      return null
    }
    expect(() => render(<Boom />)).toThrow(/inside <LiveSessionProvider>/)
  })
})
```

- [ ] **Step 5: Run — must pass**

```bash
cd web && npm test -- live
```

Expected: all tests in `channel`, `reducer`, `useEventSource`, `LiveSessionContext` pass.

- [ ] **Step 6: Commit**

```bash
git add web/src/live/useEventSource.ts web/src/live/useEventSource.test.ts web/src/live/LiveSessionContext.tsx web/src/live/LiveSessionContext.test.tsx
git commit -m "feat(web): LiveSessionProvider wiring Channel to liveReducer"
```

---

## Task 14: App shell — router, layout, bottom nav, health indicator

**Files:**
- Create / overwrite: `web/src/app/AppRouter.tsx`
- Create: `web/src/app/AppLayout.tsx`
- Create: `web/src/app/AppLayout.module.css`
- Create: `web/src/app/BottomNav.tsx`
- Create: `web/src/app/BottomNav.module.css`
- Create: `web/src/app/NotFound.tsx`
- Create: `web/src/app/ErrorBoundary.tsx`
- Create placeholder: `web/src/pages/HistoryPage.tsx`
- Create placeholder: `web/src/pages/ProfilePage.tsx`

Three top-level routes: `/` (Live — the default), `/historie`, `/profil`. History and Profile land as placeholder pages now so the nav works end-to-end; they get fleshed out in follow-up plans.

- [ ] **Step 1: Write the layout CSS**

Create `web/src/app/AppLayout.module.css`:

```css
.shell {
  min-height: 100dvh;
  display: grid;
  grid-template-rows: 1fr auto;
  background: var(--color-surface);
  color: var(--color-on-surface);
}

.main {
  overflow-y: auto;
  padding-bottom: var(--layout-bottom-nav-h);
}
```

- [ ] **Step 2: Write the bottom nav CSS**

Create `web/src/app/BottomNav.module.css`:

```css
.nav {
  position: sticky;
  bottom: 0;
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  background: var(--color-surface-container-low);
  height: var(--layout-bottom-nav-h);
  padding: 0 var(--space-2);
  padding-bottom: env(safe-area-inset-bottom);
}

.link {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--space-0-5);
  color: var(--color-on-surface-variant);
  font-family: var(--font-body);
  font-size: var(--text-label-sm);
  letter-spacing: 0.05em;
  text-transform: uppercase;
  transition: color var(--motion-state) var(--motion-ease);
}

.link[aria-current='page'] {
  color: var(--color-primary);
}

.link:hover {
  color: var(--color-on-surface);
}
```

- [ ] **Step 3: Write `BottomNav.tsx`**

```tsx
import { NavLink } from 'react-router-dom'
import { IconHome, IconHistory, IconProfile } from '../icons'
import styles from './BottomNav.module.css'

export function BottomNav() {
  return (
    <nav className={styles.nav} aria-label="Hauptnavigation">
      <NavLink to="/" end className={styles.link}>
        <IconHome />
        <span>Live</span>
      </NavLink>
      <NavLink to="/historie" className={styles.link}>
        <IconHistory />
        <span>Historie</span>
      </NavLink>
      <NavLink to="/profil" className={styles.link}>
        <IconProfile />
        <span>Profil</span>
      </NavLink>
    </nav>
  )
}
```

- [ ] **Step 4: Write `AppLayout.tsx`**

```tsx
import { Outlet } from 'react-router-dom'
import { BottomNav } from './BottomNav'
import styles from './AppLayout.module.css'

export function AppLayout() {
  return (
    <div className={styles.shell}>
      <main className={styles.main}>
        <Outlet />
      </main>
      <BottomNav />
    </div>
  )
}
```

- [ ] **Step 5: Write `NotFound.tsx`**

```tsx
export function NotFound() {
  return (
    <div style={{ padding: 'var(--space-4)' }}>
      <h1 className="headline-sm">Seite nicht gefunden</h1>
      <p className="body-lg">Die angeforderte Seite existiert nicht.</p>
    </div>
  )
}
```

- [ ] **Step 6: Write `ErrorBoundary.tsx`**

```tsx
import { Component, type ReactNode } from 'react'

type Props = { children: ReactNode }
type State = { error: Error | null }

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error) {
    // eslint-disable-next-line no-console
    console.error('ErrorBoundary caught', error)
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 'var(--space-4)' }}>
          <h1 className="headline-sm">Etwas ist schiefgelaufen.</h1>
          <p className="body-lg">{this.state.error.message}</p>
        </div>
      )
    }
    return this.props.children
  }
}
```

- [ ] **Step 7: Write placeholder pages**

Create `web/src/pages/HistoryPage.tsx`:

```tsx
export function HistoryPage() {
  return (
    <div style={{ padding: 'var(--space-3)' }}>
      <h1 className="headline-sm">Historie</h1>
      <p className="body-lg">
        Session-Liste und Trends folgen in einem späteren Plan (FEAT-0003 / FEAT-0003a).
      </p>
    </div>
  )
}
```

Create `web/src/pages/ProfilePage.tsx`:

```tsx
import { useTheme } from '../theme/useTheme'
import { Button } from '../components/Button/Button'

export function ProfilePage() {
  const [theme, setTheme] = useTheme()
  return (
    <div style={{ padding: 'var(--space-3)', display: 'grid', gap: 'var(--space-3)' }}>
      <h1 className="headline-sm">Profil</h1>
      <section>
        <h2 className="label-sm">Design</h2>
        <div style={{ display: 'flex', gap: 'var(--space-1)', marginTop: 'var(--space-1)' }}>
          <Button
            variant={theme === 'system' ? 'primary' : 'secondary'}
            onClick={() => setTheme('system')}
          >
            System
          </Button>
          <Button
            variant={theme === 'dark' ? 'primary' : 'secondary'}
            onClick={() => setTheme('dark')}
          >
            Dunkel
          </Button>
          <Button
            variant={theme === 'light' ? 'primary' : 'secondary'}
            onClick={() => setTheme('light')}
          >
            Hell
          </Button>
        </div>
      </section>
      <p className="body-lg">
        Weitere Profil-Inhalte (Rekorde, Ziele, Rower-Switcher) folgen in einem späteren Plan.
      </p>
    </div>
  )
}
```

- [ ] **Step 8: Write `AppRouter.tsx`**

Overwrite `web/src/app/AppRouter.tsx`:

```tsx
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { AppLayout } from './AppLayout'
import { ErrorBoundary } from './ErrorBoundary'
import { NotFound } from './NotFound'
import { LiveSessionProvider } from '../live/LiveSessionContext'
import { LivePage } from '../pages/LivePage'
import { HistoryPage } from '../pages/HistoryPage'
import { ProfilePage } from '../pages/ProfilePage'

export function AppRouter() {
  return (
    <ErrorBoundary>
      <LiveSessionProvider>
        <BrowserRouter>
          <Routes>
            <Route element={<AppLayout />}>
              <Route index element={<LivePage />} />
              <Route path="/historie" element={<HistoryPage />} />
              <Route path="/profil" element={<ProfilePage />} />
              <Route path="*" element={<NotFound />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </LiveSessionProvider>
    </ErrorBoundary>
  )
}
```

`LivePage` doesn't exist yet — create an empty shell so the build compiles. Task 17 replaces it.

- [ ] **Step 9: Write the `LivePage` shell**

Create `web/src/pages/LivePage.tsx`:

```tsx
export function LivePage() {
  return (
    <div style={{ padding: 'var(--space-3)' }}>
      <p className="body-lg">Live view fleshed out in Task 17.</p>
    </div>
  )
}
```

Create `web/src/pages/LivePage.module.css`:

```css
/* Populated in Task 17. */
```

- [ ] **Step 10: Verify dev-server boot**

```bash
cd web && npm run dev
```

Visit `http://localhost:5173/` — you should see the three-tab bottom nav, the Live placeholder text, and be able to route between Live / Historie / Profil. The theme buttons on Profil should switch dark/light without flash. Kill with Ctrl-C.

- [ ] **Step 11: Typecheck + tests + build**

```bash
cd web && npm run typecheck && npm test && npm run build
```

Expected: all green.

- [ ] **Step 12: Commit**

```bash
git add web/src/app web/src/pages web/src/main.tsx
git commit -m "feat(web): routed app shell with bottom nav + placeholder pages"
```

---

## Task 15: Tile registry, selectors, layout persistence

**Files:**
- Create: `web/src/tiles/registry.ts`
- Create: `web/src/tiles/registry.test.ts`
- Create: `web/src/tiles/selectors.ts`
- Create: `web/src/tiles/selectors.test.ts`
- Create: `web/src/tiles/layout.ts`
- Create: `web/src/tiles/layout.test.ts`

The registry is the canonical tile catalogue from `specs/feat/0001a-tile-catalogue.md`. Selectors map live state → display values. Layout persists the 2×3 grid to `localStorage` and applies the default layout on first load.

- [ ] **Step 1: Write `registry.ts`**

```ts
// Tile registry — canonical source for what the user can put on the
// live dashboard. See specs/feat/0001a-tile-catalogue.md.
//
// Every tile has:
//   - id          machine name, used as storage + selector key
//   - label       short German label shown on the tile and in the picker
//   - subtitle    German longer-form description (picker only)
//   - type        Numeric | Sparkline | ZoneBadge
//   - unit        optional, displayed next to the value on Numeric tiles
//   - gated       'hr' when the tile requires a paired HR source (FEAT-0001a)
//   - category    'zahlen' | 'verlaeufe' | 'bewertung' — for picker ordering
//                 and future category headers (deferred)

export type TileType = 'numeric' | 'sparkline' | 'zone'

export type TileDef = {
  id: string
  label: string
  subtitle?: string
  type: TileType
  unit?: string
  gated?: 'hr'
  category: 'zahlen' | 'verlaeufe' | 'bewertung'
}

export const TILES: TileDef[] = [
  { id: 'zeit', label: 'Zeit', type: 'numeric', category: 'zahlen' },
  { id: 'distanz', label: 'Distanz', type: 'numeric', unit: 'm', category: 'zahlen' },
  {
    id: 'split',
    label: 'Split',
    subtitle: 'Zeit pro 500 m Intervall',
    type: 'numeric',
    unit: '/ 500m',
    category: 'zahlen',
  },
  {
    id: 'dps',
    label: 'DPS',
    subtitle: 'Distanz pro Schlag in Metern',
    type: 'numeric',
    unit: 'm',
    category: 'zahlen',
  },
  { id: 'spi', label: 'SPI', type: 'numeric', category: 'zahlen' },
  { id: 'spm', label: 'SPM', type: 'numeric', category: 'zahlen' },
  { id: 'watt', label: 'Watt', type: 'numeric', unit: 'W', category: 'zahlen' },
  {
    id: 'oe-split',
    label: 'Ø Split',
    subtitle: 'Session-Durchschnitt',
    type: 'numeric',
    unit: '/ 500m',
    category: 'zahlen',
  },
  {
    id: 'kalorien',
    label: 'Kalorien',
    subtitle: 'Energieverbrauch (kcal/h)',
    type: 'numeric',
    unit: 'kcal/h',
    category: 'zahlen',
  },
  {
    id: 'herzfrequenz',
    label: 'Herzfrequenz',
    subtitle: 'Aktuelle Herzfrequenz (BPM)',
    type: 'numeric',
    unit: 'bpm',
    gated: 'hr',
    category: 'zahlen',
  },
  {
    id: 'split-verlauf',
    label: 'Split-Verlauf',
    type: 'sparkline',
    category: 'verlaeufe',
  },
  {
    id: 'watt-verlauf',
    label: 'Watt-Verlauf',
    type: 'sparkline',
    category: 'verlaeufe',
  },
  {
    id: 'hf-verlauf',
    label: 'HF-Verlauf',
    type: 'sparkline',
    gated: 'hr',
    category: 'verlaeufe',
  },
  {
    id: 'hf-zone',
    label: 'HF-Zone',
    type: 'zone',
    gated: 'hr',
    category: 'bewertung',
  },
]

const BY_ID = Object.fromEntries(TILES.map((t) => [t.id, t]))

export function getTile(id: string): TileDef | undefined {
  return BY_ID[id]
}

export function tilesByCategory(): Record<TileDef['category'], TileDef[]> {
  const out: Record<TileDef['category'], TileDef[]> = {
    zahlen: [],
    verlaeufe: [],
    bewertung: [],
  }
  for (const t of TILES) out[t.category].push(t)
  return out
}
```

- [ ] **Step 2: Write `registry.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import { TILES, getTile, tilesByCategory } from './registry'

describe('tile registry', () => {
  it('ids are unique', () => {
    const ids = new Set(TILES.map((t) => t.id))
    expect(ids.size).toBe(TILES.length)
  })

  it('all HR-gated tiles share the gated:"hr" marker', () => {
    for (const id of ['herzfrequenz', 'hf-verlauf', 'hf-zone']) {
      expect(getTile(id)?.gated).toBe('hr')
    }
  })

  it('categories cover every tile', () => {
    const byCat = tilesByCategory()
    const total = byCat.zahlen.length + byCat.verlaeufe.length + byCat.bewertung.length
    expect(total).toBe(TILES.length)
  })

  it('defaults match the FEAT-0001a default layout', () => {
    // Default layout targets: Split-Verlauf, DPS, Ø Split, Watt-Verlauf,
    // SPI, HF-Zone. All six must exist in the registry.
    for (const id of [
      'split-verlauf',
      'dps',
      'oe-split',
      'watt-verlauf',
      'spi',
      'hf-zone',
    ]) {
      expect(getTile(id)).toBeDefined()
    }
  })
})
```

- [ ] **Step 3: Write `selectors.ts`**

```ts
import type { LiveState, SparklinePoint } from '../live/reducer'
import { fmtFloat, fmtInt, fmtMeters, mmss, pace500m } from '../util/format'

export type NumericValue = { value: string; unit?: string }
export type SparklineValue = { points: SparklinePoint[] }
export type ZoneValue = { zone: string | null; prompt?: string }

export function selectNumeric(state: LiveState, tileId: string): NumericValue {
  const s = state.stroke
  switch (tileId) {
    case 'zeit':
      return { value: mmss(s?.time_sec ?? null) }
    case 'distanz':
      return { value: fmtMeters(s?.distance_m ?? null), unit: 'm' }
    case 'split':
      return { value: pace500m(s?.pace_sec_per_500m ?? null), unit: '/ 500m' }
    case 'dps':
      return { value: fmtFloat(s?.dps ?? null, 1), unit: 'm' }
    case 'spi': {
      // SPI = power_w / spm, edge cases per tile-catalogue: spm=0 or
      // power_w<20 → em-dash. Defined in FEAT-0007.
      if (!s || s.spm === 0 || s.power_w < 20) return { value: '—' }
      return { value: fmtFloat(s.power_w / s.spm, 1) }
    }
    case 'spm':
      return { value: fmtInt(s?.spm ?? null) }
    case 'watt':
      return { value: fmtInt(s?.power_w ?? null), unit: 'W' }
    case 'oe-split':
      return { value: pace500m(state.summary?.avg_pace_sec_per_500m ?? null), unit: '/ 500m' }
    case 'kalorien':
      return { value: fmtInt(s?.cal_per_hr ?? null), unit: 'kcal/h' }
    case 'herzfrequenz':
      // HR not wired in this plan; render em-dash. The grid still marks
      // the tile disabled via the gated flag (UI concern).
      return { value: '—', unit: 'bpm' }
    default:
      return { value: '—' }
  }
}

export function selectSparkline(state: LiveState, tileId: string): SparklineValue {
  switch (tileId) {
    case 'watt-verlauf':
      return { points: state.sparklines.power }
    case 'split-verlauf':
      return { points: state.sparklines.split }
    case 'hf-verlauf':
      return { points: [] }
    default:
      return { points: [] }
  }
}

export function selectZone(_state: LiveState, tileId: string): ZoneValue {
  switch (tileId) {
    case 'hf-zone':
      // HR not wired; prompt-to-set-HR variant handled by the grid when
      // HR data starts flowing without a max-HR profile entry. For now
      // just render the zone as null.
      return { zone: null }
    default:
      return { zone: null }
  }
}
```

- [ ] **Step 4: Write `selectors.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import { selectNumeric, selectSparkline } from './selectors'
import { initialLiveState, liveReducer, type LiveState } from '../live/reducer'
import type { LiveEvent } from '../live/events'

function pushStroke(state: LiveState, overrides: Partial<LiveEvent['data']> = {}): LiveState {
  const event: LiveEvent = {
    kind: 'stroke',
    id: 1,
    data: {
      session_id: 'S1',
      stroke: 1,
      time_sec: 65.4,
      distance_m: 342,
      spm: 27,
      power_w: 245,
      cal_per_hr: 1175,
      level: 3,
      dps: 8.4,
      stroke_cycle_sec: 2.22,
      pace_sec_per_500m: 132,
      energy_joules: 544,
      ...(overrides as never),
    },
  }
  return liveReducer(state, { type: 'event', event })
}

describe('selectNumeric', () => {
  it('formats zeit / distanz / split / dps / spm / watt', () => {
    const s = pushStroke(initialLiveState)
    expect(selectNumeric(s, 'zeit').value).toBe('1:05.4')
    expect(selectNumeric(s, 'distanz').value).toBe('342')
    expect(selectNumeric(s, 'split').value).toBe('2:12.0')
    expect(selectNumeric(s, 'dps').value).toBe('8.4')
    expect(selectNumeric(s, 'spm').value).toBe('27')
    expect(selectNumeric(s, 'watt').value).toBe('245')
  })

  it('computes SPI = power / SPM and guards the edge cases', () => {
    const ok = pushStroke(initialLiveState, { power_w: 240, spm: 24 })
    expect(selectNumeric(ok, 'spi').value).toBe('10.0')

    const spmZero = pushStroke(initialLiveState, { spm: 0 })
    expect(selectNumeric(spmZero, 'spi').value).toBe('—')

    const lowPower = pushStroke(initialLiveState, { power_w: 15 })
    expect(selectNumeric(lowPower, 'spi').value).toBe('—')
  })

  it('renders em-dash before any stroke arrives', () => {
    expect(selectNumeric(initialLiveState, 'split').value).toBe('—')
    expect(selectNumeric(initialLiveState, 'dps').value).toBe('—')
  })
})

describe('selectSparkline', () => {
  it('returns the power series for watt-verlauf', () => {
    let s = initialLiveState
    s = pushStroke(s, { time_sec: 1, power_w: 200 })
    s = pushStroke(s, { time_sec: 2, power_w: 210 })
    const series = selectSparkline(s, 'watt-verlauf')
    expect(series.points.map((p) => p.value)).toEqual([200, 210])
  })
})
```

- [ ] **Step 5: Write `layout.ts`**

```ts
// Persists the 2×3 live dashboard tile layout to localStorage. A layout
// is an array of six tile ids (row-major: r1c1, r1c2, r1c3, r2c1, …).

const STORAGE_KEY = 'home-ergo:tile-layout:v1'

export type TileLayout = [string, string, string, string, string, string]

export const DEFAULT_LAYOUT: TileLayout = [
  'split-verlauf',
  'dps',
  'oe-split',
  'watt-verlauf',
  'spi',
  'hf-zone',
]

export function loadLayout(): TileLayout {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return [...DEFAULT_LAYOUT] as TileLayout
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed) || parsed.length !== 6) return [...DEFAULT_LAYOUT] as TileLayout
    if (!parsed.every((x) => typeof x === 'string')) return [...DEFAULT_LAYOUT] as TileLayout
    return parsed as TileLayout
  } catch {
    return [...DEFAULT_LAYOUT] as TileLayout
  }
}

export function saveLayout(layout: TileLayout): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(layout))
  } catch {
    /* ignore */
  }
}

export function replaceSlot(layout: TileLayout, slotIndex: number, tileId: string): TileLayout {
  const next = [...layout] as TileLayout
  next[slotIndex] = tileId
  return next
}
```

- [ ] **Step 6: Write `layout.test.ts`**

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { DEFAULT_LAYOUT, loadLayout, replaceSlot, saveLayout } from './layout'

describe('tile layout storage', () => {
  beforeEach(() => localStorage.clear())

  it('returns the default layout when localStorage is empty', () => {
    expect(loadLayout()).toEqual(DEFAULT_LAYOUT)
  })

  it('round-trips a saved layout', () => {
    const next = [...DEFAULT_LAYOUT] as ReturnType<typeof loadLayout>
    next[0] = 'spm'
    saveLayout(next)
    expect(loadLayout()).toEqual(next)
  })

  it('falls back to default on corrupt storage', () => {
    localStorage.setItem('home-ergo:tile-layout:v1', 'not-json{')
    expect(loadLayout()).toEqual(DEFAULT_LAYOUT)
  })

  it('replaceSlot returns a new array with the slot swapped', () => {
    const updated = replaceSlot(DEFAULT_LAYOUT, 2, 'spm')
    expect(updated[2]).toBe('spm')
    expect(updated[0]).toBe(DEFAULT_LAYOUT[0])
    // Immutability.
    expect(updated).not.toBe(DEFAULT_LAYOUT)
  })
})
```

- [ ] **Step 7: Run — all must pass**

```bash
cd web && npm test -- tiles
```

Expected: all tests in `registry`, `selectors`, `layout` pass.

- [ ] **Step 8: Commit**

```bash
git add web/src/tiles/registry.ts web/src/tiles/registry.test.ts web/src/tiles/selectors.ts web/src/tiles/selectors.test.ts web/src/tiles/layout.ts web/src/tiles/layout.test.ts
git commit -m "feat(web): tile registry, selectors, and layout persistence"
```

---

## Task 16: Tile components + Sparkline primitive

**Files:**
- Create: `web/src/components/Sparkline/Sparkline.tsx`
- Create: `web/src/components/Sparkline/Sparkline.module.css`
- Create: `web/src/components/Sparkline/Sparkline.test.tsx`
- Create: `web/src/tiles/NumericTile.tsx`
- Create: `web/src/tiles/NumericTile.module.css`
- Create: `web/src/tiles/SparklineTile.tsx`
- Create: `web/src/tiles/SparklineTile.module.css`
- Create: `web/src/tiles/ZoneBadgeTile.tsx`
- Create: `web/src/tiles/ZoneBadgeTile.module.css`
- Create: `web/src/tiles/Tile.tsx`
- Create: `web/src/tiles/Tile.test.tsx`

- [ ] **Step 1: Sparkline — failing test**

Create `web/src/components/Sparkline/Sparkline.test.tsx`:

```tsx
import { render } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { Sparkline } from './Sparkline'

describe('Sparkline', () => {
  it('renders an empty state (no path) when points are empty', () => {
    const { container } = render(<Sparkline points={[]} />)
    expect(container.querySelectorAll('path').length).toBe(0)
  })

  it('renders a path when given at least two points', () => {
    const { container } = render(
      <Sparkline
        points={[
          { time_sec: 0, value: 100 },
          { time_sec: 30, value: 200 },
          { time_sec: 60, value: 150 },
        ]}
      />,
    )
    expect(container.querySelectorAll('path').length).toBeGreaterThan(0)
  })

  it('renders a single dot when given exactly one point', () => {
    const { container } = render(
      <Sparkline points={[{ time_sec: 0, value: 100 }]} />,
    )
    // A single point is hard to turn into a line; we draw a small circle.
    expect(container.querySelector('circle')).not.toBeNull()
  })
})
```

- [ ] **Step 2: Sparkline stub**

```tsx
import type { SparklinePoint } from '../../live/reducer'

type Props = { points: SparklinePoint[]; ghost?: number[] }

export function Sparkline(_: Props) {
  return <svg />
}
```

- [ ] **Step 3: Run — must fail**

```bash
cd web && npm test -- Sparkline
```

- [ ] **Step 4: Implement Sparkline**

Create the CSS `web/src/components/Sparkline/Sparkline.module.css`:

```css
.svg {
  width: 100%;
  height: 100%;
  display: block;
}

.line {
  fill: none;
  stroke: var(--color-primary);
  stroke-width: 2;
  stroke-linejoin: round;
  stroke-linecap: round;
}

.ghost {
  fill: none;
  stroke: var(--color-on-surface-variant);
  stroke-width: 1;
  stroke-dasharray: 2 3;
}

.dot {
  fill: var(--color-primary);
}
```

Replace `web/src/components/Sparkline/Sparkline.tsx`:

```tsx
import type { SparklinePoint } from '../../live/reducer'
import styles from './Sparkline.module.css'

type Props = {
  points: SparklinePoint[]
  /** Optional ghost line at a constant y — used for session-average. */
  ghost?: number
}

const WIDTH = 100
const HEIGHT = 40

export function Sparkline({ points, ghost }: Props) {
  if (points.length === 0) {
    return <svg className={styles.svg} viewBox={`0 0 ${WIDTH} ${HEIGHT}`} />
  }

  const xs = points.map((p) => p.time_sec)
  const ys = points.map((p) => p.value)
  const xMin = xs[0]
  const xMax = xs[xs.length - 1]
  const xSpan = Math.max(1, xMax - xMin)
  const yMin = Math.min(...ys, ghost ?? ys[0])
  const yMax = Math.max(...ys, ghost ?? ys[0])
  const ySpan = Math.max(1, yMax - yMin)

  const toX = (t: number) => ((t - xMin) / xSpan) * WIDTH
  const toY = (v: number) => HEIGHT - ((v - yMin) / ySpan) * HEIGHT

  if (points.length === 1) {
    return (
      <svg className={styles.svg} viewBox={`0 0 ${WIDTH} ${HEIGHT}`}>
        <circle className={styles.dot} cx={toX(points[0].time_sec)} cy={toY(points[0].value)} r={2} />
      </svg>
    )
  }

  const path = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${toX(p.time_sec).toFixed(2)} ${toY(p.value).toFixed(2)}`)
    .join(' ')

  const ghostPath =
    ghost !== undefined ? `M 0 ${toY(ghost).toFixed(2)} L ${WIDTH} ${toY(ghost).toFixed(2)}` : null

  return (
    <svg className={styles.svg} viewBox={`0 0 ${WIDTH} ${HEIGHT}`} preserveAspectRatio="none">
      {ghostPath && <path className={styles.ghost} d={ghostPath} />}
      <path className={styles.line} d={path} />
    </svg>
  )
}
```

- [ ] **Step 5: Run — must pass**

```bash
cd web && npm test -- Sparkline
```

- [ ] **Step 6: Write tile components**

Create `web/src/tiles/NumericTile.module.css`:

```css
.tile {
  display: flex;
  flex-direction: column;
  gap: var(--space-0-5);
  padding: var(--space-2);
  background: var(--color-surface-container);
  border-radius: var(--radius-card);
  min-height: 96px;
}

.label {
  color: var(--color-on-surface-variant);
}

.row {
  display: flex;
  align-items: baseline;
  gap: var(--space-1);
}

.value {
  font-family: var(--font-display);
  font-size: 28px;
  line-height: 1.1;
  font-weight: 500;
  color: var(--color-on-surface);
}

.unit {
  font-family: var(--font-display);
  font-size: var(--text-title-md);
  color: var(--color-on-surface-variant);
}

.disabled {
  opacity: 0.6;
}
```

Create `web/src/tiles/NumericTile.tsx`:

```tsx
import { selectNumeric } from './selectors'
import type { TileDef } from './registry'
import type { LiveState } from '../live/reducer'
import styles from './NumericTile.module.css'

type Props = { def: TileDef; state: LiveState; disabled?: boolean }

export function NumericTile({ def, state, disabled }: Props) {
  const v = selectNumeric(state, def.id)
  const unit = v.unit ?? def.unit
  const cls = [styles.tile, disabled && styles.disabled].filter(Boolean).join(' ')
  return (
    <div className={cls}>
      <span className={`label-sm ${styles.label}`}>{def.label}</span>
      <div className={styles.row}>
        <span className={`${styles.value} tnum`}>{v.value}</span>
        {unit && <span className={styles.unit}>{unit}</span>}
      </div>
    </div>
  )
}
```

Create `web/src/tiles/SparklineTile.module.css`:

```css
.tile {
  display: grid;
  grid-template-rows: auto 1fr;
  gap: var(--space-1);
  padding: var(--space-2);
  background: var(--color-surface-container);
  border-radius: var(--radius-card);
  min-height: 96px;
}

.label {
  color: var(--color-on-surface-variant);
}

.canvas {
  height: 56px;
}

.disabled {
  opacity: 0.6;
}
```

Create `web/src/tiles/SparklineTile.tsx`:

```tsx
import { selectSparkline } from './selectors'
import type { TileDef } from './registry'
import type { LiveState } from '../live/reducer'
import { Sparkline } from '../components/Sparkline/Sparkline'
import styles from './SparklineTile.module.css'

type Props = { def: TileDef; state: LiveState; disabled?: boolean }

export function SparklineTile({ def, state, disabled }: Props) {
  const { points } = selectSparkline(state, def.id)
  const cls = [styles.tile, disabled && styles.disabled].filter(Boolean).join(' ')
  return (
    <div className={cls}>
      <span className={`label-sm ${styles.label}`}>{def.label}</span>
      <div className={styles.canvas}>
        <Sparkline points={points} />
      </div>
    </div>
  )
}
```

Create `web/src/tiles/ZoneBadgeTile.module.css`:

```css
.tile {
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  padding: var(--space-2);
  background: var(--color-surface-container);
  border-radius: var(--radius-card);
  min-height: 96px;
}

.label {
  color: var(--color-on-surface-variant);
}

.badge {
  margin-top: var(--space-1);
  align-self: flex-start;
  padding: var(--space-0-5) var(--space-1);
  border: 1px solid var(--color-primary);
  color: var(--color-primary);
  border-radius: var(--radius-button);
  font-family: var(--font-display);
  font-size: var(--text-title-md);
}

.empty {
  color: var(--color-on-surface-variant);
  font-family: var(--font-body);
  font-size: var(--text-body-lg);
}

.disabled {
  opacity: 0.6;
}
```

Create `web/src/tiles/ZoneBadgeTile.tsx`:

```tsx
import { selectZone } from './selectors'
import type { TileDef } from './registry'
import type { LiveState } from '../live/reducer'
import styles from './ZoneBadgeTile.module.css'

type Props = { def: TileDef; state: LiveState; disabled?: boolean }

export function ZoneBadgeTile({ def, state, disabled }: Props) {
  const { zone } = selectZone(state, def.id)
  const cls = [styles.tile, disabled && styles.disabled].filter(Boolean).join(' ')
  return (
    <div className={cls}>
      <span className={`label-sm ${styles.label}`}>{def.label}</span>
      {zone ? (
        <span className={styles.badge}>{zone}</span>
      ) : (
        <span className={styles.empty}>—</span>
      )}
    </div>
  )
}
```

Create `web/src/tiles/Tile.tsx`:

```tsx
import type { LiveState } from '../live/reducer'
import { NumericTile } from './NumericTile'
import { SparklineTile } from './SparklineTile'
import { ZoneBadgeTile } from './ZoneBadgeTile'
import { getTile } from './registry'

type Props = { tileId: string; state: LiveState; disabled?: boolean }

export function Tile({ tileId, state, disabled }: Props) {
  const def = getTile(tileId)
  if (!def) {
    // Unknown tile id in storage — render a disabled placeholder rather
    // than crashing. A future version migrates the stored layout forward.
    return (
      <div style={{ padding: 'var(--space-2)', opacity: 0.6 }} className="label-sm">
        {tileId}
      </div>
    )
  }
  const isDisabled = disabled || def.gated === 'hr'
  switch (def.type) {
    case 'numeric':
      return <NumericTile def={def} state={state} disabled={isDisabled} />
    case 'sparkline':
      return <SparklineTile def={def} state={state} disabled={isDisabled} />
    case 'zone':
      return <ZoneBadgeTile def={def} state={state} disabled={isDisabled} />
  }
}
```

- [ ] **Step 7: Write `Tile.test.tsx`**

```tsx
import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { Tile } from './Tile'
import { initialLiveState, liveReducer, type LiveState } from '../live/reducer'

function stateWithStroke(): LiveState {
  return liveReducer(initialLiveState, {
    type: 'event',
    event: {
      kind: 'stroke',
      id: 1,
      data: {
        session_id: 'S',
        stroke: 1,
        time_sec: 10,
        distance_m: 42,
        spm: 25,
        power_w: 210,
        cal_per_hr: 800,
        level: 3,
        dps: 8.2,
        stroke_cycle_sec: 2.4,
        pace_sec_per_500m: 125,
        energy_joules: 500,
      },
    },
  })
}

describe('Tile', () => {
  it('renders a numeric tile', () => {
    render(<Tile tileId="watt" state={stateWithStroke()} />)
    expect(screen.getByText('Watt')).toBeInTheDocument()
    expect(screen.getByText('210')).toBeInTheDocument()
  })

  it('renders a sparkline tile', () => {
    const { container } = render(<Tile tileId="watt-verlauf" state={stateWithStroke()} />)
    expect(screen.getByText('Watt-Verlauf')).toBeInTheDocument()
    // With a single stroke in the series, Sparkline draws a dot.
    expect(container.querySelector('circle')).not.toBeNull()
  })

  it('HR-gated tile renders in a disabled appearance', () => {
    const { container } = render(<Tile tileId="herzfrequenz" state={stateWithStroke()} />)
    const root = container.firstElementChild as HTMLElement
    expect(root.className).toMatch(/disabled/)
  })

  it('falls back for unknown tile ids', () => {
    render(<Tile tileId="bogus-metric" state={stateWithStroke()} />)
    expect(screen.getByText('bogus-metric')).toBeInTheDocument()
  })
})
```

- [ ] **Step 8: Run — must pass**

```bash
cd web && npm test -- tiles Sparkline
```

Expected: every test passes.

- [ ] **Step 9: Commit**

```bash
git add web/src/components/Sparkline web/src/tiles/NumericTile.tsx web/src/tiles/NumericTile.module.css web/src/tiles/SparklineTile.tsx web/src/tiles/SparklineTile.module.css web/src/tiles/ZoneBadgeTile.tsx web/src/tiles/ZoneBadgeTile.module.css web/src/tiles/Tile.tsx web/src/tiles/Tile.test.tsx
git commit -m "feat(web): tile components (numeric, sparkline, zone) + Sparkline SVG"
```

---

## Task 17: LiveHero + StrokePulse + LivePage shell

**Files:**
- Create: `web/src/pages/LiveHero.tsx`
- Create: `web/src/pages/LiveHero.module.css`
- Create: `web/src/pages/LiveHero.test.tsx`
- Create: `web/src/pages/StrokePulse.tsx`
- Create: `web/src/pages/StrokePulse.module.css`
- Overwrite: `web/src/pages/LivePage.tsx`
- Overwrite: `web/src/pages/LivePage.module.css`

- [ ] **Step 1: LiveHero — failing test**

Create `web/src/pages/LiveHero.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { LiveHero } from './LiveHero'
import { initialLiveState, liveReducer, type LiveState } from '../live/reducer'

function state(): LiveState {
  return liveReducer(initialLiveState, {
    type: 'event',
    event: {
      kind: 'stroke',
      id: 1,
      data: {
        session_id: 'S',
        stroke: 1,
        time_sec: 125.3,
        distance_m: 512,
        spm: 27,
        power_w: 245,
        cal_per_hr: 800,
        level: 3,
        dps: 8.4,
        stroke_cycle_sec: 2.22,
        pace_sec_per_500m: 132,
        energy_joules: 544,
      },
    },
  })
}

describe('LiveHero', () => {
  it('renders split as the dominant value', () => {
    render(<LiveHero state={state()} />)
    expect(screen.getByText('2:12.0')).toBeInTheDocument()
  })

  it('renders Zeit, Distanz, SPM, Watt in the secondary row', () => {
    render(<LiveHero state={state()} />)
    expect(screen.getByText('2:05.3')).toBeInTheDocument() // zeit
    expect(screen.getByText('512')).toBeInTheDocument() // distanz
    expect(screen.getByText('27')).toBeInTheDocument() // spm
    expect(screen.getByText('245')).toBeInTheDocument() // watt
  })

  it('shows waiting state when no stroke has arrived', () => {
    render(<LiveHero state={initialLiveState} />)
    // Hero still renders labels; split shows an em-dash.
    expect(screen.getByText('Split')).toBeInTheDocument()
    // Multiple em-dashes on the screen; just assert at least one:
    expect(screen.getAllByText('—').length).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 2: LiveHero styles**

Create `web/src/pages/LiveHero.module.css`:

```css
.hero {
  display: grid;
  grid-template-rows: auto auto;
  gap: var(--space-2);
  padding: var(--space-3) var(--space-3) var(--space-2);
  background: var(--color-surface-container-low);
  border-radius: var(--radius-card);
}

.split {
  display: flex;
  flex-direction: column;
  gap: var(--space-0-5);
}

.splitLabel {
  color: var(--color-on-surface-variant);
}

.splitRow {
  display: flex;
  align-items: baseline;
  gap: var(--space-2);
}

.splitValue {
  font-family: var(--font-display);
  font-size: var(--text-display-lg);
  line-height: var(--text-display-lg-lh);
  color: var(--color-primary);
  font-weight: 500;
  filter: drop-shadow(var(--stroke-pulse-glow));
}

.splitUnit {
  font-family: var(--font-display);
  font-size: var(--text-title-md);
  color: var(--color-on-surface-variant);
}

.secondary {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: var(--space-2);
}

.secondaryCell {
  display: flex;
  flex-direction: column;
  gap: var(--space-0-5);
}

.secondaryLabel {
  color: var(--color-on-surface-variant);
}

.secondaryValue {
  font-family: var(--font-display);
  font-size: 20px;
  line-height: 1.15;
  color: var(--color-on-surface);
  font-weight: 500;
}

.pulseAnchor {
  display: flex;
  justify-content: flex-end;
}
```

- [ ] **Step 3: LiveHero implementation**

Create `web/src/pages/LiveHero.tsx`:

```tsx
import type { LiveState } from '../live/reducer'
import { fmtInt, fmtMeters, mmss, pace500m } from '../util/format'
import { StrokePulse } from './StrokePulse'
import styles from './LiveHero.module.css'

type Props = { state: LiveState }

export function LiveHero({ state }: Props) {
  const s = state.stroke
  return (
    <section className={styles.hero} aria-label="Live-Daten">
      <div className={styles.split}>
        <div className={styles.pulseAnchor}>
          <StrokePulse state={state} />
        </div>
        <span className={`label-sm ${styles.splitLabel}`}>Split</span>
        <div className={styles.splitRow}>
          <span className={`${styles.splitValue} tnum`}>
            {pace500m(s?.pace_sec_per_500m ?? null)}
          </span>
          <span className={styles.splitUnit}>/ 500m</span>
        </div>
      </div>
      <div className={styles.secondary}>
        <div className={styles.secondaryCell}>
          <span className={`label-sm ${styles.secondaryLabel}`}>Zeit</span>
          <span className={`${styles.secondaryValue} tnum`}>{mmss(s?.time_sec ?? null)}</span>
        </div>
        <div className={styles.secondaryCell}>
          <span className={`label-sm ${styles.secondaryLabel}`}>Distanz</span>
          <span className={`${styles.secondaryValue} tnum`}>{fmtMeters(s?.distance_m ?? null)}</span>
        </div>
        <div className={styles.secondaryCell}>
          <span className={`label-sm ${styles.secondaryLabel}`}>SPM</span>
          <span className={`${styles.secondaryValue} tnum`}>{fmtInt(s?.spm ?? null)}</span>
        </div>
        <div className={styles.secondaryCell}>
          <span className={`label-sm ${styles.secondaryLabel}`}>Watt</span>
          <span className={`${styles.secondaryValue} tnum`}>{fmtInt(s?.power_w ?? null)}</span>
        </div>
      </div>
    </section>
  )
}
```

- [ ] **Step 4: StrokePulse**

Create `web/src/pages/StrokePulse.module.css`:

```css
.pulse {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  color: var(--color-on-surface-variant);
  font-family: var(--font-body);
  font-size: var(--text-label-sm);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.dot {
  width: 10px;
  height: 10px;
  border-radius: 999px;
  background: var(--color-primary);
  opacity: 0.25;
  transition: opacity var(--motion-state) var(--motion-ease);
}

.dotActive {
  opacity: 1;
  filter: drop-shadow(var(--stroke-pulse-glow));
}
```

Create `web/src/pages/StrokePulse.tsx`:

```tsx
import { useEffect, useState } from 'react'
import type { LiveState } from '../live/reducer'
import styles from './StrokePulse.module.css'

type Props = { state: LiveState }

export function StrokePulse({ state }: Props) {
  const [active, setActive] = useState(false)

  useEffect(() => {
    if (!state.lastStrokeReceivedAtMs) return
    setActive(true)
    const t = setTimeout(() => setActive(false), 80)
    return () => clearTimeout(t)
  }, [state.lastStrokeReceivedAtMs])

  const stale =
    state.lastStrokeReceivedAtMs !== null &&
    Date.now() - state.lastStrokeReceivedAtMs > 3000

  const statusLabel = (() => {
    if (state.status === 'open' && state.stroke) return 'Live'
    if (state.status === 'open' && !state.stroke) return 'Wartet auf Ergo'
    if (state.status === 'connecting') return 'Verbindet …'
    if (state.status === 'error') return 'Keine Verbindung'
    return '—'
  })()

  return (
    <span className={styles.pulse} aria-live="polite">
      <span
        className={`${styles.dot} ${active && !stale ? styles.dotActive : ''}`}
        aria-hidden="true"
      />
      {statusLabel}
    </span>
  )
}
```

- [ ] **Step 5: Run LiveHero tests**

```bash
cd web && npm test -- LiveHero
```

Expected: all three pass.

- [ ] **Step 6: Wire into `LivePage`**

We still need the `TileGrid` and `TilePicker` from Task 18 before `LivePage` is complete. For now leave the grid area to a placeholder; Task 18 swaps it in. Update `LivePage.tsx`:

```tsx
import { useLiveSession } from '../live/LiveSessionContext'
import { LiveHero } from './LiveHero'
import styles from './LivePage.module.css'

export function LivePage() {
  const state = useLiveSession()
  return (
    <div className={styles.page}>
      <LiveHero state={state} />
      <div className={styles.gridPlaceholder} aria-label="Tile-Grid kommt in Task 18" />
    </div>
  )
}
```

Overwrite `web/src/pages/LivePage.module.css`:

```css
.page {
  display: grid;
  gap: var(--space-3);
  padding: var(--space-3);
}

.gridPlaceholder {
  min-height: 200px;
  border-radius: var(--radius-card);
  background: var(--color-surface-container-low);
  opacity: 0.4;
}

@media (min-width: 1024px) {
  .page {
    grid-template-columns: 1fr 1fr;
    align-items: start;
  }
}
```

- [ ] **Step 7: Dev-smoke the hero**

Start the dev server and confirm the hero renders at `/` with a greyed-out placeholder below (no backend = all em-dashes; that's correct).

```bash
cd web && npm run dev
```

Kill with Ctrl-C.

- [ ] **Step 8: Commit**

```bash
git add web/src/pages/LiveHero.tsx web/src/pages/LiveHero.module.css web/src/pages/LiveHero.test.tsx web/src/pages/StrokePulse.tsx web/src/pages/StrokePulse.module.css web/src/pages/LivePage.tsx web/src/pages/LivePage.module.css
git commit -m "feat(web): Live view hero block with split-dominant layout + stroke pulse"
```

---

## Task 18: Sheet + TilePicker + TileGrid

**Files:**
- Create: `web/src/components/Sheet/Sheet.tsx`
- Create: `web/src/components/Sheet/Sheet.module.css`
- Create: `web/src/components/Sheet/Sheet.test.tsx`
- Create: `web/src/pages/TileGrid.tsx`
- Create: `web/src/pages/TileGrid.module.css`
- Create: `web/src/pages/TilePicker.tsx`
- Create: `web/src/pages/TilePicker.module.css`
- Create: `web/src/pages/TilePicker.test.tsx`
- Modify: `web/src/pages/LivePage.tsx`
- Modify: `web/src/pages/LivePage.module.css`

- [ ] **Step 1: Sheet — failing test**

Create `web/src/components/Sheet/Sheet.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import { Sheet } from './Sheet'

describe('Sheet', () => {
  it('renders when open', () => {
    render(
      <Sheet open onClose={() => {}} title="Beispiel">
        <p>Inhalt</p>
      </Sheet>,
    )
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByText('Inhalt')).toBeInTheDocument()
    expect(screen.getByText('Beispiel')).toBeInTheDocument()
  })

  it('does not render when closed', () => {
    render(
      <Sheet open={false} onClose={() => {}} title="x">
        <p>Inhalt</p>
      </Sheet>,
    )
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('calls onClose when backdrop is clicked', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(
      <Sheet open onClose={onClose} title="x">
        <p>Inhalt</p>
      </Sheet>,
    )
    await user.click(screen.getByTestId('sheet-backdrop'))
    expect(onClose).toHaveBeenCalled()
  })

  it('calls onClose when Escape is pressed', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(
      <Sheet open onClose={onClose} title="x">
        <p>Inhalt</p>
      </Sheet>,
    )
    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Sheet styles**

Create `web/src/components/Sheet/Sheet.module.css`:

```css
.backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(12px);
  display: flex;
  align-items: flex-end;
  justify-content: center;
  z-index: 1000;
}

.sheet {
  background: var(--color-surface-container);
  color: var(--color-on-surface);
  width: 100%;
  max-width: 640px;
  max-height: 85dvh;
  overflow-y: auto;
  border-top-left-radius: var(--radius-card);
  border-top-right-radius: var(--radius-card);
  padding: var(--space-3);
  animation: slideUp var(--motion-view) var(--motion-ease);
}

@media (min-width: 768px) {
  .backdrop {
    align-items: center;
  }
  .sheet {
    border-radius: var(--radius-card);
    max-height: 80dvh;
  }
}

.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: var(--space-2);
}

.title {
  font-family: var(--font-display);
  font-size: var(--text-headline-sm);
  color: var(--color-on-surface);
  margin: 0;
}

.close {
  color: var(--color-on-surface-variant);
  padding: var(--space-1);
}

@keyframes slideUp {
  from {
    transform: translateY(24px);
    opacity: 0;
  }
  to {
    transform: translateY(0);
    opacity: 1;
  }
}

@media (prefers-reduced-motion: reduce) {
  .sheet {
    animation: none;
  }
}
```

- [ ] **Step 3: Sheet implementation**

Create `web/src/components/Sheet/Sheet.tsx`:

```tsx
import { useEffect, type ReactNode } from 'react'
import { IconClose } from '../../icons'
import styles from './Sheet.module.css'

type Props = {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
}

export function Sheet({ open, onClose, title, children }: Props) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      className={styles.backdrop}
      data-testid="sheet-backdrop"
      onClick={onClose}
      role="presentation"
    >
      <div
        className={styles.sheet}
        role="dialog"
        aria-modal="true"
        aria-labelledby="sheet-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className={styles.header}>
          <h2 id="sheet-title" className={styles.title}>
            {title}
          </h2>
          <button className={styles.close} onClick={onClose} aria-label="Schließen">
            <IconClose />
          </button>
        </header>
        {children}
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run Sheet tests — must pass**

```bash
cd web && npm test -- Sheet
```

- [ ] **Step 5: TilePicker**

Create `web/src/pages/TilePicker.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import { TilePicker } from './TilePicker'
import { initialLiveState } from '../live/reducer'

describe('TilePicker', () => {
  it('renders every known tile as an entry', () => {
    render(
      <TilePicker
        open
        slotIndex={0}
        currentTileId="split-verlauf"
        state={initialLiveState}
        onSelect={vi.fn()}
        onClose={vi.fn()}
      />,
    )
    // Spot-check a few entries across types:
    expect(screen.getByText('Split')).toBeInTheDocument()
    expect(screen.getByText('DPS')).toBeInTheDocument()
    expect(screen.getByText('Watt-Verlauf')).toBeInTheDocument()
    expect(screen.getByText('HF-Zone')).toBeInTheDocument()
  })

  it('fires onSelect with the chosen tile id', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    render(
      <TilePicker
        open
        slotIndex={2}
        currentTileId="oe-split"
        state={initialLiveState}
        onSelect={onSelect}
        onClose={vi.fn()}
      />,
    )
    await user.click(screen.getByRole('button', { name: /^DPS/ }))
    expect(onSelect).toHaveBeenCalledWith(2, 'dps')
  })

  it('HR-gated tiles are disabled buttons', () => {
    render(
      <TilePicker
        open
        slotIndex={0}
        currentTileId="split"
        state={initialLiveState}
        onSelect={vi.fn()}
        onClose={vi.fn()}
      />,
    )
    const hf = screen.getByRole('button', { name: /^Herzfrequenz/ })
    expect(hf).toBeDisabled()
  })
})
```

Create `web/src/pages/TilePicker.module.css`:

```css
.currentBanner {
  padding: var(--space-2);
  background: var(--color-surface-container-low);
  border-radius: var(--radius-card);
  margin-bottom: var(--space-2);
  color: var(--color-on-surface-variant);
}

.list {
  display: grid;
  gap: var(--space-1);
}

.entry {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: var(--space-2);
  padding: var(--space-2);
  background: var(--color-surface-container-high);
  border-radius: var(--radius-card);
  text-align: left;
  color: var(--color-on-surface);
  transition: background-color var(--motion-state) var(--motion-ease);
}

.entry:hover:not(:disabled) {
  background: var(--color-surface-container-highest);
}

.entry:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.entryMain {
  display: flex;
  flex-direction: column;
  gap: var(--space-0-5);
}

.entryLabel {
  font-family: var(--font-display);
  font-size: var(--text-title-md);
  color: var(--color-on-surface);
}

.entrySubtitle {
  font-family: var(--font-body);
  font-size: var(--text-label-sm);
  color: var(--color-on-surface-variant);
  text-transform: none;
  letter-spacing: 0;
}

.entryType {
  align-self: center;
  font-family: var(--font-body);
  font-size: var(--text-label-sm);
  color: var(--color-on-surface-variant);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}
```

Create `web/src/pages/TilePicker.tsx`:

```tsx
import { Sheet } from '../components/Sheet/Sheet'
import { TILES, getTile } from '../tiles/registry'
import type { LiveState } from '../live/reducer'
import styles from './TilePicker.module.css'

type Props = {
  open: boolean
  slotIndex: number
  currentTileId: string
  state: LiveState
  onSelect: (slotIndex: number, tileId: string) => void
  onClose: () => void
}

const TYPE_LABEL: Record<string, string> = {
  numeric: 'Zahl',
  sparkline: 'Verlauf',
  zone: 'Bewertung',
}

export function TilePicker({ open, slotIndex, currentTileId, state: _state, onSelect, onClose }: Props) {
  const current = getTile(currentTileId)
  // Order: numeric → sparkline → zone, within each type in registry order.
  const typeOrder = ['numeric', 'sparkline', 'zone'] as const
  const ordered = typeOrder.flatMap((t) => TILES.filter((tile) => tile.type === t))

  return (
    <Sheet open={open} onClose={onClose} title="Metrik wählen">
      {current && (
        <div className={styles.currentBanner}>
          <span className="label-sm">Aktuelle Auswahl</span>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--text-title-md)' }}>
            {current.label}
          </div>
        </div>
      )}
      <div className={styles.list}>
        {ordered.map((tile) => {
          const disabled = tile.gated === 'hr'
          return (
            <button
              key={tile.id}
              className={styles.entry}
              disabled={disabled}
              onClick={() => {
                onSelect(slotIndex, tile.id)
                onClose()
              }}
              aria-label={`${tile.label}${disabled ? ' (nicht verfügbar)' : ''}`}
            >
              <div className={styles.entryMain}>
                <span className={styles.entryLabel}>{tile.label}</span>
                {tile.subtitle && <span className={styles.entrySubtitle}>{tile.subtitle}</span>}
              </div>
              <span className={styles.entryType}>{TYPE_LABEL[tile.type]}</span>
            </button>
          )
        })}
      </div>
    </Sheet>
  )
}
```

- [ ] **Step 6: Run TilePicker tests — must pass**

```bash
cd web && npm test -- TilePicker
```

- [ ] **Step 7: TileGrid**

Create `web/src/pages/TileGrid.module.css`:

```css
.grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  grid-template-rows: repeat(2, 1fr);
  gap: var(--space-2);
}

.slot {
  position: relative;
  cursor: pointer;
}

.slot[data-locked='true'] {
  cursor: not-allowed;
}

.lockHint {
  position: absolute;
  inset: 0;
  display: none;
  align-items: center;
  justify-content: center;
  background: rgba(19, 19, 19, 0.85);
  color: var(--color-on-surface-variant);
  border-radius: var(--radius-card);
  font-family: var(--font-body);
  font-size: var(--text-label-sm);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  padding: var(--space-2);
  text-align: center;
}

.slot[data-show-lock='true'] .lockHint {
  display: flex;
}

@media (min-width: 1024px) {
  .grid {
    grid-template-columns: repeat(3, 1fr);
    grid-template-rows: repeat(3, 1fr);
  }
}
```

Create `web/src/pages/TileGrid.tsx`:

```tsx
import { useCallback, useEffect, useRef, useState } from 'react'
import { Tile } from '../tiles/Tile'
import { DEFAULT_LAYOUT, loadLayout, replaceSlot, saveLayout, type TileLayout } from '../tiles/layout'
import { TilePicker } from './TilePicker'
import type { LiveState } from '../live/reducer'
import styles from './TileGrid.module.css'

const LONG_PRESS_MS = 450

type Props = { state: LiveState }

export function TileGrid({ state }: Props) {
  const [layout, setLayout] = useState<TileLayout>(() => loadLayout())
  const [pickerFor, setPickerFor] = useState<number | null>(null)
  const [lockedHintFor, setLockedHintFor] = useState<number | null>(null)
  const timersRef = useRef<number[]>([])

  const sessionActive = state.session !== null && state.summary === null

  useEffect(() => {
    saveLayout(layout)
  }, [layout])

  const armPress = useCallback(
    (slotIndex: number) => {
      // Long-press: only open the picker between sessions; otherwise show
      // the "edit locked" hint for 1.5 s and don't open the picker.
      const t = window.setTimeout(() => {
        if (sessionActive) {
          setLockedHintFor(slotIndex)
          const hide = window.setTimeout(() => setLockedHintFor(null), 1500)
          timersRef.current.push(hide)
        } else {
          setPickerFor(slotIndex)
        }
      }, LONG_PRESS_MS)
      timersRef.current.push(t)
    },
    [sessionActive],
  )

  const cancelPress = useCallback(() => {
    for (const t of timersRef.current) window.clearTimeout(t)
    timersRef.current = []
  }, [])

  const onSelect = (slotIndex: number, tileId: string) => {
    setLayout((prev) => replaceSlot(prev, slotIndex, tileId))
  }

  const resolvedLayout = layout.length === 6 ? layout : ([...DEFAULT_LAYOUT] as TileLayout)

  return (
    <>
      <div className={styles.grid}>
        {resolvedLayout.map((tileId, i) => (
          <div
            key={i}
            className={styles.slot}
            data-locked={sessionActive}
            data-show-lock={lockedHintFor === i}
            onPointerDown={() => armPress(i)}
            onPointerUp={cancelPress}
            onPointerLeave={cancelPress}
            onPointerCancel={cancelPress}
          >
            <Tile tileId={tileId} state={state} />
            <span className={styles.lockHint}>Nur zwischen Sessions editierbar</span>
          </div>
        ))}
      </div>
      {pickerFor !== null && (
        <TilePicker
          open
          slotIndex={pickerFor}
          currentTileId={resolvedLayout[pickerFor]}
          state={state}
          onSelect={onSelect}
          onClose={() => setPickerFor(null)}
        />
      )}
    </>
  )
}
```

- [ ] **Step 8: Wire TileGrid into LivePage**

Replace `web/src/pages/LivePage.tsx`:

```tsx
import { useLiveSession } from '../live/LiveSessionContext'
import { LiveHero } from './LiveHero'
import { TileGrid } from './TileGrid'
import styles from './LivePage.module.css'

export function LivePage() {
  const state = useLiveSession()
  return (
    <div className={styles.page}>
      <LiveHero state={state} />
      <TileGrid state={state} />
    </div>
  )
}
```

Remove the placeholder rule from `LivePage.module.css` — it now reads:

```css
.page {
  display: grid;
  gap: var(--space-3);
  padding: var(--space-3);
}

@media (min-width: 1024px) {
  .page {
    grid-template-columns: 1fr 1fr;
    align-items: start;
  }
}
```

- [ ] **Step 9: Run everything**

```bash
cd web && npm test && npm run typecheck && npm run build
```

Expected: all green.

- [ ] **Step 10: Dev-smoke the picker**

```bash
cd web && npm run dev
```

- Visit `http://localhost:5173/`.
- Long-press (mouse down + hold ~500 ms) on any tile — picker opens.
- Tap a numeric entry — picker closes and the tile swaps.
- Reload the page — the layout persists.
- Tap an HR-gated entry (Herzfrequenz, HF-Verlauf, HF-Zone) — stays disabled.
- Kill with Ctrl-C.

- [ ] **Step 11: Commit**

```bash
git add web/src/components/Sheet web/src/pages/TilePicker.tsx web/src/pages/TilePicker.module.css web/src/pages/TilePicker.test.tsx web/src/pages/TileGrid.tsx web/src/pages/TileGrid.module.css web/src/pages/LivePage.tsx web/src/pages/LivePage.module.css
git commit -m "feat(web): customisable 2×3 tile grid with long-press picker"
```

---

## Task 19: Playwright visual-regression smoke

**Files:**
- Create: `web/playwright.config.ts`
- Create: `web/tests/e2e/live-view.spec.ts`

A small smoke: the dev server renders the live view at `xs` (360), `md` (768), `xl` (1440) without crashing, with key labels in German, at both dark and light themes. Screenshots are captured on the first run as baselines; subsequent runs compare.

- [ ] **Step 1: Write `playwright.config.ts`**

Create `web/playwright.config.ts`:

```ts
import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
})
```

- [ ] **Step 2: Write the smoke**

Create `web/tests/e2e/live-view.spec.ts`:

```ts
import { test, expect } from '@playwright/test'

const VIEWPORTS = [
  { name: 'xs', width: 360, height: 640 },
  { name: 'md', width: 768, height: 1024 },
  { name: 'xl', width: 1440, height: 900 },
]

for (const vp of VIEWPORTS) {
  test(`live view renders at ${vp.name}`, async ({ page }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height })
    await page.goto('/')

    await expect(page.getByText('Split')).toBeVisible()
    await expect(page.getByText('Zeit')).toBeVisible()
    await expect(page.getByText('Distanz')).toBeVisible()
    await expect(page.getByText('SPM')).toBeVisible()
    await expect(page.getByText('Watt')).toBeVisible()

    // Bottom nav targets.
    await expect(page.getByRole('link', { name: /^Live/ })).toBeVisible()
    await expect(page.getByRole('link', { name: /^Historie/ })).toBeVisible()
    await expect(page.getByRole('link', { name: /^Profil/ })).toBeVisible()

    await expect(page).toHaveScreenshot(`live-${vp.name}.png`, {
      maxDiffPixelRatio: 0.02,
    })
  })
}

test('theme switcher flips html[data-theme]', async ({ page }) => {
  await page.goto('/profil')
  await page.getByRole('button', { name: 'Hell' }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  await page.getByRole('button', { name: 'Dunkel' }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
})
```

- [ ] **Step 3: Generate baseline screenshots**

```bash
cd web && npx playwright test --update-snapshots
```

Expected: the three live-view tests produce `live-xs.png`, `live-md.png`, `live-xl.png` under `tests/e2e/live-view.spec.ts-snapshots/`. The theme test passes without a screenshot.

- [ ] **Step 4: Verify on rerun**

```bash
cd web && npm run e2e
```

Expected: all four tests pass.

- [ ] **Step 5: Commit**

```bash
git add web/playwright.config.ts web/tests/e2e
git commit -m "test(web): Playwright live-view smoke + visual regression baseline"
```

---

## Task 20: Polish pass — final test + docs

**Files:**
- Modify: `web/README.md`
- Modify: `ROADMAP.md` (repo root, if present)

- [ ] **Step 1: Run the full verification chain**

```bash
cd web && npm run typecheck && npm run lint && npm test && npm run build && npm run e2e
```

Expected: every step green. If any fail, fix before proceeding — don't defer.

- [ ] **Step 2: Update `web/README.md`**

Open `web/README.md` and, under whatever "Scripts" or "Development" section it has, add the new commands. At minimum append:

```markdown
## Testing

- `npm test` — unit tests (vitest, jsdom)
- `npm run test:watch` — vitest in watch mode
- `npm run e2e` — Playwright smoke (starts dev server automatically)
- `npm run e2e -- --update-snapshots` — refresh visual baselines after intentional UI changes

## Architecture (M2 UI foundation)

- **Design tokens** in `src/styles/tokens.css` (dark + light). Components reference `var(--token)`; never hard-code values.
- **Theme resolution**: inline script in `index.html` sets `data-theme` before React mounts. `useTheme` (src/theme/) persists overrides to `localStorage`.
- **Live-data plumbing**:
  - `src/live/events.ts` — SSE wire types.
  - `src/live/channel.ts` — `Channel` abstraction. `EventSourceChannel` is production; `MockChannel` is the test seam.
  - `src/live/reducer.ts` — pure reducer. 60 s sparkline window.
  - `LiveSessionProvider` wires a channel to the reducer and exposes state via `useLiveSession`.
- **Tiles**: `src/tiles/registry.ts` is the canonical catalogue. `selectors.ts` maps state → display values. `layout.ts` persists the 6-slot layout.
- **Pages** in `src/pages/`: `LivePage` composes `LiveHero` + `TileGrid`. `TilePicker` is a `Sheet` with all registry entries as buttons.
```

- [ ] **Step 3: Update the roadmap (if it exists)**

If `ROADMAP.md` at the repo root exists and has M-labelled milestones, add a bullet under M2 noting "UI foundation + Live View shipped (plan docs/plans/2026-04-20-ui-foundation-and-live-view.md)". Skip this step if there's no such file.

- [ ] **Step 4: Commit**

```bash
git add web/README.md ROADMAP.md
git commit -m "docs(web): document M2 UI foundation architecture"
```

---

## Self-Review Notes

Checks performed before publishing this plan:

- **Spec coverage:**
  - FEAT-0008: tokens (Task 2), typography (Task 3), theme resolution (Task 4–5), icons (Task 6), Button + MetricCard primitives (Tasks 7–8), responsive layout (Tasks 14, 17, 18), Playwright visual regression (Task 19). Acceptance criteria "no 1px dividers", "12px radius cap", "tabular numerals", "no FOUC", "prefers-reduced-motion" all honoured in CSS. Fonts self-hosted via `@fontsource-variable`, precached via the existing `vite-plugin-pwa` config.
  - FEAT-0001: hero block with split-dominant 72px display, secondary row Zeit/Distanz/SPM/Watt, stroke-pulse, waiting state — Task 17.
  - FEAT-0001a: 2×3 tile grid (Task 18), long-press picker, edit-lock during sessions, HR-gating, layout persistence (Task 15). Open questions resolved inline (flat list picker, auto-fit sparkline, hero keeps updating).
  - INT-0002: full wire-type model (Task 10), `EventSourceChannel` with `Last-Event-ID` resume (Task 11), reducer handles every event kind (Task 12).
  - FEAT-0007: tile selectors honour SPI edge cases from the catalogue; the picker draws from the registry, not a hardcoded list.

- **Placeholder scan:** No `TBD`, `TODO`, or "similar to Task N" phrases in task bodies. Every code block is complete. `HistoryPage` and `ProfilePage` render placeholder prose but are not plan placeholders — they are real components that the user sees and that the follow-up plans replace.

- **Type consistency:**
  - `LiveState` fields (`status`, `session`, `stroke`, `summary`, `sparklines`, `lastStrokeReceivedAtMs`) used identically across reducer, selectors, context, and pages.
  - `TileDef` fields consistent between registry, `Tile`, `NumericTile`/`SparklineTile`/`ZoneBadgeTile`, and `TilePicker`.
  - `Channel` interface — `subscribe`, `close` — consistent across `MockChannel`, `EventSourceChannel`, `useEventSource`, and `LiveSessionProvider`.
  - `TileLayout` is a tuple of six strings throughout.

- **One scope decision worth flagging:** This plan does not wire the backend SSE endpoint. If `npm run dev` is run without the Go backend, the live view shows em-dashes everywhere — which is the spec-correct "waiting for ergo" state. To see real data, run the backend's M1 fixture mode (`HOMEERGO_FIXTURE=… go run ./cmd/homeergo`) alongside; but since the backend's M1 plan explicitly didn't ship `/api/v1/stream` yet, the frontend-only smoke on an empty stream is the *actual* acceptance surface of this plan. Integration goes in the M3 plan that wires both.

- **Deferred to follow-up plans:**
  - FEAT-0003 + FEAT-0003a (history / trends) — needs a sessions API plan first; drafting that is the natural next step.
  - FEAT-0002 (QR pairing, rower switching) — needs ADR-0005 authentication fully specced.
  - FEAT-0004 (full profile screen, PB grid, weekly chart) — the theme switcher scaffolding is here; the visual surface is a follow-up.
  - FEAT-0005, FEAT-0005a — workout builder is a substantial vertical slice; own plan.
  - FEAT-0006 offline data cache — current SW caches the app shell only; a separate plan adds the IndexedDB + last-50-sessions LRU.
  - HR ingestion (INT-0001 open question on `[24:25]`). HR-gated tiles already appear disabled in the picker; enabling them is a one-line flip in the registry once the backend exposes HR.
