# ADR-0003: Tech Stack — Go Backend, React Frontend

- **Status**: Accepted
- **Date**: 2026-04-19

## Context

The project needs a backend language/framework and a frontend framework.
The choice affects deployment story, ARM compatibility, RAM/CPU
footprint, and maintainer productivity.

M0 (protocol verification) gave us enough real information to decide:
- The IPM parser is modest — a clean state machine over CRLF-terminated
  ASCII lines. Any language handles it well.
- Pi Zero 2 W is a realistic deploy target, which rewards a small
  footprint.
- The maintainer is fluent in Go and React; neither needs onboarding
  time.
- "One binary you copy onto the Pi" is a strong pull for non-technical
  household maintenance.

Backend candidates weighed: Go, Python (FastAPI), Kotlin (Ktor),
Node/TypeScript. Frontend candidates: Angular, SvelteKit, Vite+Preact,
vanilla HTML. All were live options; the combination below won across
footprint, cross-compile, and ergonomic fit.

## Decision

- **Backend: Go.**
- **Frontend: React** (with Vite, TypeScript, and a small in-repo
  design system — plain CSS, CSS custom properties, self-hosted custom
  fonts). No Tailwind, no CSS-in-JS, no component library.
- **Persistence: SQLite** via `modernc.org/sqlite` (pure Go, CGO-free).
- **Packaging: single static binary** with the React production bundle
  embedded via `//go:embed`. One binary deploys everywhere.

## Why this combination

- Go wins the footprint, cross-compile, and deploy-story arguments —
  the biggest practical lever for Pi and one-file deploys. Goroutines
  + channels map cleanly to the architecture (serial reader → session
  aggregator → SSE fan-out), which is exactly the shape the rest of
  the specs commit us to.
- React is a well-understood, mainstream choice; the maintainer is
  fluent. With Vite + TypeScript the dev loop is fast and the prod
  bundle is modest. Angular was the strongest alternative; React wins
  here for bundle size and ecosystem fit with lightweight custom
  styling.
- "Small design system" means we avoid framework lock-in on the
  visual side and keep the live view — the app's single most
  performance-sensitive screen — under direct CSS control.
- SQLite + modernc fits the deploy target perfectly: no CGO, no extra
  system packages, cross-compiles to ARM from a Mac in one command.

## Concrete technology choices

### Backend (Go)

| Concern            | Choice                         | Notes |
|--------------------|--------------------------------|-------|
| Module path        | `splits`                       | Local module name; bare path until upstream is published. |
| Go version         | Latest stable (≥ 1.22)         | Uses the new `http.ServeMux` routing & `slog`. |
| Router             | `net/http` stdlib (1.22+)       | Avoid chi/gin unless a real need surfaces. |
| Serial             | `go.bug.st/serial`              | Actively maintained, cross-platform, no CGO on macOS/Linux. |
| SQLite             | `modernc.org/sqlite`            | Pure Go. Alternative `mattn/go-sqlite3` requires CGO — avoid for cross-compile. |
| Query style        | Hand-written SQL + `sqlc`       | Generates typed Go from SQL; keeps migrations transparent. Revisit if schema stays tiny. |
| Migrations         | `golang-migrate/migrate` (file-based)  | Plain `.sql` files, deterministic. |
| Embedding PWA      | `//go:embed web/dist`           | Ships the built React bundle inside the binary. Development serves via Vite; production via `http.FileServerFS`. |
| QR generation      | `github.com/skip2/go-qrcode`    | For ADR-0005 pair QR rendering (SVG preferred). |
| Logging            | `log/slog` (stdlib)             | Structured, level-based, zero deps. |
| Config             | Env vars + sensible defaults    | 12-factor. No YAML unless we outgrow it. |
| Testing            | `testing` stdlib, table-driven  | Golden-file tests against `specs/int/fixtures/ipm/*.csv`. |
| Linting            | `go vet`, `staticcheck`         | In CI. |
| Formatting         | `gofmt`, `goimports`            | Enforced. |

### Frontend (React + Vite)

| Concern            | Choice                                | Notes |
|--------------------|---------------------------------------|-------|
| Build              | Vite                                  | Fast dev, ES-module output, trivial TS. |
| Language           | TypeScript                            | Types on the wire match Go structs via shared conventions (not code-generated in v1). |
| Framework          | React 18+                             | Functional components, hooks, no class components. |
| Routing            | `react-router` or conditional render  | ~5 screens total; decide during M1. Lean toward `react-router` for URL addressability (history, admin, live). |
| State              | Local `useState` + a single Zustand store for cross-screen state | No Redux. No MobX. |
| Data fetching      | `fetch` + a small typed client        | No React Query unless needed. SSE gets a custom hook (`useLiveStream`). |
| SSE client         | Native `EventSource`                  | Built into all target browsers. |
| Charts (history)   | Plain SVG + small helpers             | Or `chart.js` if helpers grow. No D3 unless needed. |
| Styling            | Vanilla CSS + CSS custom properties   | **No** Tailwind, no CSS-in-JS, no CSS modules as a start (re-evaluate if collisions appear). |
| Design tokens      | `src/styles/tokens.css` (variables)   | Colors, spacing, type scale, radii — single source of truth. |
| Fonts              | Self-hosted (no Google Fonts / CDN)   | See FEAT-0008 for family choice + usage. AGENTS.md rule: PWA must work offline after first load. |
| i18n               | Small in-house typed helper           | German domain vocab per `docs/domain-glossary.md`; full i18n later if needed. |
| PWA                | `vite-plugin-pwa` (Workbox-based)     | Manifest + service worker. Precache the shell; never cache SSE / API responses. |
| Testing            | `vitest` + `@testing-library/react`   | Unit + component tests. |
| Linting            | ESLint + `@typescript-eslint`         | Prettier for formatting. |

### Design system (in-repo, no third-party component lib)

The tech stack locks in the **mechanism**:
- Vanilla CSS + CSS custom properties; no Tailwind, no CSS-in-JS, no
  component library.
- Design tokens live in a single `web/src/styles/tokens.css`.
- Typography is self-hosted variable `.woff2` under
  `web/public/fonts/`.
- Icons are inline SVG React components; no icon font, no CDN.
- Components are plain React + scoped class names; no premature
  abstraction.

The **content** of the design system — colour scale, typography
choices, responsive breakpoints, light / dark behaviour, motion rules,
target aesthetic — lives in FEAT-0008 (Visual Design System &
Responsive UX), which is where those decisions are actually made.

### Persistence schema (stub — expanded in a later INT spec)

Initial tables (SQLite, WAL mode):

- `rowers(id, name, is_admin, paired_hash, created_at, deleted_at, profile_json)`
- `sessions(id, rower_id, started_at, ended_at, total_distance_m, total_strokes, ..., summary_json)`
- `strokes(session_id, stroke_no, time_sec, distance_m, spm, power_w, cal_per_hr, level, raw_payload, unknown_fields_json)`

Indexes on `(rower_id, started_at DESC)` and `(session_id, stroke_no)`.
Ring buffer for the live SSE replay (INT-0002) is in-memory; persisted
strokes are the authoritative history.

Formal schema + migrations live in a future INT-0003.

## Repo layout

```
splits/
├── backend/
│   ├── cmd/splits/          # main package (binary entry point)
│   ├── internal/
│   │   ├── ipm/               # A8 parser (port of traces/ipm_parser.py)
│   │   ├── session/           # aggregation + state machine
│   │   ├── stream/            # SSE hub + fan-out
│   │   ├── storage/           # SQLite access + migrations
│   │   ├── auth/              # rower pairing, session cookies
│   │   └── api/               # HTTP handlers
│   ├── migrations/*.sql
│   ├── go.mod / go.sum
│   └── Makefile
├── web/
│   ├── src/
│   │   ├── components/
│   │   ├── views/
│   │   ├── lib/               # sseClient, apiClient, domain types
│   │   ├── styles/            # tokens.css, reset.css, global.css
│   │   └── main.tsx
│   ├── public/
│   │   └── fonts/             # self-hosted woff2 variable fonts
│   ├── index.html
│   ├── vite.config.ts
│   ├── package.json
│   └── tsconfig.json
├── traces/                     # existing probe + analysis scripts
├── specs/                      # existing specs
├── docs/                       # existing docs + visualizations
└── README.md
```

Rationale for `backend/` + `web/` at the root (vs `cmd/` + `web/` at
the top level): keeps the two ecosystems cleanly separated and makes
the `//go:embed web/dist` path obvious.

## Development workflow

- **Backend dev**: `cd backend && go run ./cmd/splits` — serves API
  on `:8080`. Reads fixtures via a CLI flag for offline dev when the
  ergo isn't connected.
- **Frontend dev**: `cd web && pnpm dev` — Vite dev server on `:5173`,
  proxies `/api/*` and `/stream` to `:8080`.
- **Prod build**: `make build` at repo root — builds the React bundle
  into `web/dist`, then `go build` embeds it via `//go:embed` and
  produces a single binary per target arch.
- **Cross-compile**: `GOOS=linux GOARCH=arm64 go build` (Pi Zero 2 W
  and Pi 3/4). `GOARCH=arm GOARM=6` if we ever target the original
  Pi Zero.

## Testing strategy

- **Backend**:
  - Unit: `./internal/ipm` against every row of every captured CSV
    (`specs/int/fixtures/ipm/*.csv`) — deterministic, fast.
  - Integration: in-process with an `io.Reader` feeding a recorded
    fixture, full pipeline to SSE output compared to a golden SSE file.
- **Frontend**:
  - Unit: Tier-2 derivations (speed, pace, DPS) against the same
    fixtures so backend and frontend never disagree.
  - Component: live view renders expected digits for a known event
    sequence.
- **End-to-end**: deferred until after M2.

## Consequences

- The parser already written in Python (`traces/ipm_parser.py`) is a
  **reference implementation**, not production code. The Go port
  re-uses the same CSV fixtures as golden tests.
- ADR-0007 (serial vs BLE FTMS) remains independent of this ADR; a
  Go implementation of either path is equally feasible.
- A bit more typing than Python for data transforms, accepted cost.
- Shipping a single cross-compiled binary to the Pi is the production
  mode; no Node on the Pi at runtime.
