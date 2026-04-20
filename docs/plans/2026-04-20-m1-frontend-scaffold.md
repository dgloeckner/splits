# M1 Frontend Scaffold Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Scaffold a Vite + React + TypeScript PWA under `web/` that boots on `npm run dev`, dev-proxies `/api/*` to the Go backend on `:8080`, ships a manifest + service worker via `vite-plugin-pwa`, and renders a placeholder page that pings `/api/health` to prove the proxy works end-to-end.

**Architecture:** Single npm project at `web/`, sibling to `backend/`. Vite dev server on port 5173 proxies `/api/*` to `localhost:8080`. `vite-plugin-pwa` runs in `autoUpdate` mode, generates the manifest and service worker at build time, and is enabled in dev so the PWA surface can be validated locally. The placeholder `App` component fires one `fetch('/api/health')` on mount and renders a colored dot indicating backend reachability. No router, no state library, no SSE — those land with M2.

**Tech Stack:** Node 20+, npm (not pnpm), Vite 5, React 18, TypeScript 5, `@vitejs/plugin-react`, `vite-plugin-pwa`, ESLint (Vite default flat config), Prettier 3.

**Spec reference:** [`docs/superpowers/specs/2026-04-20-m1-frontend-scaffold-design.md`](../superpowers/specs/2026-04-20-m1-frontend-scaffold-design.md)

---

## File Structure

All paths relative to repo root.

```
web/
├── .gitignore
├── .prettierrc
├── eslint.config.js
├── index.html
├── package.json
├── package-lock.json
├── tsconfig.json
├── tsconfig.node.json
├── vite.config.ts
├── README.md
├── public/
│   ├── favicon.svg
│   ├── pwa-192.png
│   └── pwa-512.png
└── src/
    ├── main.tsx
    ├── App.tsx
    ├── App.css
    ├── HealthIndicator.tsx
    └── vite-env.d.ts
```

**Responsibilities:**
- `vite.config.ts` — plugins, dev server, `/api` proxy, PWA manifest
- `src/main.tsx` — React root mount + SW registration side effect from `vite-plugin-pwa`
- `src/App.tsx` — top-level layout, renders `HealthIndicator`
- `src/HealthIndicator.tsx` — one-shot `/api/health` fetch, renders pending / ok / unreachable
- `src/App.css` — minimal styling for the placeholder
- `README.md` — how to run, how to test, dev-SW gotchas

---

## Task 1: Scaffold the Vite project

**Files:**
- Create: `web/` directory tree via Vite's scaffolder
- Delete: Vite template files we don't need (see Step 3)

- [ ] **Step 1: Scaffold the project**

Run from the repo root:

```bash
npm create vite@latest web -- --template react-ts
```

Expected: Vite creates `web/` with `package.json`, `index.html`, `src/`, `tsconfig*.json`, `vite.config.ts`, `eslint.config.js`, `public/vite.svg`, `src/App.tsx`, `src/main.tsx`, `src/App.css`, `src/index.css`, `src/assets/react.svg`.

- [ ] **Step 2: Install dependencies**

```bash
cd web && npm install
```

Expected: `node_modules/` and `package-lock.json` created. Output ends with package count.

- [ ] **Step 3: Delete Vite's demo assets**

From `web/`:

```bash
rm -f public/vite.svg src/assets/react.svg src/index.css
rmdir src/assets
```

We will replace `App.tsx` and `App.css` in later tasks rather than deleting them. `index.css` is removed because we only need `App.css` for the placeholder.

- [ ] **Step 4: Verify the scaffold still builds**

From `web/`:

```bash
npm run build
```

Expected: fails — `main.tsx` still imports `./index.css` and uses the removed react.svg. That's addressed in Task 2.

- [ ] **Step 5: Do not commit yet**

The scaffold is broken mid-task by design; Task 2 brings it back to green before the first commit.

---

## Task 2: Trim the template to a bare placeholder

**Files:**
- Modify: `web/src/main.tsx`
- Modify: `web/src/App.tsx`
- Modify: `web/src/App.css`
- Modify: `web/index.html`

- [ ] **Step 1: Overwrite `web/src/main.tsx`**

```tsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import './App.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
```

- [ ] **Step 2: Overwrite `web/src/App.tsx`**

```tsx
export default function App() {
  return (
    <main className="placeholder">
      <h1>Home Ergo</h1>
      <p className="subtitle">Backend status coming soon.</p>
    </main>
  )
}
```

- [ ] **Step 3: Overwrite `web/src/App.css`**

```css
:root {
  color-scheme: dark;
}

body {
  margin: 0;
  font-family: system-ui, -apple-system, 'Segoe UI', sans-serif;
  background: #0b0b0b;
  color: #f2f2f2;
}

.placeholder {
  min-height: 100dvh;
  display: grid;
  place-content: center;
  text-align: center;
  padding: 2rem;
}

.placeholder h1 {
  margin: 0 0 0.5rem;
  font-size: 2.5rem;
  letter-spacing: -0.02em;
}

.subtitle {
  margin: 0;
  opacity: 0.7;
}
```

- [ ] **Step 4: Update `web/index.html`**

Replace the `<title>` and remove the Vite favicon reference. The full file should read:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
    <meta name="theme-color" content="#000000" />
    <title>Home Ergo</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 5: Verify build and typecheck pass**

From `web/`:

```bash
npm run build
```

Expected: TypeScript compiles, Vite emits `dist/` with `index.html` and hashed JS/CSS assets. No errors.

- [ ] **Step 6: Start the dev server and confirm the placeholder renders**

```bash
npm run dev
```

Expected: Vite prints `Local: http://localhost:5173/`. Open it — you see "Home Ergo" and "Backend status coming soon." on a dark background. `Ctrl-C` to stop.

- [ ] **Step 7: Add `web/.gitignore`**

Vite's scaffolder already creates `web/.gitignore`. Open it and confirm it contains at least `node_modules`, `dist`, and `*.local`. If `dist` is missing, add it. If any line is missing, make the file read:

```
node_modules
dist
dist-ssr
*.local
.DS_Store
.vite
```

- [ ] **Step 8: Commit**

From the repo root:

```bash
git add web/
git commit -m "feat(web): scaffold Vite + React + TS project"
```

---

## Task 3: Configure the dev proxy for `/api/*`

**Files:**
- Modify: `web/vite.config.ts`

- [ ] **Step 1: Overwrite `web/vite.config.ts`**

```ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:8080',
        changeOrigin: true,
      },
    },
  },
})
```

- [ ] **Step 2: Verify the proxy works end-to-end**

In one terminal, start the backend with a long fixture so it stays alive:

```bash
cd backend && HOMEERGO_FIXTURE=../specs/int/fixtures/ipm/session-m3-long.csv go run ./cmd/homeergo
```

In another, start the dev server:

```bash
cd web && npm run dev
```

In a third, curl through the Vite proxy:

```bash
curl -sS http://localhost:5173/api/health
```

Expected: `{"status":"ok"}`. Stop both servers.

- [ ] **Step 3: Commit**

```bash
git add web/vite.config.ts
git commit -m "feat(web): proxy /api/* to the Go backend in dev"
```

---

## Task 4: Add the `HealthIndicator` component

**Files:**
- Create: `web/src/HealthIndicator.tsx`
- Modify: `web/src/App.tsx`
- Modify: `web/src/App.css`

This component fires one `fetch('/api/health')` on mount. We test end-to-end against the running backend in the next task rather than adding a mocked unit test — the whole point is to validate the proxy is wired up, and a unit test that mocks `fetch` would not prove that.

- [ ] **Step 1: Create `web/src/HealthIndicator.tsx`**

```tsx
import { useEffect, useState } from 'react'

type Status = 'pending' | 'ok' | 'unreachable'

export default function HealthIndicator() {
  const [status, setStatus] = useState<Status>('pending')

  useEffect(() => {
    let cancelled = false

    fetch('/api/health')
      .then((r) => {
        if (!r.ok) throw new Error(`status ${r.status}`)
        return r.json() as Promise<{ status: string }>
      })
      .then((body) => {
        if (cancelled) return
        setStatus(body.status === 'ok' ? 'ok' : 'unreachable')
      })
      .catch(() => {
        if (cancelled) return
        setStatus('unreachable')
      })

    return () => {
      cancelled = true
    }
  }, [])

  const label =
    status === 'pending'
      ? 'checking…'
      : status === 'ok'
        ? 'backend: ok'
        : 'backend: unreachable'

  return (
    <div className={`health health--${status}`} role="status" aria-live="polite">
      <span className="health__dot" aria-hidden />
      <span className="health__label">{label}</span>
    </div>
  )
}
```

- [ ] **Step 2: Render it from `App.tsx`**

Overwrite `web/src/App.tsx`:

```tsx
import HealthIndicator from './HealthIndicator'

export default function App() {
  return (
    <main className="placeholder">
      <h1>Home Ergo</h1>
      <HealthIndicator />
    </main>
  )
}
```

- [ ] **Step 3: Append styles to `web/src/App.css`**

Add at the end of the file:

```css
.health {
  margin-top: 1.25rem;
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.95rem;
  opacity: 0.85;
}

.health__dot {
  width: 0.625rem;
  height: 0.625rem;
  border-radius: 50%;
  background: #888;
}

.health--ok .health__dot {
  background: #3ddc84;
}

.health--unreachable .health__dot {
  background: #e5484d;
}

.health--pending .health__dot {
  background: #888;
  animation: health-pulse 1s ease-in-out infinite alternate;
}

@keyframes health-pulse {
  from { opacity: 0.4; }
  to   { opacity: 1; }
}
```

- [ ] **Step 4: Verify the component renders three states**

Start only the dev server (backend stopped):

```bash
cd web && npm run dev
```

Open `http://localhost:5173/`. Expected: "checking…" flashes briefly, then "backend: unreachable" with a red dot.

Now start the backend in another terminal:

```bash
cd backend && HOMEERGO_FIXTURE=../specs/int/fixtures/ipm/session-m3-long.csv go run ./cmd/homeergo
```

Reload the browser. Expected: "backend: ok" with a green dot.

Stop both servers.

- [ ] **Step 5: Commit**

```bash
git add web/src/HealthIndicator.tsx web/src/App.tsx web/src/App.css
git commit -m "feat(web): add backend health indicator on placeholder page"
```

---

## Task 5: Add `vite-plugin-pwa`

**Files:**
- Modify: `web/package.json` (via `npm install`)
- Modify: `web/vite.config.ts`
- Modify: `web/src/main.tsx`
- Create: `web/public/favicon.svg`
- Create: `web/public/pwa-192.png`
- Create: `web/public/pwa-512.png`

- [ ] **Step 1: Install the plugin**

From `web/`:

```bash
npm install -D vite-plugin-pwa
```

Expected: `vite-plugin-pwa` added under `devDependencies` in `package.json`; `package-lock.json` updated.

- [ ] **Step 2: Generate placeholder icons**

We need a monochrome placeholder until FEAT-0008 provides real branding. Create `web/public/favicon.svg`:

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect width="64" height="64" rx="12" fill="#0b0b0b"/>
  <text x="50%" y="54%" text-anchor="middle" dominant-baseline="middle"
        font-family="system-ui, sans-serif" font-size="28" font-weight="700"
        fill="#f2f2f2">E</text>
</svg>
```

Generate the two PNG sizes from the SVG. From `web/`:

```bash
npx --yes @resvg/resvg-js-cli@latest public/favicon.svg -w 192 -o public/pwa-192.png
npx --yes @resvg/resvg-js-cli@latest public/favicon.svg -w 512 -o public/pwa-512.png
```

Expected: `public/pwa-192.png` and `public/pwa-512.png` exist. Verify with:

```bash
ls -la public/
```

If `@resvg/resvg-js-cli` is unavailable in your environment, use any tool you have that renders SVG to PNG at 192×192 and 512×512 pixels (e.g. `rsvg-convert -w 192 public/favicon.svg > public/pwa-192.png`). The files must be opaque PNGs.

- [ ] **Step 3: Update `vite.config.ts` to register the plugin**

Overwrite `web/vite.config.ts`:

```ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      devOptions: { enabled: true },
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'Home Ergo',
        short_name: 'Ergo',
        description: 'Home rowing ergometer companion',
        theme_color: '#000000',
        background_color: '#000000',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: '/pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/pwa-512.png', sizes: '512x512', type: 'image/png' },
        ],
      },
    }),
  ],
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:8080',
        changeOrigin: true,
      },
    },
  },
})
```

- [ ] **Step 4: Register the service worker from `main.tsx`**

`vite-plugin-pwa` exposes a virtual module `virtual:pwa-register` that handles registration. We want `autoUpdate`, so no user prompt — importing and calling it is enough.

Overwrite `web/src/main.tsx`:

```tsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import App from './App.tsx'
import './App.css'

registerSW({ immediate: true })

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
```

- [ ] **Step 5: Declare the virtual module type**

TypeScript needs to know about `virtual:pwa-register`. Overwrite `web/src/vite-env.d.ts`:

```ts
/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />
```

- [ ] **Step 6: Typecheck**

From `web/`:

```bash
npm run build
```

Expected: TypeScript compiles, Vite emits `dist/index.html`, `dist/manifest.webmanifest`, `dist/sw.js`, `dist/workbox-*.js`, plus hashed JS/CSS. Confirm with:

```bash
ls dist/
```

You should see `manifest.webmanifest` and `sw.js` among the outputs.

- [ ] **Step 7: Verify the PWA surface in preview**

From `web/`:

```bash
npm run preview
```

Open the printed URL (usually `http://localhost:4173`). In Chrome DevTools → Application:
- **Manifest** tab shows name "Home Ergo", short name "Ergo", the two icons, `display: standalone`.
- **Service Workers** tab shows an active worker for the preview origin.
- Lighthouse → PWA audit → "Installable" checks pass.

Stop the preview server.

- [ ] **Step 8: Verify dev-mode SW registration**

```bash
npm run dev
```

Open `http://localhost:5173/`. DevTools → Application → Service Workers shows an active worker (because `devOptions.enabled: true`). Stop the dev server.

- [ ] **Step 9: Commit**

```bash
git add web/package.json web/package-lock.json web/vite.config.ts web/src/main.tsx web/src/vite-env.d.ts web/public/favicon.svg web/public/pwa-192.png web/public/pwa-512.png
git commit -m "feat(web): register PWA manifest and service worker via vite-plugin-pwa"
```

---

## Task 6: Add Prettier and lint/format/typecheck scripts

**Files:**
- Modify: `web/package.json`
- Create: `web/.prettierrc`
- Create: `web/.prettierignore`

- [ ] **Step 1: Install Prettier**

From `web/`:

```bash
npm install -D prettier
```

- [ ] **Step 2: Create `web/.prettierrc`**

```json
{
  "semi": false,
  "singleQuote": true,
  "trailingComma": "all",
  "printWidth": 100
}
```

- [ ] **Step 3: Create `web/.prettierignore`**

```
dist
node_modules
package-lock.json
dev-dist
```

(`dev-dist` is where `vite-plugin-pwa` writes the dev-mode SW.)

- [ ] **Step 4: Add npm scripts**

Open `web/package.json`. It already has `dev`, `build`, `lint`, `preview`. Change the `"scripts"` object to:

```json
{
  "dev": "vite",
  "build": "tsc -b && vite build",
  "preview": "vite preview",
  "lint": "eslint .",
  "format": "prettier --write .",
  "typecheck": "tsc -b --noEmit"
}
```

(The `build` script is already exactly this in the Vite template — leave it if so. The other three are new or changed.)

- [ ] **Step 5: Format the tree once**

From `web/`:

```bash
npm run format
```

Expected: files reformatted to Prettier style. Review the diff — it should only be whitespace/quoting, no semantic changes.

- [ ] **Step 6: Verify all three scripts pass**

```bash
npm run lint && npm run typecheck && npm run build
```

Expected: all three green. If ESLint reports errors introduced by Prettier's reformat, either fix them or relax the offending rule — do not globally disable. (The Vite default config is usually compatible.)

- [ ] **Step 7: Add `dev-dist` to `.gitignore`**

Append `dev-dist` to `web/.gitignore` if it is not already there.

- [ ] **Step 8: Commit**

```bash
git add web/package.json web/package-lock.json web/.prettierrc web/.prettierignore web/.gitignore web/src web/vite.config.ts web/index.html
git commit -m "feat(web): add Prettier and format/typecheck npm scripts"
```

(The `src`, `vite.config.ts`, and `index.html` paths catch any Prettier reformatting churn.)

---

## Task 7: Write the README and final verification

**Files:**
- Create: `web/README.md`

- [ ] **Step 1: Create `web/README.md`**

```markdown
# web — Home Ergo frontend

Vite + React + TypeScript PWA. Talks to the Go backend in `../backend`.

## Prerequisites

- Node 20 or later
- npm 10 or later
- The backend running on `http://localhost:8080` (see `../backend/README` once written; today: `cd ../backend && go run ./cmd/homeergo` with a fixture env set)

## Develop

```bash
npm install
npm run dev
```

Opens on `http://localhost:5173`. Requests to `/api/*` are proxied to `http://localhost:8080`.

## Build & preview

```bash
npm run build      # type-check + emit dist/
npm run preview    # serve the built bundle locally
```

## Other scripts

- `npm run lint` — ESLint
- `npm run format` — Prettier (writes in place)
- `npm run typecheck` — `tsc -b --noEmit`

## PWA notes

The service worker is registered in dev as well as prod (`devOptions.enabled: true` in
`vite.config.ts`). If you see stale assets after editing, hard-reload or unregister the
worker from DevTools → Application → Service Workers. To validate installability, run
`npm run preview` and use Chrome's Lighthouse PWA audit.

Icons under `public/pwa-*.png` are placeholders; real branding lands with FEAT-0008.
```

- [ ] **Step 2: End-to-end verification**

Start the backend in one terminal:

```bash
cd backend && HOMEERGO_FIXTURE=../specs/int/fixtures/ipm/session-m3-long.csv go run ./cmd/homeergo
```

Run every frontend check from `web/`:

```bash
npm run lint
npm run typecheck
npm run build
npm run preview
```

Open the preview URL. Expected, in order:
- Placeholder page renders on dark background
- Green dot + "backend: ok" appears within ~1 second
- DevTools → Application → Manifest shows "Home Ergo" + both icons
- DevTools → Application → Service Workers shows an active worker
- Lighthouse → PWA: "Installable" group passes

Stop preview. Restart `npm run dev` and repeat the manifest/SW checks on `:5173` to confirm dev mode is equivalent.

Stop everything.

- [ ] **Step 3: Commit**

```bash
git add web/README.md
git commit -m "docs(web): add frontend README"
```

- [ ] **Step 4: Update the roadmap**

Tick the last M1 frontend checkbox. Edit `ROADMAP.md` — change:

```
- [ ] Vite+React skeleton boots as a PWA, shows placeholder, dev-proxies `/api/*` to the Go backend
```

to:

```
- [x] Vite+React skeleton boots as a PWA, shows placeholder, dev-proxies `/api/*` to the Go backend
```

- [ ] **Step 5: Commit the roadmap update**

```bash
git add ROADMAP.md
git commit -m "docs(roadmap): mark M1 frontend scaffold complete"
```

---

## Self-Review Notes

Checks performed before publishing this plan:

- **Spec coverage:** Every scope item in the design doc is covered. Vite `react-ts` (Task 1), trim template + placeholder (Task 2), `/api` dev proxy (Task 3), health indicator (Task 4), `vite-plugin-pwa` with auto-update and dev SW (Task 5), ESLint is the Vite default (already scaffolded in Task 1), Prettier + scripts (Task 6), README (Task 7). Out-of-scope items (router, state lib, SSE, design system, real icons, CI, pre-commit hooks, top-level build orchestration) stay out.
- **Placeholder scan:** No "TBD"/"TODO"/"similar to" references. Every code block is complete. SVG-to-PNG step has a documented fallback if the primary CLI is unavailable.
- **Type consistency:** `HealthIndicator`'s `Status` union drives both state and CSS class names (`health--pending`, `health--ok`, `health--unreachable`); the CSS selectors in Task 4 match exactly. `registerSW` from `virtual:pwa-register` is typed via the `vite-plugin-pwa/client` triple-slash reference added in Task 5.
- **Ordering:** Task 6 (Prettier) runs after Task 5 (PWA config) so the format pass covers all created files in one sweep. The roadmap tick is the final act, keeping it conditional on end-to-end verification.
