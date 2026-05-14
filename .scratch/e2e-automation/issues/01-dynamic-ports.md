# 0016-01 — Dynamic ports + Playwright env-driven baseURL

Status: ready-for-agent

- **Type**: AFK · Infra
- **Parent**: [PRD-0016](../PRD.md)

## What to build

Remove the hard-coded ports that prevent parallel Playwright runs.
Today the backend binds `127.0.0.1:8080`, Vite serves on `5173`, and
the e2e helper has a `killAnyOn8080()` step plus
`test.describe.configure({ mode: 'serial' })` in several specs because
of port reuse.

Replace with dynamic-port allocation per run:

- A small helper picks free TCP ports on demand (probe via
  `net.createServer().listen(0)` or equivalent).
- The Playwright fixture asks for two ports per test (Vite + backend),
  starts both on those ports, and the test's `baseURL` is derived from
  the chosen Vite port via a `PLAYWRIGHT_BASE_URL` env var.
- The backend helper threads its chosen port through `SPLITS_ADDR`.
- The legacy `killAnyOn8080()` step is removed.
- `test.describe.configure({ mode: 'serial' })` is removed from the
  *race* specs (the legacy `history.spec.ts`, `insights.spec.ts`,
  `v1-flows.spec.ts` may retain serial mode for now — they're not
  part of this PRD's headline).

This is a tracer bullet: include a sanity Playwright test that runs
two test instances concurrently against the same machine and asserts
no port/DB collision occurs.

## Acceptance criteria

- [ ] Free-port helper available to the e2e fixture.
- [ ] Vite dev server starts on a per-run port; Playwright `baseURL` reads from `PLAYWRIGHT_BASE_URL` env (default `http://localhost:5173` for human runs).
- [ ] Backend starts on a per-run port via `SPLITS_ADDR`; the e2e fixture passes it through.
- [ ] `killAnyOn8080()` and references to fixed port 8080 are removed from the e2e helpers.
- [ ] Race-mode specs no longer use `test.describe.configure({ mode: 'serial' })`.
- [ ] Parallel sanity test: two specs run concurrently and both pass without port or DB collision (run via `npx playwright test --workers=2` or equivalent).
- [ ] Existing legacy specs (history/insights/v1-flows) still pass under whatever mode they chose.

## Blocked by

None — can start immediately.
