# ROADMAP

## M0 — Protocol verification

- [x] Physically connect Mac to IPM via micro-USB
- [x] Identify device node, bridge chip, USB IDs — FTDI FT232R,
      VID:PID `0403:6001`, `/dev/cu.usbserial-<serial>` on macOS
- [x] Capture rowing sessions (five fixtures under
      `specs/int/fixtures/ipm/`, including a >1000 m session and a
      level-change session)
- [x] Verify or correct INT-0001 against observed wire format — six of
      nine fields in the live-data (A8) message verified, reference
      parser at `traces/ipm_parser.py`
- [ ] Remaining A8 fields: `[10:13]` marker, `[13:16]` 3-digit unknown,
      `[24:25]` single-digit footer byte. Pin down with more captures
      (idle-timeout, heart-rate belt, cold-boot handshake)
- [ ] Decide: does firmware support BLE FTMS via Fluid Connect upgrade?
      (ADR-0007, alternative path to the serial protocol)

## M1 — Walking skeleton

- [x] ADR-0003 accepted: **Go backend + React (Vite, TS) frontend**, SQLite via modernc, single embedded binary
- [x] Repo layout scaffolded (`backend/`, `web/`, `scripts/backend.sh`)
- [x] Go port of the IPM parser from `traces/ipm_parser.py` under `backend/internal/ipm/`, with table-driven tests against the CSV fixtures
- [x] Backend reads serial, prints parsed strokes to stdout
- [x] Minimal HTTP `/api/health` endpoint
- [x] Vite+React skeleton boots as a PWA, shows placeholder, dev-proxies `/api/*` to the Go backend

## M2 — Live view

- [x] WebSocket (or SSE) pushes parsed frames to browser
- [x] FEAT-0001: distance, time, split, SPM, watts rendered (HR deferred)
- [x] Runs on dev Mac end-to-end
- [x] UI foundation + Live View shipped (plan `docs/plans/2026-04-20-ui-foundation-and-live-view.md`)

## M3 — Persistence & users

- [x] FEAT-0002 (minimal slice): rower profiles, device-cookie active-rower, top-bar switcher (plan `docs/superpowers/plans/2026-04-21-m3-rower-profiles-minimal.md`). Full QR pairing + admin deferred.
- [x] FEAT-0003: sessions written to SQLite, idle-timeout boundary detection (plan `docs/plans/2026-04-21-m3-backend-sse-persistence.md`) — write path only; history read UI deferred
- [x] History read API + list/detail UI shipped (plan `docs/plans/2026-04-21-history-read-ui.md`) — hard-delete canonical (FEAT-0009 superseded soft-delete 2026-05-02); filter chips, trends sub-tab, exports deferred
- [x] Session assigned to the currently "active" user in UI

## M4 — History & statistics

- [x] FEAT-0003: session list + detail view shipped (charts deferred — chart library not picked)
- [x] FEAT-0004: per-user PBs computed via `on_session_change`; lifetime totals; trends API + Trends tab; new-PB overlay (FEAT-0004 PBOverlay shipped 2026-05-01). Profil page UI (PB grid, weekly bar chart, theme switcher) deferred past v1.
- [ ] FEAT-0003 charts: pick chart library + integrate session-detail line charts
- [ ] FEAT-0003 export: CSV minimum (FIT/TCX stretch)
- [ ] FEAT-0004 Profil page: 2×3 PB grid, "Diese Woche" bar chart, theme switcher

## M5 — Goals

- [ ] FEAT-0005: set and track training goals

## M6 — Deploy to Pi

- [x] Cross-compile / containerise for the chosen target Pi (`deploy/build.sh`, ARMv7 default)
- [x] Caddy + TLS (ADR-0006) — `deploy/Caddyfile.template` (DuckDNS DNS-01)
- [x] systemd units and install script — `deploy/splits.service` + `deploy/install.sh`
- [x] Daily SQLite backup — `deploy/splits-backup.{sh,service,timer}`

## M7 — Polish

- [ ] PWA installability verified on iOS Safari and Android Chrome
- [ ] Offline shell works after first load
- [ ] Light/dark theme, big-digit live view optimised for phone next to ergo
