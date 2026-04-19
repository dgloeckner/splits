# FEAT-0006: PWA Installability & Offline Shell

- **Status**: Draft

## Summary

The app is installable to the home screen on iOS and Android without going
through an app store. After first load, the UI shell works offline; only
live data and writes require connectivity to the local backend.

## User stories

- As a user, I want to add the app to my phone's home screen and launch it
  full-screen without browser chrome.
- As a user, I want the app to open instantly from the home screen even if
  Wi-Fi is flaky.
- As a user, I want past sessions to be viewable when I'm away from home and
  off the local network (stretch goal).

## Acceptance criteria

- [ ] Valid Web App Manifest with name, short_name, icons (multiple sizes
      including 512×512 maskable), display=standalone, theme + background
      colour.
- [ ] Service worker caches the app shell (HTML, JS, CSS, icons) on first
      visit.
- [ ] App shell loads from cache on subsequent visits even if the backend is
      unreachable.
- [ ] Live view cleanly degrades to "no connection" state when offline.
- [ ] Install prompt appears on Android Chrome after two engaged visits (or
      on manual trigger from a UI button).
- [ ] iOS Safari "Add to Home Screen" flow produces a standalone-display app
      with the correct icon and splash.
- [ ] Service worker updates itself without breaking existing sessions
      (skipWaiting strategy with a "reload to update" banner).

## UX notes

Subtle "Install app" button in settings after first visit for users who
won't see the automatic prompt. Link to short instructions for iOS (since
Apple doesn't support auto-prompting).

## Non-goals

- Web Push notifications (v2 — iOS 16.4+ only, quirky)
- Background sync of past sessions to the device (v2 stretch)
- Offline session **creation** — you can't row without the ergo anyway

## Open questions

- Cache past sessions for offline viewing from v1, or defer?
- Icon design — placeholder for now, proper design later.
