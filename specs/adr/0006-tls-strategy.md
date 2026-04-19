# ADR-0006: TLS Strategy

- **Status**: Proposed
- **Date**: 2026-04-19

## Context

A PWA needs HTTPS to be installable on iOS and Android (exception:
`localhost`). The app runs on a LAN-only host (no public exposure), which
complicates the usual Let's Encrypt HTTP-01 flow.

## Options considered

### Option A — Caddy + Let's Encrypt via DNS-01 challenge

Setup: Point a subdomain (e.g. `ergo.example.de`) via public DNS to the
LAN IP of the deploy host (the A-record publicly resolves to `192.168.x.x`,
which only LAN clients can reach). Caddy obtains and renews the cert using
the DNS-01 challenge via the DNS provider's API — no port forwarding
required.

Pros: Real cert from a trusted CA; no client-side trust setup; works on
all devices including locked-down iOS; auto-renewal; publicly-resolvable
hostname survives DNS quirks on iOS/Android.

Cons: Requires a domain you control and a DNS provider with an API Caddy
supports (IONOS, Cloudflare, Route53, Hetzner, etc.).

### Option B — Caddy internal CA

Caddy generates its own root CA and issues certs from it (`tls internal`).

Pros: No external dependencies; works fully air-gapped.

Cons: Each client device must explicitly trust the root CA. iOS is
particularly painful: install profile, then enable full trust in Settings
→ General → About → Certificate Trust Settings. Per-device, forever. Bad
UX for non-technical household members.

### Option C — mkcert-generated certs

Dev-time convenience — not production-suitable for mobile clients.

Pros: Easy for the developer's own Mac.

Cons: Same trust-per-device issue as Option B, worse tooling for mobile.

### Option D — Plain HTTP

Pros: Zero setup.

Cons: PWA install is impossible on mobile. Service workers don't register
outside `localhost`. Fails the core requirement.

## Decision

**Primary: Option A (Caddy + DNS-01).** Assumes the maintainer has a
controllable domain (user has IONOS hosting already → API available).

**Fallback: Option B (Caddy internal CA)**, documented as an escape hatch
for deployments without a domain.

## Consequences

- Caddy runs on the deploy host as a reverse proxy in front of the
  backend process. Caddyfile lives in `deploy/Caddyfile`.
- Backend listens on `127.0.0.1:PORT` only — never exposes itself
  directly.
- DNS provider API credentials live in an env file consumed by Caddy's
  systemd unit, not committed.
- Cert renewal is automatic; ops work is zero once set up.
- The public DNS A-record pointing to a private IP is a mildly unusual
  pattern but fully standards-compliant — no security risk, just worth
  documenting for future readers.
