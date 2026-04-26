# Move PBs from Profile to a new History → Rekorde tab

**Date:** 2026-04-26
**Status:** Design

## Problem

Information architecture is inconsistent. Trends (a derived stats artifact) lives under
History, but Personal Bests (also a derived stats artifact) live in Profile next to
identity fields (name, weight, height, color, BMI). Both PBs and Trends answer
stats-shaped questions about the active rower; only the trend half is currently in the
stats surface.

The split landed in the codebase before History gained tabs. PBs are not part of
identity — they are derived from session aggregates the same way trends are.

## Goals

- Profile = identity + housekeeping only (rower fields, BMI, Wartung).
- History = unified stats surface, tabbed: Sessions · Trends · Rekorde.
- Zero backend change. Same endpoints, same hooks.

## Non-goals

- Reworking PB content, layout, or visual design.
- Changing Wartung (storage / lifetime totals): stays in Profile per user decision.
- Adding new PB categories or aggregations.
- Reworking Trends or Sessions tabs.

## Design

### Routing

Add a third nested route under `/historie`:

| Path                  | Tab      | Component         |
| --------------------- | -------- | ----------------- |
| `/historie`           | Sessions | `SessionsTab`     |
| `/historie/trends`    | Trends   | `TrendsTab`       |
| `/historie/rekorde`   | Rekorde  | `RekordeTab` (new) |

`HistoryPage.tsx` adds a third `<NavLink to="/historie/rekorde">Rekorde</NavLink>` in
the existing subnav, matching the Sessions/Trends styling.

`AppRouter.tsx` adds the nested route alongside the existing two.

### Components

**New file:** `web/src/pages/history/RekordeTab.tsx`

Composes the existing PB sections, in order:
1. `DistanceGrid` (Persönliche Bestzeiten · Distanzen)
2. `WindowSection` (Bestleistungen · Fenster) — only if non-empty
3. `WorkoutSection` (Bestleistungen · Workouts) — only if non-empty
4. `ConsistencyCards` (Konstanz-Bestleistungen) — only if any consistency achievements
5. `MilestonesStrip` (Meilensteine) — only if any volume achievements

Empty state (no PBs at all): "Noch keine Bestleistungen. Starte ein Workout."

The tab reads the active rower via `useActiveRower` and the same three queries
currently in `PBSummary`: `getRowerPBs`, `getRowerLifetime` (only if needed by
sub-sections — see below), `getRowerAchievements`.

Lifetime is currently fetched by `PBSummary` only because `Wartung` consumes it.
After the move, `RekordeTab` does **not** need lifetime; only `Wartung` does.

**Section components:** the five sub-components currently defined inside
`PBSummary.tsx` move to dedicated files in `web/src/pages/history/rekorde/`:

- `DistanceGrid.tsx`
- `WindowSection.tsx`
- `WorkoutSection.tsx`
- `ConsistencyCards.tsx`
- `MilestonesStrip.tsx`

Helper functions used by these (`distanceLabel`, `windowLabel`, `windowValue`,
`modeLabel`, `milestoneLabel`, `formatShortDate`) move with their primary consumer
or to a shared `web/src/pages/history/rekorde/format.ts` if reused across files.

CSS module `PBSummary.module.css` is split:
- `RekordeTab.module.css` (or per-component modules) for the five sections.
- `Wartung.module.css` for the maintenance card.

**New file:** `web/src/pages/profile/Wartung.tsx`

Extracts the existing `Wartung` component verbatim, including its `useQueries`
sessions list call and its lifetime query. Profile renders it directly.

**Deleted:** `web/src/pages/profile/PBSummary.tsx` and `PBSummary.module.css`.
The composition lived only in this file; its sub-components all move.

### Profile changes

`ProfilePage.tsx`:
- Remove `import { PBSummary } from './profile/PBSummary'`.
- Remove `<PBSummary rowerID={activeRower.id} />` from the active-rower section.
- Add `<Wartung rowerID={activeRower.id} />` to the active-rower section, between
  `RowerEditor` and the bottom "Konto" section, so housekeeping stays grouped with
  account actions.

Profile no longer fetches `getRowerPBs` or `getRowerAchievements`. It still fetches
`getRowerLifetime` (via `Wartung`).

### Data layer

No backend changes. No new endpoints. No query-key changes.

The same React Query keys (`rower-pbs`, `rower-achievements`, `rower-lifetime`)
continue to work. Tab-switching back and forth between Trends, Sessions, and
Rekorde benefits from the cache.

### Tests

- **New:** `web/src/pages/history/RekordeTab.test.tsx` — covers what
  `PBSummary.test.tsx` covered for sections 1–5: rendering with full data,
  empty PB lists, distance grid placeholder dashes for missing distances.
- **New:** `web/src/pages/profile/Wartung.test.tsx` — minimal: renders session
  count and lifetime distance, kB/MB switch boundary.
- **Update:** `ProfilePage` test — assert Wartung is rendered, assert PB sections
  (`Persönliche Bestzeiten · Distanzen`, etc.) are **not** rendered on Profile.
- **Update:** `HistoryPage.test.tsx` — assert three tabs exist; `Rekorde` link is
  present and routes to `/historie/rekorde`.
- **Delete:** `PBSummary.test.tsx` (coverage migrated into `RekordeTab.test.tsx`).

### Empty states

| Scenario                                | Behavior                                              |
| --------------------------------------- | ----------------------------------------------------- |
| `getRowerPBs` pending                    | "Bestleistungen werden geladen …" (existing copy)     |
| All PB lists empty, no achievements      | "Noch keine Bestleistungen. Starte ein Workout."      |
| Distance grid: missing standard distance | em-dash placeholder card (existing behavior)          |

### Naming

German UI label: **Rekorde**. Matches existing copy ("Persönliche Bestzeiten",
"Bestleistungen") and is shorter than "Bestleistungen" for the tab strip.

## Migration / rollout

Single PR. No data migration. No feature flag — IA change is reversible by reverting.

## Open questions

None at design time. All scope decisions made:
- PBs = stats artifact (user confirmed).
- IA option A: third tab in History (user confirmed).
- Wartung stays in Profile (user confirmed).
