# FEAT-0004: Per-User Statistics

- **Status**: Draft
- **Depends on**: FEAT-0003

## Reference

Authoritative visual prototype: Stitch project `16112355480769913997`
screens **"User Profile"** and **"Profil (Tablet Portrait/Landscape)"**.

## Summary

Aggregate view of a user's training: personal bests over standard distances,
running totals, and trends over time.

## User stories

- As a rower, I want to see my **personal best** on standard distances
  (500 / 1000 / 2000 / 5000 / 6000 / 10000 m) so I can chase them.
- As a rower, I want to see **lifetime totals**: total distance rowed, total
  time, number of sessions.
- As a rower, I want a **weekly / monthly summary** to see trends.
- As a rower, I want to know when I set a new PB — ideally right after the
  session ends.

## Acceptance criteria

- [ ] PB per standard distance computed over all sessions for that user.
      Computed from sample series (rolling window) so a PB can exist inside a
      longer session, not just as a complete session of that distance.
- [ ] Lifetime totals updated after every session.
- [ ] Weekly summary shows: sessions, total distance, total time, avg split.
- [ ] Monthly summary same, over calendar months.
- [ ] New PB triggers a ribbon-badge at the top of the Hero-Summary on
      the Session-Detail screen (see FEAT-0003a); copy is German
      (`🏆 Neue Bestzeit über 2000 m`).
- [ ] Profile page renders the PB grid as 2×3 on phone portrait, with
      monospaced digits for the PB times.
- [ ] "Diese Woche" bar chart shows one bar per weekday (Mo–So), anchored
      on the user's locale-aware week start.
- [ ] Profile Theme Switcher offers `System / Dunkel / Hell`; the
      choice applies instantly (no reload), writes `data-theme` on
      `<html>`, and persists across sessions.
- [ ] Initial page render honours the persisted theme before React
      mounts (no flash of the wrong theme).
- [ ] Stats recompute correctly after a session is deleted.

## UX notes

Profil-Page layout:

- **Hero** with avatar, Name, subtitle `Seit [date] · N Sessions`.
- **Persönliche Bestzeiten** as a **2×3 grid** over six standard distances
  (500 m, 1000 m, 2000 m, 5000 m, 6000 m, 10000 m). PBs are computed from
  the sample series via a rolling window — a PB can live inside a longer
  session, not only as a complete session of that distance.
- **Gesamt-Tiles**: Distanz, Zeit, Session-Count.
- **Diese Woche** as a 7-bar chart (one bar per weekday).
- **Ziele-Liste** with progress bars, linking into FEAT-0005.
- **Theme Switcher** (Einstellungen-Bereich): three options —
  `System` (default; follows `prefers-color-scheme`), `Dunkel`,
  `Hell`. Applied globally via `data-theme` on `<html>` and persisted
  per user profile. See FEAT-0008 for the token system and resolution
  order. Reference screens: Stitch **"User Profile"** (dark) and
  **"User Profile (Light Mode)"**.

Consistent with FEAT-0001 / FEAT-0008: dark mode, mono-digits, sport-
instrument aesthetic, 8 pt grid, 12 px radius.

### PB notification

A new PB triggers a visible notification inside the Session-Detail screen
(see FEAT-0003a): a **ribbon-badge** at the top of the Hero-Summary
block with copy like `🏆 Neue Bestzeit über 2000 m`. Trends aggregations
(FEAT-0003a) pick up the PB automatically.

## Non-goals

- Age-graded or weight-adjusted scoring (v2 if anyone cares)
- Comparison between users (explicitly a non-goal for v1 — keep it personal)
- Training load metrics (TSS, CTL, ATL) — too specialised

## Open questions

- Include warm-up / cool-down in PB calculations, or require a minimum
  intensity threshold? Probably include — users can always delete bad
  sessions.
- Compute PBs on write (cache) or on read (query)? Depends on sample volume;
  decide during M4.
