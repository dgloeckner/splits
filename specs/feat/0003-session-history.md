# FEAT-0003: Session History

- **Status**: Draft
- **Depends on**: FEAT-0001, FEAT-0002

## Summary

Every completed session is persisted indefinitely and can be browsed,
filtered, and inspected in detail.

## User stories

- As a rower, I want every session to be saved automatically without me
  pressing "save".
- As a rower, I want to filter the list by user and by date range.
- As a rower, I want to open a past session and see the same metrics as the
  live view, plus a chart of split / SPM / watts / HR over time.
- As a rower, I want to delete a session if it was a misfire (e.g. kids
  playing with the ergo).
- As a rower, I want to export a session as a standard file format (FIT,
  TCX, or CSV) to import elsewhere.

## Acceptance criteria

- [ ] Session starts when the first valid stroke arrives from the console.
- [ ] Session ends after N seconds of idle (no stroke events) — N configurable,
      default 60 s.
- [ ] Session stores: start/end timestamps, user_id, totals (distance, time,
      avg split, avg SPM, avg watts, avg HR), plus a per-tick sample series.
- [ ] Sample series retains enough resolution to reconstruct charts (target:
      1 Hz).
- [ ] List view paginates, supports user + date filters.
- [ ] Detail view shows line charts per metric over the session duration.
- [ ] Export produces a file that at minimum opens cleanly in a spreadsheet
      (CSV) for v1. FIT/TCX export is stretch.
- [ ] Deleting a session is reversible for 7 days (soft delete).

## UX notes

List view: compact rows with date, user avatar, distance, time, split. Tap
opens detail.

## Non-goals

- Cloud backup / sync
- Sharing sessions publicly
- Editing session metrics after the fact (you can annotate, not edit)

## Open questions

- Raw sample rate from the console is still unknown (see M0 in ROADMAP).
  Downsample to 1 Hz at write time, or store raw and downsample on read?
- FIT/TCX priority — nice to have for Strava/Garmin users, or skip for v1?
