# ADR-0005: Shared-Secret Authentication

- **Status**: Accepted
- **Date**: 2026-04-19

## Context

The app has multiple users (household members) and runs on a LAN. We need
some minimum of access control to prevent accidental or casual access from
someone who stumbles onto the URL, but not a full enterprise auth stack.

The user has explicitly accepted "shared password for everyone on the home
network" as the security model for v1.

## Options considered

### Option A — No authentication

Pros: Zero friction.

Cons: Anyone who lands on the URL can see / modify household training
data. Not acceptable even at the low bar of a household.

### Option B — Shared secret / household password

Pros: Minimal friction (enter once per device, cookie-persisted);
trivially understood; no per-user password management; no email / SMS.

Cons: Not user-distinguishing — any household member can act as any
profile. Fine for this use case: profile is a chooser, not a security
principal.

### Option C — Per-user passwords

Pros: Accountability — the session is tied to a specific user who
authenticated.

Cons: Password management burden; reset flow needed; no real threat model
justifies it in a household.

### Option D — OS / network-level trust (LAN IP allowlist)

Pros: Zero UI friction if the LAN is trusted.

Cons: Fails the moment anyone uses Wi-Fi guests, IoT VLANs, or tethers a
phone; also fails if the app is exposed via reverse tunnel to another
location.

## Decision

**Shared household secret**, verified at first visit per device, stored as
a long-lived signed cookie or local-storage token with configurable TTL
(default 30 days).

- Secret stored on the backend as a salted hash (Argon2id or bcrypt).
- Secret set via backend config (env var or setup wizard) on first run.
- Admin (= whoever has SSH access to the deploy host) can rotate it; all
  devices are logged out on rotation.
- Session cookie is `HttpOnly; Secure; SameSite=Lax`, requires TLS
  (see ADR-0006).

Profile selection in the UI is **not** security — it's attribution. Two
kids sharing the ergo will pick the correct profile honestly; we don't
defend against profile spoofing within the household.

## Consequences

- Simple auth middleware on the backend checks the cookie on every
  non-public request.
- PWA service worker treats 401 as "re-auth needed" and redirects to the
  password screen.
- No password reset UI for users; there's only one password and the admin
  rotates it out of band.
- If the app is ever exposed beyond the LAN (reverse tunnel, etc.), this
  model is still acceptable at that scale — but per-user auth would
  become prudent.
