# ADR-0002: PWA over Native Apps

- **Status**: Accepted
- **Date**: 2026-04-19

## Context

The primary client is a phone placed on or next to the ergometer during a
workout. We need to decide whether to build native iOS / Android apps, a
cross-platform framework (Flutter, React Native, Capacitor), or a
Progressive Web App.

A hard user requirement is that installation must **not** go through an app
store.

## Options considered

### Option A — Native iOS + Android

Pros: Best platform integration, smoothest UX, full access to BLE / sensors.

Cons: Two codebases; App Store and Play Store distribution required for
normal install flows; code signing, developer accounts, yearly fees for
iOS. Rules out the "no app store" requirement unless we sideload — which is
friction-heavy on iOS (TestFlight, AltStore) and a support nightmare for
household members.

### Option B — Cross-platform (Flutter / React Native / Capacitor)

Pros: Single codebase. Capacitor can wrap a web app.

Cons: Still needs app stores for comfortable install. All the native
downsides without the full upside.

### Option C — Progressive Web App (PWA)

Pros: Install via "Add to Home Screen" (both iOS Safari and Android
Chrome); no store, no signing, no developer fees; one codebase reusable as
a desktop webapp; service worker gives offline shell; WebSocket gives
real-time data.

Cons: No native BLE on iOS (Web Bluetooth is Chromium-only, and we don't
need it anyway — BLE pairing happens on the backend/Pi); iOS PWA support
has historic quirks (improved substantially since iOS 16.4).

### Option D — Plain web app, no installability

Pros: Dead simple.

Cons: Browser chrome wastes screen real estate on a phone; users have to
remember a URL; no offline shell; feels unpolished.

## Decision

**Build a PWA.** Target iOS Safari 16.4+ and recent Android Chrome as the
supported install platforms.

## Consequences

- Must ship a valid Web App Manifest and a service worker with a
  well-defined update strategy (see FEAT-0006).
- HTTPS is required for install on mobile — see ADR-0006 (TLS strategy).
- No platform store review, no app signing, deploys in seconds.
- The frontend is also usable as a regular desktop browser app with no
  additional work.
- Push notifications are available on both platforms but not used in v1
  (iOS support is recent and patchy; we can add later).
