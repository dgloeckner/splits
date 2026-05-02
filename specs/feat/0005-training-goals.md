# FEAT-0005: Training Goals

- **Status**: Draft — deferred past v1
- **Depends on**: FEAT-0004

## Summary

Users can set personal training goals and track progress against them. Goals
are motivational, not enforcing — the app won't interrupt your workout.

## User stories

- As a rower, I want to set a **volume goal** (e.g. "50 km this month") and
  see my progress.
- As a rower, I want to set a **performance goal** (e.g. "break 7:30 on
  2000 m") and be notified when I hit it.
- As a rower, I want to set a **frequency goal** (e.g. "3 sessions per
  week").
- As a rower, I want to see goal progress on my user profile page.

## Acceptance criteria

- [ ] Three goal types supported: volume (distance over period), performance
      (PB target over standard distance), frequency (sessions per period).
- [ ] Volume and frequency goals have a defined period: week, month, year, or
      custom start/end.
- [ ] Progress bar / percentage on profile page per active goal.
- [ ] Completed performance goals are archived automatically with completion
      date.
- [ ] Volume / frequency goals roll over into the next period only if the
      user opts in (otherwise archive).
- [ ] Users can edit or abandon a goal at any time. Abandoned goals are kept
      for reference.

## UX notes

Dedicated "Goals" tab on the profile page. Each goal is a card with a
progress indicator and an edit/abandon menu.

## Non-goals

- Coach-prescribed workouts
- Plan generation ("help me prepare for a 5k")
- Goal-based workout selection on the ergo

## Open questions

- Default goal suggestions for new users? Or completely blank slate?
- Notify how? In-app toast is fine. Web Push is stretch (iOS PWA push is
  recent and quirky).
