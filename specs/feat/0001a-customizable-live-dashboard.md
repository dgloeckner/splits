# FEAT-0001a: Customizable Live Dashboard

- **Status**: Shipped
- **Depends on**: FEAT-0001 (Live View hero), FEAT-0002 (user profiles),
  FEAT-0007 (metrics catalogue), FEAT-0008 (design system)

## Reference

Authoritative visual prototype: Stitch project `16112355480769913997`
screens **"Live-Ansicht (Edit Mode)"**, **"Live-Ansicht (Edit Mode +
Picker Link)"**, and **"Tile-Picker Modal"** / **"Tile-Picker Modal
(Linked)"**.

## Summary

Under the fixed hero block of the live view (FEAT-0001), a user-customisable
**2×3 tile grid** renders secondary metrics. The user picks which tile goes
where, per profile. The hero stays identical for everyone; only the grid
is personal.

## User stories

- As a rower, I want to choose **which metrics I see below the hero** so
  the live view matches how I actually train.
- As a rower with a steady-state focus, I want **sparklines** for split
  and watts to see drift over the last minute.
- As a rower with a technique focus, I want **DPS** and **SPI** tiles
  to watch power-per-stroke and efficiency.
- As a rower with a heart-rate belt, I want a **zone badge** (Z1–Z5) so
  I can train in the prescribed zone without reading a number.
- As a rower, I want my tile choice to **persist across sessions** and
  to be **locked during a session** so I don't fumble with it mid-row.

## Tile catalogue

The canonical index of tiles present in the Stitch prototype (labels,
types, values, subtitles) lives in
[`0001a-tile-catalogue.md`](0001a-tile-catalogue.md). Keep the
catalogue in sync with the Stitch screens; this spec references it
instead of listing every tile inline.

## Gated tiles (source-dependent)

Some tiles require an external data source to render. When that
source is **not** available, the tile still appears in the picker but
as **visually disabled**:

- 60 % opacity, not selectable.
- Small info icon next to the label.
- Info-tooltip: *"Herzfrequenzgurt erforderlich — siehe Einstellungen"*
  (or source-specific equivalent).
- Tap opens the corresponding pairing / setup flow (e.g. Settings →
  HR-Gurt-Pairing — v2 scope).

### HR-gated tiles (require a paired HR source)

- **HF (Puls)** — Numeric; current bpm.
- **HF-Zone** — Zone Badge; Z1–Z5 based on the user's max-HR.
- **HF-Verlauf** — Sparkline; rolling 2–5 min HR series.

**HR source** in v1: (a) IPM-frame field `[24:25]` *if* that byte is
confirmed as HR by INT-0001 capture work, or (b) a separate BLE HR
belt (e.g. Polar H10) ingested via the backend. The tile treats both
sources identically; provenance is a backend concern.

**max-HR missing**: if HR data is flowing but the user has not
recorded a max-HR in their profile, `HF-Zone` renders a prompt
*"max-HR setzen"* linking to the profile, instead of a Z1–Z5 badge.

## Tile types

- **Numeric Tile** — large mono-digit number. Optional trend arrow
  (e.g. SPI trending up/down vs session average). Optional adaptive
  colour coding against a target zone (e.g. DPS inside / outside
  target band).
- **Sparkline Tile** — 60 s rolling window. Accent-coloured line for
  the live series, a dashed muted "ghost" line for the session average
  of the same metric.
- **Zone Badge Tile** — Z1–Z5 zone label with colour coding applied
  **only to the label/border**, not as a full-bleed background. Keeps
  the grid visually calm.

## Default layout (new users)

```
Row 1:  [Split-Sparkline]   [DPS]        [Ø Split]
Row 2:  [Watt-Sparkline]    [SPI]        [HF-Zone]
```

## Interaction

- **Long-press** on any tile opens the Tile-Picker:
  - **Phone** → bottom-sheet
  - **Tablet / desktop** → centred modal
- Tile-Picker is organised into three categories:
  - **Zahlen** (numeric tiles)
  - **Verläufe** (sparkline tiles)
  - **Bewertung** (zone badges, trend evaluations)
- Each picker entry shows a **live mini-preview** of the tile with
  example data, not just a name.
- Tap an entry to select; the sheet/modal closes and the tile swaps.
- Swipe-down / Esc / backdrop-tap dismisses without changes.

## Acceptance criteria

- [ ] 2×3 grid renders directly below the FEAT-0001 hero block on phone
      portrait; grid expands (3×3 or 2×4 per FEAT-0008) on tablet / desktop.
- [ ] Default tile layout for new users matches the block above.
- [ ] Long-press on any tile opens the Tile-Picker; short-tap on a tile
      does **not** open the picker (avoids accidental edits mid-row).
- [ ] Tile-Picker shows a live preview per entry driven by the current
      SSE stream (or canned example data when no session is active).
- [ ] Tile choices persist per user profile and survive reload / reinstall.
- [ ] **Edit-lock during sessions**: once a session is active, long-press
      on a tile shows a disabled state with a hint ("Nur zwischen Sessions
      editierbar"), not the picker.
- [ ] Sparkline rolling window is 60 s, accent-coloured live line plus a
      dashed muted session-average ghost line in the same tile.
- [ ] Zone Badge colour is applied to the label/border only, not the full
      tile background.
- [ ] Available metrics in the picker are sourced from FEAT-0007 (Rowing
      Metrics Catalogue); no hardcoded metric list in the UI.
- [ ] All tile labels and picker category headings are in German.

## UX notes

- Consistent with FEAT-0001: dark mode, sport-instrument look, 8 pt grid,
  12 px radius, mono-digits for numeric values.
- Tiles are visually lighter than the hero — subtler background, smaller
  digits — so the hero stays dominant.
- Trend arrow and adaptive-colour rules live in FEAT-0007 per metric
  (target zones, band widths), not in the live view.
- "Long-press to edit" is discoverable via a one-time tooltip on first
  app open (dismissable, not repeated).

## Non-goals

- Arbitrary grid sizes or drag-and-drop reordering — the 2×3 (phone)
  layout and fixed cell positions are deliberate constraints.
- Per-session tile overrides ("for today only") — profile-level only.
- Custom tile types beyond the three above in this iteration.
- Sharing tile layouts between users.

## Open questions

- **Picker categories vs flat list.** This spec describes three
  categories (`Zahlen` / `Verläufe` / `Bewertung`); the current
  Stitch prototype renders a **single flat list** under `METRIK
  WÄHLEN`. Resolve by adding category headers to the mock, or drop
  the categories from this spec in favour of the flat list.
- **Coverage gap in the picker.** `Ø Split` and `HF-Zone` appear in
  the Edit-Mode grid but have no picker entries yet — see the tile
  catalogue. Both must be addable before shipping. `HF-Verlauf` also
  needs a picker entry once HR ingestion is wired.
- Sparkline Y-scale: auto-fit to the 60 s window, or fixed to metric-
  typical ranges? Auto-fit reads better; fixed is easier to compare.
- Tile-Picker while the hero stream is live: do we freeze the hero
  behind the bottom-sheet, or keep it updating? Leaning toward keeping
  it updating so the rower doesn't lose their pace.
- How many tiles can a metric occupy simultaneously? E.g. is "Split as
  numeric" **and** "Split as sparkline" allowed in the same grid?
  Probably yes — different views of the same signal are useful.
- Do we expose tile-ordering explicitly (row/col positions), or infer
  from the order the user picks?
