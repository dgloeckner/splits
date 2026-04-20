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
