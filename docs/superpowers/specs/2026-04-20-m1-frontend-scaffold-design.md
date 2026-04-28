# M1 Frontend Scaffold — Design

**Status:** Approved for planning
**Date:** 2026-04-20
**Roadmap item:** M1 — "Vite+React skeleton boots as a PWA, shows placeholder, dev-proxies `/api/*` to the Go backend"

## Goal

Scaffold a minimal Vite + React + TypeScript PWA under `web/` that boots locally via `npm run dev`, installs as a PWA (manifest + service worker), and proxies `/api/*` to the Go backend on `:8080`. Closes the last open M1 checkbox; live-view rendering and design-system work are explicitly deferred to later milestones.

## Scope

**In scope:**
- Vite `react-ts` project at `web/`
- `vite-plugin-pwa` with auto-update service worker, manifest, 192/512 icons (placeholder PNGs)
- Dev proxy `/api/*` → `http://localhost:8080`
- Placeholder page with a small health indicator that polls `/api/health` on mount to prove the proxy works end-to-end
- ESLint (Vite default) + Prettier config; npm scripts for `dev`, `build`, `preview`, `lint`, `format`, `typecheck`
- `.gitignore` additions for `node_modules`, `dist`

**Out of scope:**
- React Router (single page)
- State management library
- SSE/WebSocket client (M2)
- Styled live view with stroke metrics (FEAT-0001, M2)
- Design system, theming, fonts (FEAT-0008)
- Final icons / branding
- Pre-commit hooks
- CI workflow
- Top-level build orchestration across `backend/` and `web/`

## Stack decisions

| Decision | Choice | Rationale |
|---|---|---|
| Directory | `web/` | Per ROADMAP; parallel to `backend/` |
| Package manager | `npm` | User preference (see memory) |
| Template | Vite `react-ts` | Standard, maintained, TS-first |
| PWA plugin | `vite-plugin-pwa` | De facto standard, generates manifest + SW |
| SW strategy | `registerType: 'autoUpdate'` | No prompt; new SW activates on next load |
| Dev SW | `devOptions.enabled: true` | So PWA can be validated during dev |
| Styling | Plain CSS for placeholder | Design system lands with FEAT-0008 |
| Router | None | One page; add when M2 introduces `/live` |
| Lint/format | ESLint + Prettier | Vite default + standard Prettier |

## Directory layout

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
├── public/
│   ├── favicon.svg
│   ├── pwa-192.png
│   └── pwa-512.png
└── src/
    ├── main.tsx
    ├── App.tsx
    ├── App.css
    └── vite-env.d.ts
```

## Key configuration

**`vite.config.ts`:**
- Plugins: `@vitejs/plugin-react`, `vite-plugin-pwa` (`registerType: 'autoUpdate'`, `devOptions.enabled: true`, manifest inline)
- `server.proxy['/api']` → `http://localhost:8080`, `changeOrigin: true`

**Manifest:**
```json
{
  "name": "Home Ergo",
  "short_name": "Ergo",
  "description": "Home rowing ergometer companion",
  "theme_color": "#000000",
  "background_color": "#000000",
  "display": "standalone",
  "start_url": "/",
  "icons": [
    { "src": "/pwa-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/pwa-512.png", "sizes": "512x512", "type": "image/png" }
  ]
}
```
Theme/color values are placeholders — FEAT-0008 will revisit.

**`package.json` scripts:**
- `dev` → `vite`
- `build` → `tsc -b && vite build`
- `preview` → `vite preview`
- `lint` → `eslint .`
- `format` → `prettier --write .`
- `typecheck` → `tsc -b --noEmit`

## Placeholder page

`App.tsx` renders:
- `<h1>Home Ergo</h1>`
- Subtitle: "Backend status"
- A small indicator component that fires one `fetch('/api/health')` on mount. Displays:
  - While pending: "checking…"
  - On `{ status: "ok" }`: green dot + "backend: ok"
  - On any non-2xx or network error: red dot + "backend: unreachable"

Minimal CSS (~30 lines) in `App.css`. No polling loop — a one-shot check is enough to validate the proxy.

## Verification

1. `cd web && npm install && npm run dev` — Vite dev server on `http://localhost:5173` renders the placeholder.
2. With `homeergo` running (`cd backend && go run ./cmd/splits` with a fixture env set): health indicator shows "backend: ok".
3. With backend stopped: indicator shows "backend: unreachable".
4. `npm run typecheck` passes.
5. `npm run lint` passes.
6. `npm run build` completes; `dist/` contains hashed assets, `manifest.webmanifest`, `sw.js`.
7. `npm run preview`: DevTools → Application shows installed manifest, active service worker, registered cache.
8. Chrome Lighthouse PWA audit: installability checks pass.

## Risks / open questions

- **Icon assets:** Placeholder PNGs are fine for M1 but need to be real before shipping. Tracked for FEAT-0008.
- **SW caching strategy:** `autoUpdate` with default Workbox precache is appropriate while the app is tiny. May need tuning once the live view and history screens exist.
- **Dev SW gotchas:** Enabling the SW in dev occasionally surprises devs with stale caches. Documented in the README snippet added to `web/`.

## Implementation plan

Produced separately via the `writing-plans` skill under `docs/plans/2026-04-20-m1-frontend-scaffold.md`.
