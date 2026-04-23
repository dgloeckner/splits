# FEAT-0003a: Enhanced History & Trends

- **Status**: Draft
- **Depends on**: FEAT-0003 (Session History), FEAT-0004 (Per-User Statistics),
  FEAT-0005 (Training Goals), FEAT-0007 (Metrics Catalogue),
  FEAT-0008 (Design System)

## Reference

Authoritative visual prototype: Stitch project `16112355480769913997`
screens **"Historie: Sessions Liste (Refined)"**, **"Historie: Trends
(Refined)"**, **"Sitzungs-Details"**, **"Sitzungs-Details (Deep Dive)"**,
and the tablet variants.

## Summary

The Historie tab gains two sub-tabs: **Sessions** (a richer list + detail view
on top of FEAT-0003) and **Trends** (aggregations across the filtered set).
Turns raw history into something a user browses for insight, not just to
find a single session.

## User stories

- As a rower, I want to **filter** my session list by user, time range,
  distance, and intensity, and see aggregates for the filtered set.
- As a rower, I want every session card to show a **shape-at-a-glance
  split-sparkline** plus the metrics I actually care about, without
  opening the detail.
- As a rower, I want a rich **session-detail screen** with stacked charts
  and a per-500 m splits table so I can dissect a past row.
- As a rower, I want a **Trends sub-tab** with volume, regularity,
  performance, and efficiency views over weeks / months / year.
- As a new user, I want the Trends sub-tab to tell me **why it's empty**
  when I don't yet have enough sessions for meaningful aggregates.

## Sub-tab: Sessions

Replaces the plain list described in FEAT-0003 with a filterable, richer list.

### List view

- **Filter-Chips**: User · Zeitraum · Distanz · Intensität. Multiple chips
  combine with AND. Active filters are pinned and clearable.
- **Summary-Strip** (above the list) with aggregates for the currently
  filtered set: Sessions, Gesamt-Distanz, Gesamt-Zeit, Ø Split.
- **Session-Cards**:
  - Inline **split-sparkline** (session shape at a glance)
  - Six **metric pills** (date, distance, time, Ø split, Ø SPM, Ø watts)
  - Optional **PB-Badge** if the session contains any PB-qualifying effort
    (sourced from FEAT-0004 PB calculations)
- **Infinite scroll** (not pagination) through the filtered set.
- **Long-press** on a card opens a context menu:
  - Löschen (with soft-delete per FEAT-0003)
  - Exportieren (CSV v1, FIT/TCX stretch per FEAT-0003)
  - Als Ziel-Split setzen (pipes the session's average split into
    FEAT-0005a's Ziel-Split default for the next workout)

### Session-Detail screen

Pushed onto the nav stack on card tap. Not a modal — users can swipe back.

- **Hero-Summary**: large Distanz + Zeit on the left, four key averages
  (Ø Split, Ø SPM, Ø Watt, Ø HF) on the right.
- **Four stacked charts** in order:
  - Split-Verlauf
  - Watt
  - SPM
  - HF (rendered only when HR data exists; zone bands as background per
    FEAT-0007)
- **Derived-Metrics-Strip** between charts: Ø DPS, Ø SPI, Konsistenz
  (e.g. stddev of split), Gesamt-Schläge.
- **Splits-Tabelle** per 500 m with the fastest split row highlighted.
- **Optional user note** as a block-quote at the bottom (plain text,
  editable post hoc per FEAT-0003).
- **Ribbon-Badge** at the top of the hero when this session set a new PB
  (see FEAT-0004 for the trigger / copy).

## Sub-tab: Trends

Aggregations across the **currently selected range**. Range is the only
filter shared with the Sessions sub-tab; other filters reset.

### Range-Selector

Wochen · Monate · Jahr · Alles. **Default: Monate**. Selection persists
per user profile.

### Layout (top to bottom)

- **Drei Headline-Tiles** with **delta vs. previous period**:
  Gesamt-Distanz, Sessions, Ø Split. Delta uses accent colour for
  improvement, muted for regression — no red/green that conflates with
  zone colours.
- **Volumen-Chart**: stacked bars, one bar per range bucket, segmented
  by **intensity (SPM bands)** from FEAT-0007.
- **Regelmäßigkeit-Heatmap**: GitHub-contribution-style grid, but using
  the design-system accent colour ramp instead of green. Streak numbers
  (aktuell / Rekord) sit below the heatmap.
- **Leistungs-Trend**: multi-series line chart, one series per standard
  distance (500 m, 1 k, 2 k, 5 k, 6 k, 10 k). Series toggleable via
  **Legend-Chips**; chips show the latest PB time.
- **Effizienz-Dualchart**: DPS and SPI over time on the same axis, each
  with a **14-day rolling average** overlaid as a heavier line.
- **Milestones-Strip**: auto-detected milestones as horizontally
  scrollable pills (first 10 k, 100 total sessions, sub-2:00 split, etc.).
  Definitions live in FEAT-0004.
- **Goals-Progress-Section**: progress bars for active goals with a
  deep-link to the full goals view (FEAT-0005).

### Empty state

When the user has **< 10 sessions**, the Trends sub-tab renders a
prominent empty state instead of tiny charts:

> **Noch nicht genug Daten für Trends**

Below the headline, a progress indicator ("7 / 10 Sessions") makes it
clear what unlocks the view. Individual tiles that *can* render useful
data (e.g. the regularity heatmap) stay visible; the aggregation charts
stay hidden.

## Acceptance criteria

- [ ] Historie tab has two sub-tabs (`Sessions`, `Trends`), default
      `Sessions`.
- [ ] Filter-Chips combine with AND; clearing a chip updates list +
      summary-strip atomically.
- [ ] Summary-Strip values reflect only the filtered set, not the
      global corpus.
- [ ] Session-Card sparkline uses the session's sample series at the
      resolution stored by FEAT-0003 (no ad-hoc re-interpolation).
- [ ] PB-Badge on the card appears iff the session contributed at least
      one PB across the six standard distances (per FEAT-0004).
- [ ] Long-press opens the context menu; short-tap pushes Session-Detail.
- [ ] Session-Detail renders all four charts even if one series is
      sparse; HF chart is **hidden** (not empty) when no HR data exists.
- [ ] Splits-Tabelle highlights exactly one row (the fastest 500 m);
      ties resolve to the earliest occurrence.
- [ ] Trends Range-Selector persists per user profile and survives reload.
- [ ] Headline-Tiles show delta against the immediately preceding period
      of the same length; previous-period with no data renders as "—",
      not "0 %".
- [ ] Volumen-Chart intensity bands are sourced from FEAT-0007 SPM bands,
      not hardcoded.
- [ ] Heatmap uses design-system accent ramp, not green.
- [ ] Leistungs-Trend legend chips toggle visibility; at least one
      series must remain visible (can't hide all).
- [ ] Effizienz rolling-average uses a 14-day trailing window, clamped
      at the range start.
- [ ] Empty-state shows when the user has fewer than 10 sessions;
      individual non-aggregate tiles (regularity, milestones) remain
      visible when they have any data.
- [ ] All copy in German.

## UX notes

- Consistent with FEAT-0001 / FEAT-0008: dark mode, mono-digits for
  numbers, sport-instrument aesthetic.
- Charts use the shared chart primitives (to be defined in FEAT-0008);
  no per-screen styling drift.
- Session-Detail is a push route, not a modal — enables deep-linking
  and back-swipe.
- Infinite scroll loads one page ahead of the viewport; scroll position
  is preserved across sub-tab switches.

## Non-goals

- Cross-user comparison in Trends (explicitly non-goal per FEAT-0004).
- Editing session metrics from the detail view (annotations only, per
  FEAT-0003).
- Cloud sync / sharing (out of scope, per FEAT-0003).
- Automatic "insight" text generation ("you're 5 % faster than last
  month") — charts speak for themselves; we don't ship an AI coach.

## Open questions

- Intensity filter: derive from Ø SPM bands, or from the Intensität
  tag set in FEAT-0005a, or both?
- Regularity heatmap: fixed to the last 52 weeks, or honour the
  Range-Selector? Fixed reads better; range-linked is more consistent.
- "Als Ziel-Split setzen": remember for the next workout only, or
  until the user changes it explicitly?
- Milestone definitions: static list vs. admin-editable catalogue.
  Static is fine for v1.
- Trends charts under "Wochen" range may be too sparse (≤ 7 buckets);
  hide delta tiles in that case, or keep them and live with noise?
