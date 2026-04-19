# ADR-0005: Per-Rower QR-Code Pairing

- **Status**: Proposed
- **Date**: 2026-04-19

## Context

Multi-user household on a LAN needs some minimum of access control
(prevent casual access from someone who stumbles onto the URL) plus
per-rower attribution (so sessions land under the correct profile
without a manual pick every time).

## Options considered

### Option A — No authentication

Pros: Zero friction.

Cons: Anyone who lands on the URL can see or modify household
training data. Not acceptable.

### Option B — Shared household password (one secret, profile picker)

Pros: Simple server side; one secret to rotate.

Cons: Every device hits a password prompt; profile picker is always
present; adding/removing a household member doesn't map to any obvious
operation.

### Option B — Per-user password

Pros: Strongest attribution; survives lost devices (rower logs in
elsewhere).

Cons: Password management, reset flows, UI for each — wildly
disproportionate for a home ergo.

### Option C — Per-rower QR-code pairing (chosen)

Pros:
- **One scan onboards.** The same action that pairs the device also
  identifies the rower — no separate profile pick needed.
- **Physical-secret model fits home setting.** A QR printed and stuck
  on the fridge or shared in Signal is a sensible transport.
- **Attribution is automatic** on single-rower devices (phone,
  personal tablet). Shared ergo tablets can hold multiple pairings and
  offer a one-tap switcher.
- **Revocation is per rower** — rotate one token, re-issue a QR, other
  household members unaffected.

Cons:
- Need an admin flow to generate QRs (first-run + later additions).
- A lost device means the admin rotates that rower's token.
- Shared tablets still need a "who's rowing now?" tap, but only
  between already-paired rowers on that device.

### Option D — Device/OS biometric binding

Pros: Strongest in principle.

Cons: Platform-specific APIs, falls apart on a kitchen tablet, does
not map to multi-user devices. Overkill.

## Decision

Adopt **Option C — per-rower QR-code pairing**.

### Mechanics

- Each rower has a **pairing token**: 256-bit cryptographic random,
  base64url-encoded. Stored on the backend as a salted hash (Argon2id),
  never in plaintext.
- The QR encodes a URL:
  ```
  https://<ergo-host>/pair#t=<token>
  ```
  The token is in the URL fragment (`#…`) so it is **not** sent in the
  HTTP request path to the static endpoint — the PWA reads it from
  `location.hash` client-side and exchanges it for a session.
- On exchange, the backend verifies the hash, issues an `HttpOnly;
  Secure; SameSite=Lax` session cookie bound to that rower, and
  stores the pairing in the PWA's local state (rower name, avatar, a
  locally-retained copy of the rower_id — **not** the raw token).
- A device can hold multiple pairings. The live view shows the
  currently active rower; switching is a one-tap action among
  already-paired rowers. Adding a new rower on the device = scan a new
  QR.
- Admin is a rower flagged `is_admin`, distinguishable by having the
  "Generate QR for new rower" affordance. First-run setup creates the
  first rower with admin=true and displays that QR on screen.

### Token lifecycle

- Pairing token = long-lived (years). It never expires on its own.
- Session cookie = short-lived (30 days sliding), reissued on use.
- Admin can **rotate** any rower's pairing token, which invalidates all
  session cookies tied to that rower; the admin then re-shares the new
  QR.
- Admin can **revoke** a rower entirely (soft delete per FEAT-0002).

### Security posture

- Threat model: casual LAN prying by non-household members. Anyone who
  physically holds (or photographs) a QR gets in as that rower. That's
  the intended property — the QR is the shared physical key. Don't
  post them publicly.
- Transport: HTTPS via Caddy (ADR-0006). Pairing URL only works over
  TLS; the backend 404s the pairing exchange on plain HTTP.
- No network-level defense against a malicious household member
  impersonating another — attribution, not adversarial defense.
- If the app is later exposed beyond the LAN (reverse tunnel, ADR
  deferred), the model still holds: the bearer-token secret travels
  over TLS and is revocable per rower.

## Consequences

- **Server**:
  - A rower table with `id`, `name`, `is_admin`, `paired_hash`,
    `created_at`, `deleted_at`.
  - A `/pair` endpoint: exchange token → session cookie.
  - A `/admin/rowers` API (admin-only) to generate, revoke, and list
    rowers + download their QR.
  - A QR-generation step (SVG preferred; backend dependency
    allowed — e.g. `qrcode` in Python or `go-qrcode` in Go).
- **PWA**:
  - `/pair` route that reads `location.hash`, does the exchange, clears
    the fragment from history, and drops into the live view.
  - Multi-rower state: the PWA keeps the list of paired rowers; the
    "active" rower is stored in local state and restored on load.
  - No password entry screen ever. Unpaired devices show a "Scan your
    QR or ask the admin for one" call to action.
- **Onboarding**:
  - First run on the deploy host: print the admin QR to stdout (and/or
    show it in a one-shot setup wizard).
  - Everyone else: admin hands over a QR; scan with the phone camera
    (or the PWA's "scan QR" action once paired); done.
