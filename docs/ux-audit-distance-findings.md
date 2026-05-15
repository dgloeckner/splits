# UX/visual audit — distance flow

Method: Playwright drove the distance flow through 14 captured states ×
2 viewports (phone 390×844, tablet 820×1180). Captures and layout
JSON sidecars under `test-results/ux-audit/distance/{phone,tablet}/`.
Heuristic checklist: `docs/ux-audit-heuristics.md`.

Re-run of the pilot — fixes from the prior pass are verified below;
ten new (or persisting) findings recorded under F1–F10.

---

## What's clean (verifies prior fixes)

- **Step indicator is now consistent across the flow.** All of
  `02-step2-presets`, `06-step3-intensity`, `07-confirm-5km` show the
  same 3-segment progress bar with `n / 3` counter. Prior F1 fixed.
- **Eigene custom-distance label survives Step2 → Confirm as "3.5 km".**
  `10-confirm-eigene-3500.png` reads "3.5 km · Moderat" — the
  `Step2Dimension` vs `ConfirmScreen` formatter divergence from prior
  F3 is resolved.
- **Stepper at min/max renders disabled cue.** `04-step2-eigene-min`
  shows "−" in faded outline at 500 m; `05-step2-eigene-max` shows
  "+" faded at the cap. Prior F6 fixed.
- **Back-button label is uniform "Zurück" / `←` across Step2, Step3
  and Confirm.** No "Anpassen" drift. Prior F7 fixed.
- **All-out intensity card is fully visible above the fold on phone.**
  `06-step3-intensity.png` (390×844) shows all four cards. Prior F10
  fixed.
- **Trends empty state offers a next action.** `15-history-empty-trends`
  shows the "Zeitraum erweitern → Jahr" pill. Prior F9 addressed.
- **SessionEndedOverlay primary CTA is "Details ansehen", secondary
  "Fertig".** `13-live-work.png` accidentally captured the overlay and
  confirms the new layout.

---

## Findings

### F1 — Eigene stepper value overlaps the "−" button at 2-digit km

- **Where:** `phone/05-step2-eigene-max.png`,
  `tablet/05-step2-eigene-max.png` (both viewports).
- **Heuristic violated:** #11 — overlapping UI elements.
- **Observation:** At the max value the centred value text "10 km"
  visibly sits on top of the right edge of the "−" button: the "1"
  glyph clips into the disabled-state minus button. Caused by the
  three-column row (`−  value  +`) shrinking gaps so the value's
  bounding box collides with the button when the value reaches its
  widest rendering ("10 km").
- **Suggested fix:** give the centre value a min-width or fixed
  column, or increase the row's column gap so the value box can
  never cross into the button boxes. The phone view is worse but
  both viewports show the same root cause.

### F2 — Eigene chip stays grey when the panel opens at the default

- **Where:** `phone/03-step2-eigene-default.png`,
  `tablet/03-step2-eigene-default.png` (both).
- **Heuristic violated:** #4 state legibility, #6 affordance honesty.
- **Observation:** Tapping "Eigene" opens the inline stepper panel at
  3 km, but the "Eigene" chip itself stays the same neutral grey as
  the unselected preset chips. Only after a +/− interaction (see 04
  and 05) does the chip turn teal-selected. So when the user opens
  the panel, the screen shows seven greyed chips and a panel below —
  nothing communicates "Eigene is your current choice."
- **Suggested fix:** mark the Eigene chip selected as soon as the
  panel opens, matching the visual selection state already used for
  preset chips on the same row.

### F3 — Eigene max is capped at 10 km — identical to the largest preset

- **Where:** `phone/05-step2-eigene-max.png`,
  `tablet/05-step2-eigene-max.png`.
- **Heuristic violated:** #9 bounds + guardrails (over-restrictive
  rather than under-restrictive).
- **Observation:** The spec presses "+" 200 times and the value
  stops at "10 km" — the same value as the rightmost preset chip on
  the row. So the "Eigene" affordance can never produce a distance
  the preset row doesn't already offer; it's only useful between
  500 m and 10 km in non-preset increments. A household rower
  wanting 12 km or 8 500 m has no path.
- **Suggested fix:** raise the Eigene ceiling (e.g. 21 097 m
  matching HM, or at least 20 km) so Eigene fills the role the name
  promises. If 10 km really is the intended product ceiling, then
  Eigene's purpose is only "off-preset increments below 10 km" and
  the labelling/affordance should make that clear.

### F4 — PhaseCountdownView extends under the bottom nav

- **Where:** `phone/12-live-warmup-countdown.png`.
- **Heuristic violated:** #11 overlapping UI elements (real cross-
  component overlap — not the modal-stack false positive on capture
  13).
- **Observation:** Sidecar JSON reports `phase-countdown`
  intersecting `nav._nav … a._link…` by 103×47 px. The visible PNG
  doesn't show clipping because the 5:00 numerals are vertically
  centred, but the tap area for the countdown's lower region
  overlaps the Workout nav link's hit area. On a smaller phone or
  with a larger glyph rendering, this becomes visible clipping.
- **Suggested fix:** reserve bottom-nav height in the PhaseCountdown
  page layout (give the page a `padding-bottom` equal to nav
  height, or render the countdown inside the same safe-area as the
  rest of the flow).

### F5 — SessionEndedOverlay shows all-zero summary while still computing

- **Where:** `phone/13-live-work.png`, `tablet/13-live-work.png`
  (both — the spec accidentally captured the overlay rather than the
  work view, but it surfaced a real defect).
- **Heuristic violated:** #4 state legibility, #5 live values don't
  lie.
- **Observation:** The "Session beendet" modal renders subtitle
  "Bestleistungen werden berechnet …" alongside DISTANZ "0 m", ZEIT
  "0:00", Ø SPLIT "—", SCHLÄGE "0". The subtitle says "loading", but
  the four big numbers show as if the session was empty — and the
  primary CTA "Details ansehen" is fully active. A user reading the
  modal first sees "your session: 0 m, 0:00, 0 strokes."
- **Suggested fix:** while the summary is being computed, replace
  the four numbers with the same placeholder treatment the live
  dashboard uses (e.g. "—" or a pulsing skeleton), or hide the
  numbers row entirely until the values arrive. Don't render numeric
  zeros that the user will read as their real result.

### F6 — Tablet layout is phone-scaled (full-width rows, vast empty space)

- **Where:** `tablet/01-home.png`, `tablet/02-step2-presets.png`,
  `tablet/06-step3-intensity.png`, `tablet/07-confirm-5km.png`,
  `tablet/10-confirm-eigene-3500.png`,
  `tablet/11-confirm-no-warmup-cooldown.png`.
- **Heuristic violated:** #12 broken responsive layout (in the
  "doesn't adapt" sense — nothing overflows, but the content
  density on the larger viewport is unbroken from phone), #13 uneven
  whitespace.
- **Observation:** Every flow screen on tablet renders the same
  single-column phone layout stretched to 820 px wide. Mode picker
  cards, distance presets, intensity cards and confirm rows all
  occupy the full content width with small text clusters in their
  upper-left. The remaining 60 %+ of vertical space is empty. The
  layout-audit threshold for whitespace doesn't fire because the
  empty space is at the page bottom (after the last section), but
  the visual impression is "this screen was designed for a phone
  and lazily upscaled."
- **Suggested fix:** introduce tablet breakpoints. Concretely:
  cap form/picker max-width (e.g. 560 px) and centre, or switch
  multi-card lists (intensity, presets) to 2- or 3-column grids on
  ≥ 768 px. Confirm screen is the highest-leverage candidate —
  warmup + cooldown could sit side-by-side.

### F7 — Home: "Nur rudern" card visually reads as "currently selected"

- **Where:** `phone/01-home.png`, `tablet/01-home.png`.
- **Heuristic violated:** #4 state legibility, #7 cross-mode
  consistency (visual-language collision).
- **Observation:** The Home mode picker stacks five items: a teal-
  filled "Nur rudern" card with a subtitle, then four uniform grey
  cards (DISTANZ / ZEIT / INTERVALLE / RENNEN). Elsewhere in the
  app (Step2 presets, Trends range pills, bottom nav active state),
  teal fill ≡ "this is the currently selected option." On Home the
  teal card is a sibling mode, not a selection. A new user may
  conclude they've already picked a mode and the next tap is
  "confirm." The subtitle "Schnellstart ohne Ziel" — only present on
  this card — reinforces the impression of a recommended action.
- **Suggested fix:** disambiguate. Either drop the teal fill and
  treat all five modes as uniform options (with an icon difference
  only), or keep the visual emphasis but change its semantic by
  styling it explicitly as a CTA (e.g. button-style with a chevron)
  rather than a chip-style filled card.

### F8 — Rekorde empty state lacks the next-action CTA Trends has

- **Where:** `phone/16-history-empty-rekorde.png`,
  `tablet/16-history-empty-rekorde.png`.
- **Heuristic violated:** #4 state legibility, #7 cross-mode
  consistency.
- **Observation:** `15-history-empty-trends` offers a tappable pill
  ("Zeitraum erweitern → Jahr") under the empty copy. The sibling
  Rekorde tab shows the same flavour of empty state ("Noch keine
  Bestleistungen. Starte ein Workout.") but only as plain copy —
  the imperative "Starte ein Workout" is not actionable. Two tabs
  in the same Historie shell, two different empty-state patterns.
- **Suggested fix:** match the Trends pattern: render "Workout
  starten" (or similar) as a tappable pill that navigates to Home.
  Same shape as the Trends widen-range CTA so the two tabs read
  consistently.

### F9 — Phase progress bar uses dashed borders for inactive phases

- **Where:** `phone/12-live-warmup-countdown.png`,
  `tablet/12-live-warmup-countdown.png`.
- **Heuristic violated:** #4 state legibility.
- **Observation:** The phase plan strip at the top of the
  PhaseCountdownView renders the upcoming/past phase segments as
  dashed-outline boxes while the active phase is a solid teal bar.
  The dashed style reads as "unfinished CSS" or "placeholder" more
  than "this phase hasn't happened yet." Dashed strokes also imply
  "selectable / editable" in many design systems (think dashed
  drag-target borders), which the segments aren't.
- **Suggested fix:** swap the dashed style for solid-but-muted
  (e.g. low-opacity grey fill) so the inactive segments read as
  *not yet active*, not *broken*. Keep the active segment in solid
  teal so the contrast still parses.

### F11 — Confirm Warm-up / Cool-down labels break mid-word on phone

- **Where:** `phone/07-confirm-5km.png`,
  `phone/10-confirm-eigene-3500.png` (phone only).
- **Heuristic violated:** #12 broken responsive layout.
- **Observation:** Inside each `toggleRow` the label column gets
  squeezed by the stepper to the right (− 36 + value 28 + "min" + 36
  + 3×gap-2) and the labels wrap mid-word at their hyphen: "Warm-" /
  "up" and "Cool-" / "down". Missed on the first pass — I walked
  past it and only logged the unlabelled phase-preview bar (F10).
- **Suggested fix:** keep the label `white-space: nowrap` and tighten
  the stepper natural width (smaller buttons, smaller inter-column
  gap, `flex-shrink: 0` so the stepper doesn't push past the row)
  so the toggle keeps its content width on a 390-px viewport.

### F10 — Confirm phase-preview bar (dark/teal/dark) has no label

- **Where:** `phone/07-confirm-5km.png`,
  `phone/10-confirm-eigene-3500.png`, plus tablet equivalents.
- **Heuristic violated:** #4 state legibility, #10 reading order
  matches priority.
- **Observation:** Below the "5 km · Moderat" heading the Confirm
  screen renders a three-segment bar (dark · teal · dark) with no
  legend. The intent is presumably "warmup / work / cooldown" with
  proportions matching the configured minutes — but the user has
  no way to read that from the screen. When the user toggles
  warm-up and cool-down off (capture 11) the bar collapses to a
  single full-width teal bar — the visual change confirms the
  hypothesis but doesn't explain it. The element costs vertical
  space and adds nothing legible to a first-time user.
- **Suggested fix:** label the segments inline ("Aufwärmen 5 min",
  "Workout", "Cooldown 5 min") under each segment, or drop the
  visualisation in favour of the duration text that's already in
  the warmup/cooldown rows below.

---

## Captured artifacts

- `test-results/ux-audit/distance/phone/01..16-*.{png,layout.json}`
- `test-results/ux-audit/distance/tablet/01..16-*.{png,layout.json}`
- `web/tests/e2e/ux-audit/distance-capture.spec.ts`
