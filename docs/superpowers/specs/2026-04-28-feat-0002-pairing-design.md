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
