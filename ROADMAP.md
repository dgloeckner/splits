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
- [ ] Repo layout scaffolded (`backend/`, `web/`, shared `Makefile`)
- [ ] Go port of the IPM parser from `traces/ipm_parser.py` under `backend/internal/ipm/`, with table-driven tests against the CSV fixtures
- [ ] Backend reads serial, prints parsed strokes to stdout
- [ ] Minimal HTTP `/api/health` endpoint
- [x] Vite+React skeleton boots as a PWA, shows placeholder, dev-proxies `/api/*` to the Go backend

## M2 — Live view

- [ ] WebSocket (or SSE) pushes parsed frames to browser
- [ ] FEAT-0001: distance, time, split, SPM, watts, HR rendered
- [ ] Runs on dev Mac end-to-end
- [x] UI foundation + Live View shipped (plan `docs/plans/2026-04-20-ui-foundation-and-live-view.md`)

## M3 — Persistence & users

- [ ] FEAT-0002: user profiles + shared-password login
- [ ] FEAT-0003: sessions written to SQLite, idle-timeout boundary detection
- [ ] Session assigned to the currently "active" user in UI

## M4 — History & statistics

- [ ] FEAT-0003: session list, detail view with charts
- [ ] FEAT-0004: per-user PBs (500 / 1000 / 2000 / 5000 / 6000 / 10000 m),
      totals, weekly trends

## M5 — Goals

- [ ] FEAT-0005: set and track training goals

## M6 — Deploy to Pi

- [ ] Cross-compile / containerise for the chosen target Pi
- [ ] Caddy + TLS (ADR-0006)
- [ ] systemd units and install script
- [ ] Daily SQLite backup

## M7 — Polish

- [ ] PWA installability verified on iOS Safari and Android Chrome
- [ ] Offline shell works after first load
- [ ] Light/dark theme, big-digit live view optimised for phone next to ergo
