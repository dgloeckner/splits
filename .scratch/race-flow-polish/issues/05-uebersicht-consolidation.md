# 0015-05 — ConfirmScreen → Übersicht consolidation

Status: ready-for-agent

- **Type**: AFK
- **Parent**: [PRD-0015](../PRD.md)

## What to build

The current pre-race flow exposes too many screens, with a name collision
between the configuration ConfirmScreen (header reads "Bereit") and the
separately-named BereitScreen introduced by PRD-0014. The opponent toggles
also live on a separate sheet (`500 m Rennen` with "Synthetischer Geist
nach Härte" and "Bestzeit" checkboxes) that pops over a blurred Confirm,
adding an avoidable modal.

Consolidate the race configuration flow:

- Rename the ConfirmScreen header from **"Bereit"** to **"Übersicht"** for
  race mode (non-race retains its current header — investigate whether
  the collision exists there, and if so, scope the rename appropriately).
- Inline the opponent toggles (synth-ghost-by-intensity, PB) directly on
  the Übersicht screen.
- Remove the standalone "500 m Rennen" opponent picker sheet.
- When synth-ghost is toggled off, render an inline note
  *"Intensität wirkt sich nicht aus."* — informational only, no state
  change.
- Preserve selection-passing through Start → BereitScreen and
  `Erneut rennen` (the BereitScreen summary line and the lifecycle
  reducer's opponent config must continue to reflect the user's
  toggles).
- Step numbering: the pickers keep `1/2` and `2/2`; Übersicht and
  BereitScreen remain unnumbered.

## Acceptance criteria

- [ ] In race mode, the ConfirmScreen header reads **"Übersicht"** (or equivalent localised label) — the word "Bereit" no longer appears on this screen.
- [ ] The opponent toggles (synth-ghost-by-intensity, PB) render inline on Übersicht; no separate sheet appears.
- [ ] Toggling synth-ghost off renders the *"Intensität wirkt sich nicht aus."* note inline; toggling it back on removes the note.
- [ ] Tapping Start navigates to BereitScreen with the toggled selection preserved (BereitScreen summary line reflects the selection).
- [ ] `Erneut rennen` continues to land on BereitScreen with the prior selection preserved (regression: PRD-0014 / 0014-07 behaviour).
- [ ] No regression in non-race ConfirmScreen behaviour.
- [ ] Step `1/2` and `2/2` numbering remains only on the two picker screens; Übersicht and BereitScreen carry no step indicator.
- [ ] Component test for Übersicht covers: race-mode header text, inline opponent toggles, the "Intensität wirkt sich nicht aus." note appearing/disappearing on toggle, Start → BereitScreen with preserved selection.
- [ ] The separate opponent picker sheet is removed (or no longer mounted in the race flow) — assert in test that it does not appear after Start.

## Blocked by

None — can start immediately.
