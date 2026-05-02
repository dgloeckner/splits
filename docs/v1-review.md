# v1 Review — Findings & Priority List

Date: 2026-04-27
Branch: feat/rekorde-tab

---

## P0 — Blockers for v1

### Security & auth boundaries

- **Active-rower SET unauthenticated** — `backend/internal/api/rowers.go:81-107`. Any device can set any rower active. Verify `device_rowers` row before SET.
- **Sessions list leaks across rowers** — `backend/internal/api/sessions.go:26-41`. Missing `rower_id` returns all sessions for device. Default to active rower or 400.
- **No HTTPS enforcement** — backend listens plain HTTP on `:8080` (`config.go:32`). ADR-0005 fragment tokens require TLS. Add startup check: refuse plain HTTP unless `SPLITS_DEV_MODE=1`.
- **No CSP / security headers** — no `X-Frame-Options`, `X-Content-Type-Options`, HSTS, CSP. Add middleware.
- **No rate limiting** — no middleware on any endpoint. Add token-bucket on auth-relevant routes minimum.
- **Cookie missing `Secure` flag** — `device_cookie.go:33-37`. HttpOnly + SameSite Lax present, but no Secure. Set when not in dev mode.

### Data correctness

- **Soft-delete vs in-flight session race** — `sessions.go:125-166`. Deleting active session leaves orphan strokes. Block delete on active session or add status guard.
- **Sessionizer mutable fields unlocked** — `session/sessionizer.go:49,61`. `pendingWorkoutID` + `currentSessionStart` raced. Guard with existing `mu`.
- **Persister silent retry forever** — `storage/persister.go:46-67`. Permanent DB failure stalls pipeline silently. Bounded retry + dead-letter + CRITICAL log.
- **Inconsistent 404 vs 500** — `sessions.go:48-55`, `pbs.go:128-136`. Use `errors.Is(err, sql.ErrNoRows)` everywhere.

### Brand: `homeergo` → `splits`

Backend not renamed. Env-var contract still old.

- Module path `github.com/gloeckner-daniel/home-ergo` → `splits` (`backend/go.mod:1`)
- Binary dir `backend/cmd/homeergo/` → `backend/cmd/splits/`
- Env vars (`backend/internal/config/config.go:32-47`):
  - `HOMEERGO_ADDR` → `SPLITS_ADDR`
  - `HOMEERGO_SERIAL_PORT` → `SPLITS_SERIAL_PORT`
  - `HOMEERGO_SERIAL_BAUD` → `SPLITS_SERIAL_BAUD`
  - `HOMEERGO_DB_PATH` → `SPLITS_DB_PATH`
  - `HOMEERGO_FIXTURE` → `SPLITS_FIXTURE`
  - `HOMEERGO_FIXTURE_RATE` → `SPLITS_FIXTURE_RATE`
  - `HOMEERGO_LOG_LEVEL` → `SPLITS_LOG_LEVEL`
  - `HOMEERGO_IDLE_TIMEOUT` → `SPLITS_IDLE_TIMEOUT`
- Default DB path `./homeergo.db` → `./splits.db`
- Log prefixes `homeergo.start|exit|resume` (`cmd/homeergo/main.go:32,43`) → `splits.*`
- Docs to update: `backend/README.md:1-49`, `web/README.md:9`, `specs/arch/0001-backend-pipeline.md:227-440`, `docs/plans/*.md` (5 files), e2e specs (`web/tests/e2e/*.spec.ts` — temp dir prefixes + spawn paths), `.claude/settings.local.json:16,18` (pkill filters).
- Web localStorage keys keep `home-ergo:*` prefix (decision recorded 2026-04-28). Migrating means writing a one-shot reader of legacy keys; low value vs. cost. Revisit when a user-visible reset becomes acceptable; out of scope for v1.

### v1 features missing

- **FEAT-0002 QR pairing** — exchange endpoint missing, scan UI missing, token revocation missing, admin household screen 0%. Without this multi-user security guarantee fails.
- **FEAT-0003 session-detail charts** — no chart lib in web/. Acceptance criterion unmet.
- **Stats recompute sync on delete** — `204` returns before scheduler bumps version. Block until done or expose version header.

---

## P1 — High priority

### PWA robustness

- **No app-level SSE reconnect backoff** — `web/src/live/channel.ts:60-142`. Relies on browser default. Add explicit backoff + stale-detection (no message > 30s → force reconnect).
- **EventSource permanent failure not surfaced** — `LiveSessionContext.tsx`. Show "Verbindung verloren" overlay + retry button.
- **Service worker no offline shell** — `web/vite.config.ts:16-22`. `/api/*` is `NetworkOnly`, no offline fallback page. Add minimal offline shell route.
- **No localStorage cleanup / size bounds** — 3 keys (`home-ergo:tile-layout:v2`, `:theme`, `:last-event-id`). `last-event-id` grows monotonic forever. Tile layout has no schema-version eviction. Add bounded write + version migration.
- **TanStack Query no `networkMode`** — defaults to online-only (`main.tsx:19`). With PWA, set `networkMode: 'offlineFirst'` for read endpoints.
- **No client SW cache for static history endpoints** — read-only `/api/v1/sessions` could be `StaleWhileRevalidate`.
- **Backend SSE ring-buffer size undocumented** — verify `replay window > 20s ping interval × N` to survive Wi-Fi blip.

### Security

- **No CORS policy** — relies on same-origin. Document + lock down explicitly with `Access-Control-Allow-Origin: <self>`.
- **No request body size limit** — JSON endpoints accept unbounded body. Add `http.MaxBytesReader`.
- **Input bounds on `POST /rowers`** — `rowers.go:24-29`. Name length, weight 0-300, DOB sane range.
- **Device cookie 10-year MaxAge with no rotation** — `device_cookie.go`. Add rotation hook on suspicious activity (out-of-scope for v1, document as known limit).
- **PII in logs review** — currently clean per audit, but add lint/test that asserts rower-name/email never enter slog payload.

### Code quality

- `expandSamples` length mismatch silent — `sessions.go:91-120`. Assert + warn.
- `mustAtoi` panic in IPM parser — fuzz with garbage frames, ensure recover at producer level.
- Mixed `http.Error(w,…,500)` vs `http.StatusInternalServerError`. Standardize on constants.
- TS `strict: true` not enforced. Replace `as any` mocks (`useSegmentTransitions.test.tsx`).
- Migrations lack header comments / FEAT refs (`backend/internal/storage/migrations/*.sql`).
- Stale TODO `web/src/pages/workout/intensityRanges.ts:7` — PB-driven defaults: PBs shipped, replace.
- Stale skipped E2E `web/tests/e2e/live-view.spec.ts` — re-capture or delete.
- Redundant `qc.invalidateQueries(['sessions'])` in `LivePage.tsx:114` since 0f48ba4.

### Tests

- E2E suite stale/skipped. Restore + re-capture snapshots.
- No SSE latency SLO test (FEAT-0001 ≤1s acceptance unverified). Add load test, target p99 ≤ 800ms.
- No soft-delete → PB-invalidation integration test.
- No persister retry / eventual-consistency test.
- No concurrent SSE stress test (multiple clients, drop policy).
- No IPM parser fuzz on malformed hex.
- No PWA offline test.

---

## P2 — Should have for v1

### Features

- **FEAT-0003 export CSV/FIT/TCX** — 0%. CSV minimum for v1.
- ~~**FEAT-0003 7-day soft-delete cleanup job**~~ — superseded by FEAT-0009 (immediate hard delete, no Papierkorb). Dead `SoftDeleteSession` helper + `deleted_at` filters removed 2026-05-02.
- **FEAT-0003 history date-range filter UI** — missing.
- **FEAT-0004 New-PB notification overlay** — API present, UI incomplete.
- **FEAT-0004 theme switcher location** — settings UI unclear.
- **FEAT-0010 achievements context in session detail** — banner API present, overlay missing.
- **FEAT-0007 Rekorde tab PB grid completion** — verify against spec.

### M6 deploy infra

- ARM cross-compile (Pi Zero 2W target, ARMv8). Add npm script or shell script (no Makefile per memory).
- Caddy reverse-proxy config (TLS via internal CA per ADR-0006).
- systemd unit + install script.
- Daily SQLite backup cron (sqlite3 .backup).
- Health-check endpoint hardening.

### M7 polish

- iOS Safari install + offline test documented.
- Offline shell complete.

---

## P3 — Defer past v1

- **FEAT-0005 Goals** — schema, API, UI all 0%. Bounded scope, ship after v1 cut.
- Device cookie rotation / suspicious-activity hooks.
- Token revocation tooling for QR pairs (basic invalidation OK for v1; rotation/audit log later).
- Multi-arch cross-compile (only Pi Zero 2W needed for v1).

---

## Suggested ship order

1. **P0 security & data correctness** — auth boundaries, race fixes, persister retry bound, error codes.
2. **P0 brand rename** — single sweep, `HOMEERGO_*` → `SPLITS_*`, module path, log prefixes, docs. Coordinate with deploy plan to avoid double-config.
3. **P0 FEAT-0002 QR pairing exchange endpoint + scan UI**.
4. **P0 FEAT-0003 session-detail charts**.
5. **P0 stats recompute sync on delete**.
6. **P1 PWA reconnect/offline polish**.
7. **P1 security headers + rate limit + body size**.
8. **P1 test restoration** — E2E + SSE SLO + integration coverage.
9. **P2 M6 deploy infra**.
10. **P2 remaining feature gaps** (export, achievements overlay, PB notifications).
11. **P3 Goals & beyond** — post-v1.
