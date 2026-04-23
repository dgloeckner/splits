# FEAT-0001: Realtime Live View

- **Status**: Draft
- **Depends on**: INT-0001 (IPM serial protocol), INT-0002 (live-stream
  SSE API), FEAT-0002 (rower onboarding), FEAT-0007 (metrics
  catalogue), FEAT-0008 (visual design system)

## Summary

During an active rowing session, the PWA displays live metrics streamed from
the ergometer with sub-second latency. The display is optimised for a phone
placed on or near the ergometer — big digits, minimal chrome, glanceable
while rowing.

## User stories

- As a rower, I want to see my current **split (500 m pace)** in real time so
  I can pace myself.
- As a rower, I want to see **elapsed time** and **distance** so I know how
  far into the session I am.
- As a rower, I want to see **stroke rate (SPM)**, **power (W)** and **heart
  rate (bpm, if a belt is paired)** so I can gauge effort.
- As a rower, I want the live view to be the default screen after I open the
  app so I don't have to navigate during a warm-up.

## Reference

Authoritative visual prototype: Stitch project `16112355480769913997`
screens **"Live-Ansicht (Refined)"** and **"Live-Ansicht (Tablet Landscape)"**.
Design-system tokens (Space Grotesk, `#5dd7e4` primary, 72 px `display-lg`,
8 pt grid, 12 px card radius) are defined in FEAT-0008.

## Hero-Block (fixed, not configurable)

The top region of the live view is a non-configurable hero block that every
rower sees identically. Only the tile grid below it (FEAT-0001a) is user-
customisable.

- **Split** as the dominant hero number — 72 px, mono-digit, accent colour.
- Secondary row directly under the split: **Zeit** (elapsed time),
  **Distanz**, **SPM**, **Watt** — smaller mono-digits, equal weight.
- **Stroke-pulse indicator**: a small dot/ring that pulses on every detected
  stroke. Confirms the live data stream at a glance, independent of whether
  metric values happen to be changing.

## Acceptance criteria

- [ ] Live updates visible within ≤ 1 second of stroke events on the
      console (transport: SSE, see INT-0002).
- [ ] Hero block always renders split, Zeit, Distanz, SPM, Watt. Hero
      layout and metric set are not user-configurable.
- [ ] Split is rendered at 72 px with mono-digits on phone portrait;
      secondary row mono-digits too, visibly smaller but still readable
      at 1 m arm's length.
- [ ] Stroke-pulse indicator animates on every stroke event; when no
      strokes arrive for > 3 s the pulse decays to an idle state
      (without hiding, so the user still sees the stream is connected).
- [ ] Calories/hour, level, and heart rate are available via the
      customisable tile grid (FEAT-0001a), not in the hero. Heart rate
      lands once HR capture is implemented (see INT-0001 open questions).
- [ ] Reconnects automatically when Wi-Fi blips. No user action
      required. Missed strokes are replayed from the server ring buffer
      via `Last-Event-ID` (INT-0002).
- [ ] Second device joining mid-session sees the session-in-progress
      (shared fan-out — everyone watches the same ergo).
- [ ] When no session is active, the view shows a clear "waiting for
      ergo" state, not stale data.
- [ ] Tapping anywhere does **not** navigate away by accident (no
      hidden tap targets behind the digits).
- [ ] UI copy is German throughout the live view
      (`Split`, `Zeit`, `Distanz`, `SPM`, `Watt`, …).

## UX notes

Design language: **dark mode, sport-instrument aesthetic**. 8 pt grid,
12 px corner radius, mono-digits for all numeric values. No gamification
chrome (no badges, confetti, streak counters) on the live view — this
screen is for measuring, not motivating. Motivational surfaces belong
in post-session and profile views.

Biggest typography is reserved for **split** — it's what rowers stare
at. Zeit + Distanz + SPM + Watt in the secondary row follow with equal
weight. A thin status strip at the top confirms the connection.

Light mode is available per FEAT-0008 but dark is the default and the
design target; light mode is a legibility fallback, not a co-equal theme.

Responsive behaviour per FEAT-0008: single-column hero + 2×3 tile grid
on phones (see FEAT-0001a), wider hero with side-by-side secondary row
and expanded tile grid on tablet landscape and desktop.

## Non-goals

- Historical charts during the live session (later, or in a drawer)
- Manual stroke entry
- Workout programs / structured intervals (see FEAT-0005a)
- User-customisable hero metrics — customisation lives in the tile grid
  below the hero, see FEAT-0001a
- Gamification chrome on the live view (badges, streaks, confetti)

## Open questions

- ~~WebSocket vs SSE vs polling?~~ **Resolved**: SSE. See INT-0002 for
  wire-format and replay semantics.
- ~~Second-device behaviour?~~ **Resolved**: shared fan-out. Any paired
  device on the household LAN can open the stream and watch live.
- Minimum Tier-2 metric set for the first-render? Probably split, SPM,
  watts, distance, time — but the full Tier-2 payload arrives with
  every stroke, so this is a frontend layout question, not a data
  question.
