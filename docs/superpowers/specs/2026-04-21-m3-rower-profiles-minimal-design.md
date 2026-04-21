# M3 Finalization — Rower Profiles (Minimal Slice)

- **Status**: Draft
- **Date**: 2026-04-21
- **Scope**: Minimum work to close ROADMAP M3 (FEAT-0002 profile basics + session→active-user wiring). Defers QR pairing, admin, and auth to a later milestone.
- **Depends on**: M3 persistence (shipped), M3 history read UI (shipped).
- **Supersedes (partially)**: `specs/feat/0002-user-profiles-onboarding.md` acceptance items marked below. Pairing / admin / QR / tokens remain in FEAT-0002 for the next pass.

## Goal

Replace the hardcoded `'local-rower'` stub with a real rower identity bound to the device. Each stored session gets the rower_id of whoever was active at session start. Multiple rowers can share a device via a top-bar avatar switcher.

## Non-goals

- QR pairing (ADR-0005) — deferred.
- Shared-password / cookie-based auth — deferred (trust local network).
- Admin flag / admin-only household screen — deferred.
- Soft-delete + 30-day recovery — deferred; delete is not exposed in this slice.
- Token hashing, rotation — N/A (no tokens).
- Multi-device sync of active-rower state (each device picks independently, server stores device→rower map).
- SVG QR render, setup wizard, "Household" screen.

## User stories (in scope)

- As a first-time user on a fresh install, I'm taken to an onboarding screen and asked to create a rower (name + optional weight/height/dob/colour) before I can use the app.
- As a returning user, my last-active rower is restored automatically on app load.
- As a shared-tablet user, I can tap an avatar in the top bar to switch the active rower before starting a session.
- As an existing rower, I can edit my own profile fields (name, weight, height, dob, colour) from a settings screen.
- As a user viewing history, each session row shows the rower it was attributed to, so I can tell whose session is whose at a glance.
- As a user of the app, I can see my BMI derived from weight and height when both are set.

## Architecture

### Data model (SQLite migration 0003)

```sql
CREATE TABLE rowers (
  id          TEXT PRIMARY KEY,    -- UUIDv4 generated server-side
  name        TEXT NOT NULL,
  weight_kg   REAL,                -- nullable
  height_cm   REAL,                -- nullable; enables BMI (client-computed)
  dob         TEXT,                -- ISO date (YYYY-MM-DD), nullable
  color       TEXT NOT NULL,       -- hex like "#ff6b6b"; server picks default if missing
  created_at  TEXT NOT NULL        -- RFC3339
);

CREATE TABLE device_active_rower (
  device_id   TEXT PRIMARY KEY,    -- UUIDv4, stored in HttpOnly cookie
  rower_id    TEXT NOT NULL REFERENCES rowers(id),
  updated_at  TEXT NOT NULL
);
```

No FK added to existing `sessions.rower_id` — legacy rows with `'local-rower'` remain valid and render as "—" (unknown) in the UI.

### Backend

- New package `backend/internal/rower/` with `Repo` (CRUD) + `ActiveRepo` (device→rower).
- New package `backend/internal/api/rowers/` with handlers:
  - `GET  /api/v1/rowers`                  → list
  - `POST /api/v1/rowers`                  → create
  - `PATCH /api/v1/rowers/{id}`            → partial update
  - `GET  /api/v1/active-rower`            → `{rower_id, name}` or 404
  - `PUT  /api/v1/active-rower`            → set active for this device
- New middleware `device.Cookie`: if request has no `device_id` cookie, generate UUIDv4 and Set-Cookie (HttpOnly, SameSite=Lax, Path=/, Max-Age=10y). Handler reads `req.Cookie("device_id")` for active-rower endpoints.
- Sessionizer: replace static `Options.RowerID/RowerName` with `ResolveRower func(context.Context) (id, name string, err error)`. The wire layer injects a resolver backed by `ActiveRepo.Get(deviceID)` — but since sessions originate from the serial loop (no per-request device), the resolver is instead driven by the **last active rower touched by any device** (MVP simplification). Fallback: `'local-rower'` / `''` if no rower exists (cold-boot race before onboarding).

Resolver detail: backend keeps an in-memory "current rower" (last value PUT to `/active-rower` by any device) + loads the most-recent `device_active_rower.rower_id` from DB at startup. Single-user-at-a-time on the ergo is the assumption; multi-device arbitration is a future milestone concern.

### Frontend

- `useActiveRower()` — TanStack Query hook (`queryKey: ['active-rower']`).
- `<RowerGate>` at app root: if `useActiveRower` 404s or `useRowers` empty, redirect to `/onboarding`.
- `/onboarding` route — single form: name (req), optional weight/height/dob/colour picker. Submit = POST rower + PUT active-rower + invalidate + navigate `/`.
- `<TopBar>` — avatar strip. Each avatar = colored circle with initial. Active has ring. Tap → PUT active-rower + invalidate queries. Trailing `+` → `/einstellungen` (Add rower).
- `/einstellungen` — list of rowers, inline edit (name, weight, height, dob, colour), "Add rower" button. Read-only BMI line appears when weight + height both present.
- History list row — colored dot + rower name (or "—" if orphan). No filtering yet; badge only.

### Session→rower wiring

Sessionizer receives `rower_id` + `name` at the moment it emits `SessionStart`. Mid-session switches are ignored (session is owned by whoever was active at the start boundary).

## Acceptance criteria

### Onboarding

- [ ] Fresh install + empty `rowers` table → app routes to `/onboarding` before any other screen renders.
- [ ] Submitting onboarding form creates rower, sets it active for this device, redirects to `/`.
- [ ] Reload after onboarding does not re-show onboarding.

### Profile CRUD

- [ ] Name is required; empty name submission shows client-side error.
- [ ] Weight, height, DOB, colour are optional.
- [ ] PATCH updates only supplied fields.
- [ ] When weight_kg and height_cm are both set, settings screen shows BMI = `weight_kg / (height_cm/100)^2`, rounded to 1 decimal.

### Device + active rower

- [ ] First request from a new browser sets an HttpOnly `device_id` cookie.
- [ ] `PUT /api/v1/active-rower` upserts the row keyed by that device_id.
- [ ] Avatar tap in top bar switches active rower and triggers re-fetch of rower-dependent queries.
- [ ] Reload restores last-active rower from backend.

### Session wiring

- [ ] A session started while rower A is active is persisted with `rower_id = A.id`.
- [ ] Switching to rower B between sessions causes the next session to be attributed to B.
- [ ] History list renders the rower badge per row. Orphan `'local-rower'` rows show "—".

### Tests

- [ ] Backend: rower CRUD handler tests, device-cookie middleware test, active-rower set/get test, sessionizer resolver test (rower A → session → switch → rower B → next session).
- [ ] Frontend: `<RowerGate>` unit test (no rower → redirect, has rower → pass), onboarding form validation test.
- [ ] E2E (Playwright): fresh load → onboarding form → create rower "Alice" → live view appears with "Alice" in top bar → navigate to history (pre-seeded one session via fixture) → row shows "Alice" badge.

## Out of scope in this slice (stay on FEAT-0002 backlog)

- QR pairing, long-lived token exchange, cookie session auth.
- Admin flag (`is_admin`), Household screen, token rotation, delete rower.
- Setup wizard / initial admin QR / `ergo-setup` command.
- Multi-rower concurrency on different devices (arbitration).

## Migration note

Migration 0003 is additive only. Existing session rows with `rower_id = 'local-rower'` remain untouched; the UI renders them as unknown. A future cleanup pass may retroactively assign them once auth lands.

## Open questions

- Avatar colour: server default palette (cycling through 8 preset hexes) vs. user-picked via colour swatch grid. Plan: preset palette, UI lets user tap to re-pick.
- BMI display: settings screen only, or also surfaced on profile chip? Settings only for this slice.
- Onboarding re-entry: if an admin wipes `rowers` table by hand, returning users hit `/onboarding` again. Acceptable.
