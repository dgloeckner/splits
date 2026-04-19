# FEAT-0001: Realtime Live View

- **Status**: Draft
- **Depends on**: INT-0001 (IPM serial protocol), INT-0002 (live-stream
  SSE API), FEAT-0002 (rower onboarding), FEAT-0007 (metrics catalogue)

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

## Acceptance criteria

- [ ] Live updates visible within ≤ 1 second of stroke events on the
      console (transport: SSE, see INT-0002).
- [ ] Display shows at minimum: split, distance, elapsed time, SPM,
      watts, calories/hour, level. Heart rate once HR capture lands
      (see INT-0001 open questions).
- [ ] Layout is readable at 1 m arm's length on a phone in portrait
      mode.
- [ ] Reconnects automatically when Wi-Fi blips. No user action
      required. Missed strokes are replayed from the server ring buffer
      via `Last-Event-ID` (INT-0002).
- [ ] Second device joining mid-session sees the session-in-progress
      (shared fan-out — everyone watches the same ergo).
- [ ] When no session is active, the view shows a clear "waiting for
      ergo" state, not stale data.
- [ ] Tapping anywhere does **not** navigate away by accident (no
      hidden tap targets behind the digits).

## UX notes

Two-row grid, biggest typography reserved for **split** (it's what rowers
stare at). Secondary row: distance + time. Tertiary: SPM + W + HR. A thin
status strip at the top confirms the connection.

Dark mode by default (phones next to ergos are often in low light during
morning sessions).

## Non-goals

- Historical charts during the live session (later, or in a drawer)
- Manual stroke entry
- Workout programs / structured intervals (v2 scope)

## Open questions

- ~~WebSocket vs SSE vs polling?~~ **Resolved**: SSE. See INT-0002 for
  wire-format and replay semantics.
- ~~Second-device behaviour?~~ **Resolved**: shared fan-out. Any paired
  device on the household LAN can open the stream and watch live.
- Minimum Tier-2 metric set for the first-render? Probably split, SPM,
  watts, distance, time — but the full Tier-2 payload arrives with
  every stroke, so this is a frontend layout question, not a data
  question.
