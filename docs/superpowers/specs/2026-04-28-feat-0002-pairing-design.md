# FEAT-0002 Pairing — Design

Date: 2026-04-28
Status: Approved (brainstorming complete; pending implementation plan)
Related: `specs/feat/0002-user-profiles-onboarding.md`, `specs/adr/0005-qr-per-rower-auth.md`

## Goal

Lightweight per-rower pairing for a LAN-only home setup. Strong enough to keep casual outsiders out, simple enough that a household of two-to-four rowers onboards in minutes without an admin tier. Builds on the `device_rowers` table already shipped in v1 P0 hardening.

## Threat model (explicit)

- **In scope:** keep stranger LAN traffic from creating sessions or reading another household's data; attribute sessions to the correct rower automatically on personal devices.
- **Out of scope:** prevent a household member from rowing under a co-resident's name on a shared tablet. The shared ergo tablet is mutual physical trust by design (see "Shared-device trust" below). Adversarial defense between household members is not a goal.

## Trust model

**Flat, no admin tier.** Every paired rower can:

- Create a new rower profile.
- Mint a pairing URL for any existing rower (used to add another device for that rower).

There is no "admin" flag. No "Household" admin screen. Token rotation and rower deletion happen via CLI in v1 (see "Operator workflows"). This is a deliberate simplification of FEAT-0002's original spec.

### Shared-device trust (accepted limit)

When two or more rowers pair the same device (e.g. a tablet at the ergo), the in-app rower switcher in `RowerStrip` lets either pick the other with one tap. There is no per-rower auth on profile selection. **This is documented as a known limitation, not a bug.** Personal phones with one pairing are unaffected. The "PIN extension" below describes how to add per-rower selection auth later if desired.

### PIN extension hook (deferred, designed-in now)

The schema and selection flow leave room for an optional per-rower PIN, addable in a future increment without migrations beyond a column add:

- New column `rowers.pin_hash TEXT NULL` (Argon2id; PINs are low-entropy so Argon2id is appropriate here, unlike pairing tokens — see "Token hashing").
- `PUT /api/v1/active-rower` checks `pin_hash`. If non-null, response is 401 with `{requires_pin: true}` and the PWA prompts; PIN goes in body for verify.
- PIN set/clear UI lands in the rower's Profile detail screen.
- Default OFF — opt-in per rower. Personal phones never see the prompt unless user enables.

This is **not** built in v1. Documented to ensure the v1 design doesn't paint us into a corner.

## First run

Empty install (no rowers in DB) shows a "Create first rower" form (already exists in current onboarding flow). Submission creates the first rower; the device that submitted is auto-paired via the existing T4 path (`POST /api/v1/rowers` already inserts `device_rowers`).

No CLI bootstrap. No initial admin URL. The first device on the LAN to reach the install becomes the founder. On a home LAN this is deterministic enough — multi-device race conditions are not a real risk for the deployment context.

## Pairing flows

### Where to launch

**Profile tab `+` button.** A floating-or-inline `+` action on the Profile tab opens a modal. No new nav depth. RowerStrip is unchanged.

### Modal contents

Two clearly separated actions:

1. **"Neuer Ruderer auf diesem Gerät anlegen"**
   - Inline name input → on submit, calls `POST /api/v1/rowers` (existing endpoint, no change). The current device is auto-paired with the new rower (T4 behavior).
   - Returns to Profile tab; new rower visible in RowerStrip.

2. **"Pairing-Link für ein anderes Gerät erstellen"**
   - Picker: which existing rower (defaults to the active rower).
   - Calls `POST /api/v1/rowers/{id}/pairing-tokens` (new endpoint — see "Backend").
   - Backend mints a 256-bit token, stores SHA-256 hash, returns plaintext token + QR SVG.
   - Modal shows: full pairing URL (`https://<host>/pair#t=<token>`), QR image, "Copy URL" button, "Share" button (uses `navigator.share` where available, falls back to copy).
   - Token is shown ONCE. If user dismisses the modal, the token is gone — they must mint a new one.

### Receiver side

Receiver opens the URL on a new device. Native browser handles QR scan if delivered via QR; otherwise URL paste / share-sheet works.

- PWA route `/pair` reads `location.hash`, parses `t=<token>`, calls `POST /api/v1/pair` with `{token}` in body, then clears the fragment with `history.replaceState` and routes to the live view.
- On 200: backend has set the device cookie (if missing) and inserted `(device_id, rower_id)` into `device_rowers`. Active rower is set to the freshly-paired rower for that device.
- On 410 (revoked / consumed): show "Dieser Code ist nicht mehr gültig — frag den Haushalt nach einem neuen."
- On 400 (malformed): show generic onboarding-failed message.

### Token lifecycle

- **One pairing token per use.** A token may be exchanged once. After successful exchange, the row in `pairing_tokens` is hard-deleted (or marked consumed — see schema choice). Re-scanning the same URL after success returns 410.
- **Optional expiry.** Tokens carry an `expires_at` set to `now() + 24h`. Reduces blast radius of a leaked URL. The minting UI says "Link gilt 24 Stunden". For longer-lived sharing, mint a fresh one.
- **No rotation UI in v1.** Operator can revoke via CLI (see below).

### Concurrency & race

If two devices race the same token, the consume happens in a single SQL transaction (`DELETE … WHERE token_hash = ? RETURNING rower_id`). The losing race gets 0 rows → 410.

## Backend

### New schema

```sql
-- backend/internal/storage/migrations/00NN_pairing_tokens.sql
CREATE TABLE IF NOT EXISTS pairing_tokens (
  token_hash TEXT PRIMARY KEY,           -- SHA-256(token), hex
  rower_id   TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMP NOT NULL,
  FOREIGN KEY (rower_id) REFERENCES rowers(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_pairing_tokens_rower ON pairing_tokens(rower_id);
CREATE INDEX IF NOT EXISTS idx_pairing_tokens_expires ON pairing_tokens(expires_at);
```

### Endpoints

```
POST /api/v1/rowers/{id}/pairing-tokens
    Auth: device must be paired with `id` (T4 boundary).
    Body: empty.
    200 → { token: "<base64url>", url: "https://<host>/pair#t=<token>", qr_svg: "<svg…>", expires_at: "…" }
    403 → device not paired with this rower.

POST /api/v1/pair
    Body: { token: "<base64url>" }
    200 (no body) → device_id cookie present (issued by middleware if missing); device_rowers row inserted; active rower set to the paired rower.
    410 → token unknown, expired, or consumed.
    400 → token malformed.
    Rate-limited via existing T13 RateLimit middleware (still allows ~6 rps which is plenty for human pairings).
```

### Token format

- 32 random bytes from `crypto/rand.Read`, base64url-encoded (43 chars no padding).
- Stored as `hex(sha256(token))` (64 chars). The plaintext exists only in the response and on the wire (TLS via Caddy per ADR-0006).

### Token hashing rationale (corrects ADR-0005)

ADR-0005 specifies Argon2id. **We use SHA-256 instead** because the secret is 256 bits of cryptographic randomness. Argon2 hardens against brute-force on low-entropy secrets (passwords, PINs); for high-entropy random tokens it adds CPU cost without security benefit. SHA-256 of a 256-bit random string is computationally indistinguishable from a random 256-bit string. ADR-0005 update is part of this work.

### Session cookie

No new cookie. The existing `device_id` cookie (T9, HttpOnly, SameSite=Lax, Secure when not in dev mode) plus the `device_rowers` row IS the session. Pairing = "this device is now allowed to be this rower". Revocation = delete the device_rowers row.

### Pairing exchange auth boundary

The `/api/v1/pair` endpoint is unauthenticated (no prior pairing required) — it has to be, since the caller is by definition a fresh device. The token IS the auth. Rate limit + 24h expiry + single-use are the defenses.

## Frontend

### Routes

- `/pair` — new route. Reads `location.hash`, calls `/api/v1/pair`, clears fragment, navigates to `/`.
- Profile tab — extended with `+` action triggering the pairing modal.

### Components

- `PairingModal.tsx` — the two-action modal. ~150 LOC.
- `PairingLinkView.tsx` — sub-component showing URL + QR + copy/share buttons.
- `PairRoute.tsx` — page handler at `/pair`.
- `pairing.ts` — API client wrappers.

### Error handling

Use existing `ApiError` shape (T22). 410 maps to a German "Code abgelaufen" toast. 403 on token mint maps to "Du musst mit diesem Profil verbunden sein". 429 → existing rate-limit toast.

## PWA secret handling

The PWA never holds a long-lived secret in JavaScript-accessible storage.

| Item | Storage | Lifetime | JS-readable |
|---|---|---|---|
| Pairing token | URL fragment → JS memory → POST body | sub-second on receiver device only; deleted server-side after exchange | yes (briefly, on receiver) |
| Device session | `device_id` cookie (`HttpOnly; Secure; SameSite=Lax`) | 10 years sliding | **no** |
| Rower display data (name, id, color) | `localStorage` `home-ergo:*` | persistent | yes — non-secret |
| `last-event-id` SSE cursor | `localStorage` | persistent | yes — non-secret |

### Defenses

- URL fragment is not transmitted in the HTTP request line; backend never logs the plaintext token because it never receives it via GET.
- Pairing exchange is `POST /api/v1/pair` with token in JSON body, over TLS only (T10 startup gate).
- Backend deletes the token row inside the same transaction that inserts `device_rowers`, so a leaked URL is single-use.
- After successful exchange, the PWA calls `history.replaceState(null, '', '/')` to remove the fragment from the URL bar AND from session history.
- Service-worker config (`web/vite.config.ts`) already routes `/api/*` to `NetworkOnly` — pairing exchange is never cached.
- T11 CSP (`script-src 'self'`) blocks inline-script XSS that could exfiltrate the in-memory token during the sub-second exchange window.

### Cookie rotation policy

The `device_id` cookie value does **not** rotate in v1.

- It identifies a device, not a rower. Rotating the value would invalidate every `device_rowers` row referencing the old id, forcing every rower on that device to re-pair on every rotation.
- HttpOnly + Secure + SameSite=Lax already block extraction via XSS; there is no realistic exfiltration path on the PWA origin.
- Effective "logout" of a (device, rower) pair is achieved by removing the `device_rowers` row, not by changing the cookie. CLI `splits revoke` is the operator path; FK CASCADE handles `splits delete-rower`.
- The cookie's `Expires` / `MaxAge` is refreshed (sliding) on each visit, but the value stays stable across the device's lifetime.

If rotation becomes a requirement (e.g. policy change, suspected device theft), add a `splits rotate-device <cookie-value-or-fingerprint>` CLI later that deletes the device's `device_rowers` rows; the next visit issues a fresh cookie naturally.

### Residual risk (accepted)

Same-origin XSS on the PWA could issue authenticated requests because the HttpOnly cookie is auto-attached by the browser. This is the standard browser auth model and orthogonal to pairing design. CSP plus the absence of any user-generated HTML in the app keep the XSS attack surface small.

## Recovery: lost device

If a rower loses their device and wants to access existing history on a new device:

1. **Household path (preferred).** Any other paired household member opens Profile → `+` → "Pairing-Link für ein anderes Gerät erstellen" → picks the affected rower → mints URL → sends to them. They open on new device → paired. All history visible immediately.

2. **CLI path (single-rower install or no other paired device).** Operator runs `splits invite <rower-id>` on the backend host; URL printed to stdout. Send URL out-of-band; new device opens → paired.

A fresh unpaired device **cannot** claim an existing rower from the UI without a token. This is intentional: otherwise any LAN visitor could take over a rower whose last device died. Token + CLI access is the deliberate safety boundary.

If the lost device is a security concern (suspected theft), run `splits revoke <rower-id>` first to invalidate every existing device pairing for that rower, THEN `splits invite <rower-id>` to mint a fresh token. The lost device is now signed out of that rower without affecting other rowers on the same physical device.

## Operator workflows (CLI v1)

`backend/cmd/splits/main.go` gains subcommands. Today the binary takes no subcommands; we add a thin dispatch layer:

- `splits invite <rower-id>` — mints a pairing URL for the given rower, prints it. Same logic as the HTTP endpoint, useful for cold-host bootstrap or for revoking-and-reissuing.
- `splits revoke <rower-id>` — deletes all `device_rowers` rows for that rower (forces every device to re-pair) and any outstanding `pairing_tokens` rows.
- `splits delete-rower <rower-id>` — soft-deletes rower (existing schema flag). Sessions remain attributed; rower hidden from UI.

These cover rotation and removal without a Household admin screen. They're documented in `backend/README.md` for the household maintainer.

## Ops manual

Step-by-step playbook for the household maintainer. The implementation plan will mirror the CLI sections into `backend/README.md` so they're discoverable next to the binary.

### Conventions

- All `splits …` commands run on the backend host with the same env (`SPLITS_DB_PATH`, etc.) as the running service. Stop the service before running mutating CLI commands? **Not required** — SQLite WAL mode permits concurrent readers + writers; CLI operations use the same DB connection rules as the HTTP layer. Document this so the maintainer knows it's safe.
- Pairing URLs always have shape `https://<host>/pair#t=<token>`. Token is single-use, expires in 24h.
- The HTTPS host (e.g. `https://splits.example.de`) comes from the Caddy config (ADR-0006). On a fresh deploy, a TLS cert via DNS-01 is set up before pairing works (T10 startup gate refuses plain HTTP).

### Scenario 1 — First install (bootstrap)

1. Deploy backend + Caddy on the host. Confirm `https://splits.example.de` returns 200.
2. Open the URL on whichever device should be the founder rower (your phone is fine).
3. App shows "Welcome — create first rower". Enter name. Submit.
4. Device is auto-paired. You're in.

No CLI step. No special admin URL. The first device on the LAN to reach the install becomes the founder.

### Scenario 2 — Adding another rower (new household member)

Two flavors:

**A. New rower already has a paired device of their own (rare for fresh adds).**
   They simply open the app on their device — but there's no path here, because they're not yet a rower. Use flavor B.

**B. New rower's device is unpaired (the normal case).**
   1. On any paired device, open Profile tab.
   2. Tap `+` → "Neuer Ruderer auf diesem Gerät anlegen" (creates rower locally) — **only** if you want this device to also be paired with the new rower (e.g. shared tablet at the ergo).
   3. Otherwise: tap `+` → "Pairing-Link für ein anderes Gerät erstellen" → enter new rower's name (system creates rower if not yet present, then mints token).
   4. Send the URL to the new rower via Signal/SMS/AirDrop.
   5. They open URL on their device. Paired. Profile visible in their RowerStrip.

> **Note for implementation plan:** the modal needs the "create rower + mint token in one go" path for flavor B. Backend endpoint `POST /api/v1/rowers/{id}/pairing-tokens` requires `id` to exist; UI should call `POST /api/v1/rowers` first, then mint. Or add `POST /api/v1/pairing-tokens` that accepts `{rower_id?, name?}` and creates-then-mints atomically. Decide in plan.

### Scenario 3 — Adding existing rower to a new device (your second device)

1. Open Profile on already-paired device.
2. Tap `+` → "Pairing-Link für ein anderes Gerät erstellen" → pick yourself.
3. Open the URL on the second device. Done.

### Scenario 4 — Lost device, household has at least one other paired device

1. (Optional but recommended if device theft suspected.) On the backend host:
   ```
   splits revoke <rower-id>
   ```
   This deletes every `device_rowers` row for that rower. The lost device, if recovered by the wrong hands, can no longer act as that rower.
2. From any other paired device, follow Scenario 3 to pair the replacement device.

### Scenario 5 — Lost device, single-rower install (no other paired device)

The household path is unavailable. Use CLI:
```
splits invite <rower-id>
```
URL is printed to stdout. Send it to yourself out-of-band (email to yourself, AirDrop from a different device). Open URL on the new device.

If theft is suspected, run `splits revoke <rower-id>` first.

### Scenario 6 — Removing a household member

```
splits delete-rower <rower-id>
```
Soft-deletes the rower. Their sessions remain in the DB attributed to them (no historical revisionism), but they're hidden from the UI. FK CASCADE removes all their `device_rowers` rows; their devices get a "rower not found" state and the user must pick another rower or unpair.

To restore (undo within reason): manually clear the soft-delete flag in SQLite. No UI for this in v1.

### Scenario 7 — Rotating a rower's pairing for any reason

```
splits revoke <rower-id>     # invalidate every device pairing
splits invite <rower-id>     # mint fresh URL
```
Send the new URL to the legitimate owner. They re-pair on each device they actually use.

### Scenario 8 — Inspecting state

For diagnostics:
```
splits ls-rowers             # list rowers with id, name, soft-deleted flag
splits ls-pairings            # list (device_id, rower_id, paired_at) rows
splits ls-tokens              # list outstanding pairing_tokens (hash, rower_id, expires_at)
```

(These read-only commands are nice-to-have; implementation plan will keep them tiny — single SELECT each.)

### Scenario 9 — Backup & restore

Out of scope of FEAT-0002 but linked: see M6 deploy plan for the SQLite snapshot cron. The pairing tables are part of the regular DB backup.

### CLI reference (summary)

| Command | Purpose |
|---|---|
| `splits invite <rower-id>` | Print pairing URL for that rower (24h expiry, single use). |
| `splits revoke <rower-id>` | Delete all device pairings + outstanding tokens for that rower. Forces re-pair. |
| `splits delete-rower <rower-id>` | Soft-delete rower; CASCADE removes pairings. |
| `splits ls-rowers` | List rowers (read-only). |
| `splits ls-pairings` | List `device_rowers` rows (read-only). |
| `splits ls-tokens` | List outstanding pairing tokens (read-only). |

All CLI commands use `os.LookupEnv` for `SPLITS_DB_PATH` (or legacy `HOMEERGO_DB_PATH` per T14 fallback).

### Failure modes

| Symptom | Likely cause | Fix |
|---|---|---|
| New device shows "Code abgelaufen" on `/pair` | Token > 24h old or already consumed | Mint fresh URL via Profile or `splits invite`. |
| New device shows "Du musst mit diesem Profil verbunden sein" when minting | Active device is not paired with that rower | Switch to a device that IS paired, or use CLI invite. |
| `splits invite` prints `rower not found` | Rower id wrong, or rower soft-deleted | `splits ls-rowers` to confirm; restore by clearing soft-delete flag if needed. |
| TLS error on first deploy | Caddy cert not yet provisioned | Check Caddy logs; DNS-01 may take 1-5 min on first issue. |
| Backend refuses to start | T10 gate hit (no TLS, no dev mode) | Set `SPLITS_TLS_TERMINATED_BY=proxy` if behind Caddy, or `SPLITS_DEV_MODE=1` for local dev. |
| `splits …` CLI errors with "database is locked" | Another writer holding the WAL | SQLite normally handles this; retry. If persistent, check for stuck process via `lsof <db>`. |

## Out of scope (v1)

The following items are part of FEAT-0002's original spec but deferred:

- Admin "Household" screen.
- `is_admin` flag on rowers.
- In-app camera scanner (we rely on native camera apps).
- Token rotation UI.
- 30-day sliding session cookies separate from `device_id`.
- Per-rower PIN (designed-in but not built; see "PIN extension hook").
- Soft-delete recovery UI.

## Acceptance criteria

- [ ] Empty install: web form creates first rower, that device is auto-paired, no CLI required.
- [ ] On any paired device, Profile tab → `+` opens modal with two actions.
- [ ] "Create new rower" path mints rower + auto-pairs current device (existing flow).
- [ ] "Generate pairing link" path returns a URL + QR SVG. URL works exactly once. URL expires after 24h.
- [ ] Receiver visits URL on new device → paired. Token cleared from URL fragment via `history.replaceState`.
- [ ] Re-using a consumed/expired URL → 410 with German error message.
- [ ] CLI `splits invite`, `splits revoke`, `splits delete-rower` work.
- [ ] Token never logged or persisted in plaintext (search structured logs + DB on integration test).
- [ ] Documentation updated: `backend/README.md` (CLI), ADR-0005 (hashing rationale), this spec linked from `specs/feat/0002-user-profiles-onboarding.md`.

## Migration / rollout

- New migration `pairing_tokens` table.
- No data migration needed; existing `device_rowers` from T4 is preserved.
- New endpoints additive. No breaking changes to existing API.

## Self-review notes

- Scope check: single subsystem (pairing). One implementation plan. No decomposition needed.
- Internal consistency: token hashing rationale (SHA-256) deliberately deviates from ADR-0005; spec covers the update.
- Ambiguity check: "shared-device trust" is explicit; not a hidden assumption.
- Placeholder scan: migration number `00NN_*.sql` is a known TBD — implementer picks the next number from `ls`. CLI subcommand wiring is sketched, not specified line-by-line; implementation plan will fill it in.
