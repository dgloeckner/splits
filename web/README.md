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

## PWA notes

The service worker is registered in dev as well as prod (`devOptions.enabled: true` in
`vite.config.ts`). If you see stale assets after editing, hard-reload or unregister the
worker from DevTools → Application → Service Workers. To validate installability, run
`npm run preview` and use Chrome's Lighthouse PWA audit.

Icons under `public/pwa-*.png` are placeholders; real branding lands with FEAT-0008.
