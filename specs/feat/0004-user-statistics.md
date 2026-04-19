# FEAT-0004: Per-User Statistics

- **Status**: Draft
- **Depends on**: FEAT-0003

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
- [ ] New PB triggers a visible notification in the session detail view
      ("🏆 New PB over 2000 m!").
- [ ] Stats recompute correctly after a session is deleted.

## UX notes

User profile page with three sections: PBs (table), Totals (big numbers),
Trends (sparklines or small charts).

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
