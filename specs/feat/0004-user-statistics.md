# FEAT-0004: Profile Theme Switcher

- **Status**: Partial — switcher infrastructure shipped (`useTheme`, `data-theme`, no-flash pre-mount); Profile-page UI control deferred
- **Depends on**: FEAT-0008 (design tokens), FEAT-0010 (PB compute)

## Scope (v1)

This spec was originally a broad "per-user statistics" feature. The
statistical content has been **superseded** by surfaces that already
exist:

| Original FEAT-0004 ask | Surface that owns it now |
|---|---|
| PB grid (500 / 1000 / 2000 / 5000 / 6000 / 10000 m) | History → **Rekorde** tab (FEAT-0010 PB compute, FEAT-0004 PBOverlay deep-links here) |
| Lifetime totals (Distanz / Zeit / Session-Count) | History → **Trends** tab, range = `all` |
| Weekly / monthly summaries | History → **Trends** tab, ranges `week` / `month` |
| New-PB notification | **PBOverlay** at session end (shipped 2026-05-01) |

What remains in scope for FEAT-0004 is the **Profile-page theme
switcher**. Everything else is annotated below as superseded.

## User story

- As a rower, I want to switch between dark mode, light mode, and
  follow-system from a control on my Profile page so the app matches
  my surroundings (dim ergo room vs. sunny morning).

## Acceptance criteria

- [x] PB per standard distance computed over all sessions for that
      user. *— Shipped via FEAT-0010 (`/api/v1/rowers/{id}/pbs`).*
- [x] Lifetime totals updated after every session. *— Shipped via
      `/api/v1/rowers/{id}/lifetime` and the Trends tab range=all.*
- [x] Weekly / monthly summary. *— Shipped via Trends tab
      `range=week|month`.*
- [x] New PB triggers a notification at session end. *— Shipped via
      PBOverlay (FEAT-0004 overlay, 2026-05-01) with hero card, delta
      vs previous, deep-link to Rekorde tab.*
- [x] Stats recompute correctly after a session is deleted. *— Shipped
      via `sched.Wait()` on hard-delete (FEAT-0009).*
- [x] Initial page render honours the persisted theme before React
      mounts (no flash of the wrong theme). *— Shipped via
      `web/src/theme/preMountScript.ts`.*
- [ ] Profile page exposes a **Theme Switcher** with three options
      (`System` / `Dunkel` / `Hell`). The choice applies instantly
      (no reload), writes `data-theme` on `<html>`, and persists across
      sessions and reloads via `localStorage` (`home-ergo:theme`).

## UX

Single 3-segment control in the "Einstellungen" section of
`/profil`. Default selection reflects the current effective theme.
Visual style follows FEAT-0008 segmented-control tokens.

The underlying primitives already exist:
- `web/src/theme/useTheme.ts` — get/set hook with the three values.
- `web/src/theme/preMountScript.ts` — synchronous pre-mount resolver
  that reads `localStorage` and sets `data-theme` before React paints.
- Token cascade: `web/src/styles/tokens.css` defines `:root[data-theme='light']` overrides.

This spec only adds the **UI control surface** that wires `useTheme()`
to a user-facing button group inside `ProfilePage`.

## Non-goals (v1)

- Per-rower theme storage (keyed by rower id rather than device).
  Today the theme is per-device; sufficient for v1.
- Custom accents or palettes — three modes only.
- Profile page weekly bar chart, PB grid, lifetime tiles —
  intentionally not duplicated; the History tabs already render this
  content.
- Goals list with progress bars — owned by FEAT-0005, deferred past
  v1.

## References

- ADR-0005 (pairing) — unrelated but Profile is the same surface that
  hosts the pairing `+` button.
- FEAT-0008 (visual design system) — token cascade and component
  styling source of truth.
- FEAT-0010 (achievements & PBs) — backend compute path that the
  Rekorde tab and PBOverlay both consume.
- Stitch project `16112355480769913997`, screens **"User Profile"**
  (dark) and **"User Profile (Light Mode)"**.

## Migration note

The original v1 acceptance list included a Profil-page PB grid, a
"Diese Woche" 7-bar chart, and lifetime tiles. These were removed
from scope on 2026-05-02 because the History tabs (Rekorde, Trends)
already display this information. Building parallel summaries on the
Profile page would duplicate content with a different presentation
without adding function. See `git log` around 2026-05-02 for the
rewrite commit.
