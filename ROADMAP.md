# ROADMAP

Last reconciled against the repo, specs and issue tracker on 2026-10-20.
Boxes are ticked only when the code is on `main`; a pointer names the spec,
plan or file that is the evidence.

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
- [x] Remaining A8 fields resolved — the 2026-05-24 cross-check against
      `fdf-console-monitor` showed the original decode split adjacent
      fields at the wrong boundary. Re-aligned, every A8 position is
      accounted for; INT-0001 status is **Verified**. One byte (`[10]`)
      is a constant `1` on firmware V115 with no published meaning.
- [ ] Decide: does firmware support BLE FTMS via Fluid Connect upgrade?
      Never decided. The serial path shipped and works, so this is moot
      unless a second transport is wanted. ADR-0007 was reused for the
      event-ingestion pipeline; a BLE decision would need a new ADR.

## M1 — Walking skeleton

- [x] ADR-0003 accepted: **Go backend + React (Vite, TS) frontend**, SQLite via modernc, single embedded binary
- [x] Repo layout scaffolded (`backend/`, `web/`, `scripts/backend.sh`)
- [x] Go port of the IPM parser from `traces/ipm_parser.py` under `backend/internal/ipm/`, with table-driven tests against the CSV fixtures
- [x] Backend reads serial, prints parsed strokes to stdout
- [x] Minimal HTTP `/api/health` endpoint
- [x] Vite+React skeleton boots as a PWA, shows placeholder, dev-proxies `/api/*` to the Go backend

## M2 — Live view

- [x] WebSocket (or SSE) pushes parsed frames to browser (SSE, INT-0002; lossless ingestion per ADR-0007)
- [x] FEAT-0001: distance, time, split, SPM, watts rendered (HR deferred)
- [x] Runs on dev Mac end-to-end
- [x] UI foundation + Live View shipped (plan `docs/plans/2026-04-20-ui-foundation-and-live-view.md`)
- [x] FEAT-0001a customizable tile dashboard, FEAT-0001b smoothing and
      dead-reckoning, FEAT-0007 rowing-metrics catalogue — all shipped
      beyond the original M2 scope

## M3 — Persistence & users

- [x] FEAT-0002: rower profiles, device-cookie active-rower, top-bar switcher (plan `docs/superpowers/plans/2026-04-21-m3-rower-profiles-minimal.md`)
- [x] FEAT-0002 QR pairing flow shipped 2026-04-28 (`PairPage`, `OnboardingPage`). Admin tier removed per ADR-0005 subsequent decisions; the admin household screen is the one piece still deferred.
- [x] FEAT-0003: sessions written to SQLite, idle-timeout boundary detection (plan `docs/plans/2026-04-21-m3-backend-sse-persistence.md`)
- [x] History read API + list/detail UI shipped (plan `docs/plans/2026-04-21-history-read-ui.md`) — hard-delete canonical (FEAT-0009 superseded soft-delete 2026-05-02)
- [x] Session assigned to the currently "active" user in UI

## M4 — History & statistics

- [x] FEAT-0003: session list + detail view shipped
- [x] FEAT-0003 charts: split, watt, SPM and DPS line charts on the
      session detail page (`web/src/components/charts/SessionChart.tsx`,
      hand-rolled SVG, no chart library; `tests/e2e/session-charts.spec.ts`)
- [x] FEAT-0004: per-user PBs computed via `on_session_change`; lifetime totals; trends API + Trends tab; new-PB overlay (PBOverlay shipped 2026-05-01)
- [x] FEAT-0004 Profil page: theme switcher shipped
      (`web/src/pages/profile/ThemeSwitcher.tsx`). The PB grid and the
      "Diese Woche" chart were **not** built on the Profil page; FEAT-0004
      reassigned them to the History → Rekorde and Trends tabs, where they
      live now.
- [x] FEAT-0003a trends: range tabs, group-by-workout-intent (ADR-0015),
      touch-native scrubber (ADR-0016)
- [x] FEAT-0010 achievements & personal bests
- [ ] FEAT-0003 export: CSV minimum (FIT/TCX stretch). **Not started** —
      no export code in backend or web.

## M5 — Goals

- [ ] FEAT-0005: set and track training goals. Still **Draft**, deferred
      past v1. Per-session targets are covered by FEAT-0005a
      (workout-selection builder/library, shipped); long-horizon goals
      ("50 km this month") are not.

## M6 — Deploy to Pi

- [x] Cross-compile for the target Pi (`deploy/build.sh`; `TARGET=armv6|arm|arm64|amd64`, `arm` = ARMv7 default; the household Pi is ARMv6)
- [x] Caddy + TLS (ADR-0006) — `deploy/Caddyfile.template` (DuckDNS DNS-01)
- [x] systemd units and install script — `deploy/splits.service` + `deploy/install.sh`
- [x] Daily SQLite backup — `deploy/splits-backup.{sh,service,timer}`
- [x] CI + downloadable release packages — `.github/workflows/{ci,release}.yml`, `deploy/bundle.sh` (ADR-0022); first tagged releases v0.1.0–v0.2.0 on 2026-10-19/20
- [x] Unattended OTA updates on the Pi — FEAT-0016 / ADR-0023, `deploy/splits-update.*`

## M7 — Polish

- [x] Light/dark theme, big-digit live view optimised for phone next to
      ergo — FEAT-0008 visual design system (shipped), theme switcher
      (`useTheme`, `data-theme`, no-flash pre-mount)
- [x] Offline shell works after first load — ADR-0018 → ADR-0021: durable
      service-worker cache, uncached reachability probe, local-first boot.
      Covered by the `offline-preview` Playwright project in CI.
- [ ] PWA installability verified on iOS Safari and Android Chrome.
      FEAT-0006 is marked **Shipped** and `docs/v1-review.md` records an
      iOS install + offline test, but the spec's install acceptance boxes
      (Android Chrome prompt, iOS standalone display, desktop install) were
      never ticked. Needs a device pass and the spec updated, not new code.

## M8 — Post-v1 (shipped, never planned here)

Work that landed between 2026-05 and 2026-10 without a roadmap home.
Listed so the roadmap matches `main`.

- [x] FEAT-0009 session cleanup & data retention; ADR-0008 derived-stats architecture (2026-05-02)
- [x] FEAT-0013 race mode: dedicated live view, ghost/PB leader, start ceremony (2026-05-07; ADR-0009, ADR-0012, ADR-0013). Supersedes FEAT-0012.
- [x] Session lifecycle, phase-aware UX, pause/resume, windowed live split — ADR-0010, ADR-0011 (accepted 2026-05-10); `web/src/pages/live/`, `backend/internal/stats/window.go`, `tests/e2e/pause-resume.spec.ts`. The FEAT-0015 checklist was never ticked and still reads "Ready-for-agent"; reconcile the spec.
- [x] Deterministic replay harness as a CI seam — ADR-0017, golden-stream tests
- [x] Per-slice E2E gate with vision-LLM critique — ADR-0014, `e2e-critic` agent
- [x] FEAT-0014 race-mode cleanup: Bereit screen, finish overlay shipped (`web/src/race/`); spec still **Draft** with its checklist unticked — reconcile.
- [ ] FEAT-0011 session insights — analysis window, drift detection, consistency; ~26 commits on `main`, spec still **Draft**. Open epics #36 (insights v1.1), #37 (analysis window).

## M9 — Current work

Tracked as GitHub issues; this list is a pointer, not the source of truth.

- [ ] Epic #41 Historie/Verlauf navigation and legibility — #48, #49, #50 ready-for-agent (design: `docs/superpowers/specs/2026-06-11-historie-optimization-design.md`)
- [ ] Epic #36 Session insights v1.1 — robust detectors, readable charts, efficiency drift
- [ ] Epic #37 Analysis window — exclude start-up and post-goal strokes
- [ ] #46 Export the 11.06.2026 5000 m session as an insights fixture
- [ ] CSV export (M4) and training goals (M5) remain the two v1 items with no code

## Deferred / out of scope

- Admin household screen (FEAT-0002)
- Heart-rate display (FEAT-0001; belt payload shape unverified in INT-0001)
- FIT/TCX export
- BLE FTMS transport (M0)
- Cloud sync, social features, public leaderboards (per AGENTS.md)
