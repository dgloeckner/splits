# FEAT-0001a: Tile Catalogue (Stitch reference)

This is the canonical index of every tile that exists in the current
Stitch prototype of the Tile-Picker Modal and the Live-Ansicht edit
grid. It is a **derived artefact** — the prototype is authoritative;
this file is a read-off for implementers. Regenerate when the
prototype changes.

**Source screens (Stitch project `16112355480769913997`):**

- `1e95e8c6b4b9412d82a5b294cbd67f66` — "Tile-Picker Modal"
- `ced142ddf4c44189bd4126693ab26f82` — "Tile-Picker Modal (Linked)"
- `f9449b9d36c14422aede27002eaf397f` — "Live-Ansicht (Edit Mode + Picker Link)"
- `ebc6b909b1034e40ba464a299d832d67` — "Live-Ansicht (Edit Mode)"

## Picker structure (as built)

The Tile-Picker Modal in the current prototype is a **single flat
list** under a header `METRIK WÄHLEN`, preceded by a `AKTUELLE
AUSWAHL` card showing the tile currently assigned to the slot being
edited. There are **no sub-headings** (`Zahlen` / `Verläufe` /
`Bewertung`) in the prototype today — those categories are in
FEAT-0001a's narrative but have not yet been wired into the Stitch
mock. See *Open questions* in FEAT-0001a.

## Tile index

| Tile ID          | Label (DE)      | Type        | Value / unit                        | Subtitle (DE)                              | Notes                                       |
|------------------|-----------------|-------------|-------------------------------------|--------------------------------------------|---------------------------------------------|
| `zeit`           | Zeit            | Numeric     | `mm:ss.s`                           | —                                          | Live elapsed time (mirrors hero)             |
| `distanz`        | Distanz         | Numeric     | meters                              | —                                          | Mirrors hero                                 |
| `split`          | Split           | Numeric     | `mm:ss.s` / 500 m                   | *Zeit pro 500 m Intervall*                 | Mirrors hero                                 |
| `dps`            | DPS             | Numeric     | meters / stroke                     | *Distanz pro Schlag in Metern*             | Default selection shown in picker            |
| `spi`            | SPI             | Numeric     | unitless display (watts per SPM)     | —                                          | 5-stroke moving average live; session median. Edge cases: `spm=0` or `power_w<20` → `—`. Defined in FEAT-0007. |
| `watt-verlauf`   | Watt-Verlauf    | Sparkline   | 60 s rolling window of watts         | —                                          | `show_chart` icon in picker                  |
| `split-verlauf`  | Split-Verlauf   | Sparkline   | 60 s rolling window of split         | —                                          | `bar_chart` icon in picker — revisit         |
| `herzfrequenz`   | Herzfrequenz    | Numeric     | bpm                                  | *Aktuelle Herzfrequenz (BPM)*              | **Gated on HR source** (IPM field `[24:25]` or paired BLE belt). See FEAT-0001a *Gated tiles*. |
| `kalorien`       | Kalorien        | Numeric     | kcal/h (live)                        | *Energieverbrauch*                         | **Live-view tile binds to Tier 1 `cal_per_hr`, not session total.** Current Stitch subtitle "in kCal" is misleading — update to "Energieverbrauch (kcal/h)". Session-total kcal is a separate field used only on summary / history surfaces. |

### Tiles present in the Edit Mode grid but not yet exposed in the picker

| Tile ID      | Label (DE) | Type       | Example value  | Notes                                                              |
|--------------|------------|------------|----------------|--------------------------------------------------------------------|
| `oe-split`   | Ø Split    | Numeric    | `1:55.8`       | Session-average split (Tier 3 `avg_pace_sec_per_500m`).             |
| `hf-zone`    | HF-Zone    | Zone Badge | `Z3 · 142 bpm` | **Gated on HR.** Zone bands per FEAT-0007. Falls back to *max-HR setzen* prompt if HR flows but profile lacks max-HR. |

### Planned tiles not yet in picker or edit grid

| Tile ID       | Label (DE) | Type      | Notes                                                            |
|---------------|------------|-----------|------------------------------------------------------------------|
| `hf-verlauf`  | HF-Verlauf | Sparkline | **Gated on HR.** 2–5 min rolling window. Matches the Sparkline primitive. |

These tiles appear in the Live-Ansicht (Edit Mode) screen's 2×3 grid
but are not selectable from the current Tile-Picker Modal mock.
**Gap to close before M3 build.**

## Edit-Mode default grid (as mocked)

From `f9449b9d36c14422aede27002eaf397f`:

```
Row 1:  [ DPS ]           [ Ø Split ]   [ Watt-Verlauf ]
Row 2:  [ SPI ]           [ HF-Zone ]   [ Fertig-Button ]
```

`Fertig` occupies the 6th cell only while in edit mode — in normal
live view the 6th slot is a regular tile (the FEAT-0001a spec's
default targets `Split-Verlauf` here; the current Stitch mock has
not yet rendered this non-edit variant).

## Open questions (tile-level)

- Prototype picker is a flat list; FEAT-0001a narrative specifies
  three categories (`Zahlen` / `Verläufe` / `Bewertung`). Resolve by
  (a) adding category headers to the Stitch mock, or (b) dropping
  the categories from the spec in favour of a flat list.
- `Split-Verlauf` uses a `bar_chart` icon in the picker while
  `Watt-Verlauf` uses `show_chart`. Both are sparklines per the spec;
  icons should match the tile-type, not the metric.
- `Ø Split` and `HF-Zone` need picker entries, with adaptive-colour
  and zone-band configuration sourced from FEAT-0007.
- Do we expose `SPM` and `Level` (hero / secondary-row adjacents) as
  tiles too, or are they reserved for the hero only? `cal_per_hr` is
  already covered by the `kalorien` tile.
