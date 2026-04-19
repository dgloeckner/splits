# FEAT-0006: PWA Installability & Offline Behaviour

- **Status**: Draft
- **Depends on**: FEAT-0008 (visual design system), FEAT-0003 (session
  history), ADR-0003 (tech stack)

## Summary

The app is installable to the home screen on iOS, Android, and desktop
without going through an app store. The UI shell works offline, and a
rolling window of recent session history is cached on the device so a
user can show a trainer their recent rows even off the home network.
Only live data and write actions require the local backend.

## User stories

- As a user, I want to add the app to my phone's home screen and launch
  it full-screen without browser chrome.
- As a user, I want the app to open instantly from the home screen even
  if Wi-Fi is flaky.
- As a user, I want to **show my trainer my recent rowing stats when
  I'm away from home and off the local network** — the last N sessions
  with their detail views, plus aggregated stats (totals, PBs, weekly
  trends) should be available offline on my personal device.
- As a user, I want the app to clearly indicate when I'm looking at
  cached data vs live data.

## Acceptance criteria

### Install

- [ ] Valid Web App Manifest with name, short_name, icons (multiple
      sizes including 512×512 maskable), display=standalone, theme +
      background colour matching FEAT-0008 light/dark tokens.
- [ ] Install prompt appears on Android Chrome after two engaged
      visits (or on manual trigger from a UI button).
- [ ] iOS Safari "Add to Home Screen" flow produces a standalone-display
      app with the correct icon and splash.
- [ ] Desktop Chrome/Edge install flow works the same way.

### Shell offline

- [ ] Service worker caches the app shell (HTML, JS, CSS, icons, fonts)
      on first visit.
- [ ] App shell loads from cache on subsequent visits even if the
      backend is unreachable.
- [ ] Live view cleanly degrades to a "no connection" state when offline
      and reconnects automatically when the backend returns.
- [ ] Service worker updates itself without breaking existing sessions
      (skipWaiting + "reload to update" banner).

### Data offline

- [ ] Session **detail** for the most recent **50 sessions** (or all
      sessions in the last 90 days, whichever is larger) is cached
      locally and viewable offline, per paired rower on the device.
- [ ] Session **list** for the same window is cached and browsable.
- [ ] **Per-user statistics** (PBs, lifetime totals, weekly/monthly
      roll-ups from FEAT-0004) are cached and viewable offline.
- [ ] Cached data persists across PWA reloads (IndexedDB-backed store).
- [ ] Cache populates automatically on every online visit; new
      sessions are added on-the-fly as the live SSE stream emits
      `session_end` events (INT-0002).
- [ ] Cache eviction is LRU past the retention window.
- [ ] A clear "Offline — showing cached data from …" indicator is
      shown in any view that is rendering from cache. Cached views are
      read-only; edit / delete buttons are disabled offline.
- [ ] Offline session **creation** is explicitly unsupported — you
      can't row without the ergo.

## UX notes

- Subtle "Install app" button in settings after first visit for users
  who won't see the automatic prompt. Link to short instructions for
  iOS (since Apple doesn't support auto-prompting).
- Offline indicator: a small pill in the top status strip, tinted with
  the `warning` token from FEAT-0008. On live view specifically, the
  "no connection" state is full-screen, non-dismissable, and tells the
  user what they're missing.
- Cache freshness: timestamp of "last synced" shown on list + detail
  views when offline.

## Non-goals

- Web Push notifications (v2 — iOS 16.4+ only, quirky).
- Background Sync API to write offline changes — there are no offline
  writes.
- Syncing across devices beyond what the single backend already serves.
- Offline-capable admin flows (rower creation, QR generation) — admin
  must be on the LAN.

## Open questions

- **Cache budget**: 50 sessions × ~200 strokes × ~150 B/event ≈ 1.5 MB
  per rower, well under any browser quota. Confirm during M4.
- **Authenticated offline access**: session cookie expires after 30
  days (ADR-0005). If expired while offline, the cached data is still
  viewable (read-only); any live action prompts a re-pair on reconnect.
- **IndexedDB schema**: expose session + stroke time series, or just
  pre-aggregated rollups offline? Lean toward full time series so
  charts render identically online and offline.
- **Icon design**: placeholder for now, proper icon pass with the
  FEAT-0008 palette later.
