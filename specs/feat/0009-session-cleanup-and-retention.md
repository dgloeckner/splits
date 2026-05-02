# FEAT-0009: Session Cleanup & Data Retention

- **Status**: Shipped (2026-05-02)
- **Depends on**: ADR-0004 (local-first SQLite), ADR-0007 (event
  ingestion), FEAT-0003 (session history), FEAT-0004 (statistics),
  FEAT-0010 (achievements & PBs)
- **Referenced by**: FEAT-0010 (consumes the `on_session_change`
  recompute hook defined here), ADR-0008 (architectural anchor)

## Summary

Give the household a way to keep the SQLite store healthy over time:
delete bad sessions, restore deletions the user regrets, and
automatically shed per-stroke detail from sessions old enough that
nobody will ever re-open their charts. Every cleanup operation is
paired with a recompute hook so derived data (lifetime stats,
achievements, PBs) never drifts from the source rows.

Architectural anchor: **per-stroke rows are ephemeral**. They exist
only while a session is open. The moment a session ends, the
sessionizer / persister pipeline computes everything we will ever
need to keep — `summary_json` (incl. a downsampled chart series),
achievements, lifetime-stats refresh — and **deletes the strokes**
in the same transaction. The `strokes` table is therefore a
working-memory buffer for the currently-open session, not an
archive.

Two layers:

1. **End-of-session compaction (automatic, mandatory)** — strokes
   for the just-ended session are dropped immediately; aggregates
   and achievements are kept **forever**. Not user-visible.
2. **User-confirmed delete (immediate hard delete)** — when the
   user confirms a delete on a session card, the session row +
   tied achievement rows are physically removed in the same
   transaction. No soft-delete, no Papierkorb, no cool-off.
   Achievements recomputed from remaining sessions afterwards.

All rowers in the household are trusted peers — no admin role.
Anything one rower can do, any rower can do.

## User stories

- As a rower, I want to delete a mis-registered session (kids on the
  ergo, fixture replay) without losing the ones around it.
- As a rower, I want my training data from two years ago to still
  count toward lifetime totals and PBs, even if the database no
  longer stores every single stroke of it.
- As a household member, I want to see how much DB space the data
  is using.
- As a rower, if I lose connection, close the tab, or restart the
  device while still rowing, I want to re-open the Live view and
  pick up the same in-progress session — not start a new one or
  lose the totals so far.

## Cleanup modes

### Mode 0 — End-of-session compaction (automatic, mandatory)

Triggers (any one closes the open session, which then fires
`session_end` and runs Mode 0):

1. **Explicit "Beenden" button on the Live page.** Primary CTA on
   the Live screen, visible whenever a session is open. Posts
   `POST /api/v1/session/end`. Confirmation dialog asks
   `Workout beenden?` with `Ja` / `Nein`. Standard finish path.
2. **Inactivity timeout.** If frames keep arriving but distance
   stops advancing for 60 s (`InactivityTimeout`, already in the
   sessionizer), the backend closes the session. Catches "user
   walked away while ergo still broadcasts".
3. **Idle timeout.** No frames at all for 60 s (`IdleTimeout`).
   Catches "console powered off" / "BLE link dropped".
4. **Boot-time janitor.** Any session left `ended_at IS NULL`
   from a previous process is finalised at startup with
   `summary_json.flags ⊃ ["recovered"]`.
5. **"Workout abbrechen" path** (FEAT — abort dialog) calls the
   same `POST /session/end`. Same Mode 0 effect.

There is no separate "auto-end" vs. "user-ended" distinction in
storage — once `session_end` fires, the pipeline is identical.

`session_end` reaches the persister.

Effect, all inside the same DB transaction that closes the session:

1. Compute and write `summary_json`. The struct is extended to
   carry a **downsampled chart series** so FEAT-0003a per-stroke
   charts (Split-Verlauf, Watt, SPM, optional HF) can still render
   on past sessions — at coarser resolution, but enough to read
   shape:
   ```jsonc
   {
     "totals":   { /* unchanged */ },
     "splits":   [ /* per-500 m, unchanged */ ],
     "samples": {                         // NEW
       "t_sec":  [0, 5, 10, 15, …],       // ~1 sample / 5 s, capped at 360 points
       "split":  [128.4, 124.0, …],       // sec / 500 m
       "watt":   [185, 210, …],
       "spm":    [22, 24, …],
       "hr":     [null, 142, …]           // optional, present iff HR data exists
     },
     "consistency": { "power_stddev": 18.4 },
     "flags":   []                         // e.g. ["recovered"], see Open Questions
   }
   ```
2. Run `on_session_change(rower_id, session_id, created)`
   (FEAT-0010): inserts new PB rows, refreshes lifetime stats,
   adds milestone rows.
3. `DELETE FROM strokes WHERE session_id = ?`. The strokes table
   carries no historical data — only currently-open sessions have
   rows in it.

This compaction is **not optional and not deferred.** A session
that has rows in `strokes` after `session_end` is a bug, and the
boot-time janitor (see Background jobs) flags + repairs it.

Sample-series sizing: averaged over **N strokes per bucket** (N
constant, e.g. 5 — tuned during implementation based on chart
legibility). Series length scales with session length. Per-metric
float arrays only — no per-stroke detail like `dps`/`spi` per
stroke. Consumers that want per-stroke metrics during the live
session use the SSE feed; afterwards, only the downsampled view
exists.

### Mode 1 — User-confirmed delete (immediate)

Trigger: user taps "Löschen" on a session card (Historie list or
Session-Detail) and confirms in the dialog. Confirmation dialog
copy: `Sitzung unwiderruflich löschen?`, body names date /
distance / duration, primary CTA `Löschen`, secondary `Abbrechen`.

Effect, all inside one DB transaction:
- `DELETE FROM sessions WHERE id = ?`.
- Application code deletes from `pb_distance`, `pb_window`,
  `pb_workout`, and `achievements` where `source_session_id = ?`.
- `on_session_change(rower_id, session_id, hard_deleted)` fires
  after the deletes, recomputes PBs and lifetime stats from what
  remains.
- FK `strokes.session_id` is still declared `ON DELETE CASCADE`
  so that a delete of an *open* session (edge case via boot
  janitor) cleans up unfinalised strokes safely.

Irreversible. No Papierkorb, no soft-delete state, no `deleted_at`
column.

## Schema changes

```sql
-- Ensure strokes cascade when session is hard-deleted. If the FK
-- currently lacks ON DELETE CASCADE, a migration recreates the
-- table with the constraint (SQLite does not support altering FKs
-- in place). Safe because strokes has no other referents.

-- No new columns on `sessions` or `rowers`. The "strokes are gone"
-- state is implicit: any session with `ended_at IS NOT NULL` has
-- no rows in `strokes`. Compaction state is therefore not stored
-- separately.
```

`summary_json` gains the `samples` field defined in Mode 0; this is
a payload extension, not a schema change. Existing readers that
ignore unknown fields keep working.

## API surface

All paths under `/api/v1`. Existing `DELETE /sessions/{id}` changes
semantics from "soft delete for 7 days" (FEAT-0003 acceptance) to
"immediate hard delete after confirmation" — breaking change. The
`deleted_at` column on `sessions` is dropped.

| Method | Path                  | Purpose                              |
|--------|-----------------------|--------------------------------------|
| DELETE | `/sessions/{id}`      | Immediate hard delete                |
| GET    | `/cleanup/status`     | Per-rower counts + footprint         |
| GET    | `/session/active`     | Currently-open session, if any       |
| POST   | `/session/end`        | Close currently-open session (idempotent) |

No export endpoints — exports are out of scope for v1. No restore.

`on_session_change` is **not** an HTTP endpoint — it is an internal
Go function called by every handler that mutates a session's
lifecycle state. Keeping it internal means the recompute contract
cannot be skipped by a forgotten API call.

### Live session re-attach (`GET /session/active`)

Returns either `204 No Content` or the open session's id, plus the
SSE `Last-Event-ID` of the latest event the broadcaster has seen
for it. The Live page calls this on mount: if a session is open,
it opens the SSE stream with that `Last-Event-ID`, replays the
ring buffer, and keeps going. The user sees the same totals they
left with, regardless of how the previous tab died.

Required backend behaviour for this to work:
- Closing a tab does **not** end the session. The current
  `pagehide → POST /session/end` beacon is removed; only an
  explicit "Workout abbrechen" or the sessionizer's idle /
  inactivity timeout closes a session.
- The sessionizer keeps its open-session snapshot in memory across
  client disconnects (already true today).

## Background jobs

Two jobs only:

1. **Recompute sweep** (daily, default `03:17 local`) — sanity pass
   verifying `on_session_change` did its job: compares
   `(rower_id, sum of session totals)` against the lifetime stats
   snapshot and logs a warning on drift. Does **not** auto-correct
   — drift means a bug to fix.
2. **Boot-time janitor** (runs at process start):
   - Any session with `ended_at IS NULL` older than the inactivity
     threshold is finalised: `ended_at = lastSeen + 1s`,
     `summary_json.flags ⊃ ["recovered"]`, achievements computed,
     strokes deleted (Mode 0).
   - Any session with `ended_at IS NOT NULL` that still has rows
     in `strokes` is a bug — log loudly, then run Mode 0 to
     repair.

Both are idempotent and interruptible.

## Wartung view

A "Wartung" sub-page under Profil, visible to every rower (no admin
role). One row per rower:

| Rower  | Sessions | ~Footprint |
|--------|----------|------------|
| Daniel | 142      | 1.6 MB     |

Footprint is a heuristic: `sessions * 1.2 kB +
sum(summary_json sample bytes) + rowers * 0.2 kB`. Good enough for
"is the db growing scarily fast" without parsing SQLite page
statistics. No per-stroke term — strokes only exist for the open
session.

No actions in v1 — the view is purely informational. (Per-session
delete already lives on the session card.)

## Acceptance criteria

- [x] At `session_end`, `summary_json.samples` is populated with a
      downsampled chart series (≤ 360 points), achievements are
      computed via `on_session_change(created)`, and all rows in
      `strokes` for that `session_id` are deleted — all in the
      same transaction.
- [x] After session_end, `SELECT COUNT(*) FROM strokes WHERE
      session_id = ?` returns 0 for every session in the database.
      The boot-time janitor flags any violation.
- [x] Session-Detail charts (FEAT-0003a) render from
      `summary_json.samples` for every past session — including
      sessions just ended seconds ago, not only "old" ones.
- [x] `DELETE /api/v1/sessions/{id}` (after user confirmation in
      the UI dialog) hard-deletes the session row + its
      achievement rows, then fires `on_session_change(hard_deleted)`,
      all in the same transaction.
- [x] Confirmation dialog names the session (date / distance /
      duration) and offers exactly two actions (`Löschen`,
      `Abbrechen`).
- [x] Deleted session disappears from all queries — Historie,
      lifetime totals, PB grid — immediately.
- [x] `GET /api/v1/session/active` returns the open session id +
      `Last-Event-ID` if a session is open; `204` otherwise. The
      Live page uses it on mount to re-attach.
- [x] Closing the browser tab does **not** end the session.
- [x] Live page shows a primary "Beenden" CTA whenever a session
      is open; tapping it (after confirmation) calls
      `POST /api/v1/session/end`.
- [x] Sessionizer's `IdleTimeout` (no frames) and
      `InactivityTimeout` (no progress) both still close the
      session as fallbacks.
- [x] `on_session_change` is idempotent: calling it twice with the
      same `(rower_id, session_id, change_type)` yields the same
      final state.
- [x] Daily recompute sweep logs (does not auto-correct) any drift
      between lifetime stats and the sum over active sessions.
- [x] `strokes.session_id` has `ON DELETE CASCADE`.
- [x] Boot-time janitor finalises any session with `ended_at NULL`
      older than the inactivity threshold, marking
      `summary_json.flags ⊃ ["recovered"]`.

## UX notes

- Delete dialog: title `Sitzung unwiderruflich löschen?`, body
  names the session (date / distance / duration), primary CTA
  `Löschen`, secondary `Abbrechen`. Danger colour reserved for the
  `Löschen` button only.
- Wartung view follows the visual design system; table uses the
  same tile tokens as Profil.

## Non-goals

- Cloud backup. File-level backup (`.backup` on the SQLite file)
  remains the household strategy per ADR-0004.
- **Exports** (CSV / JSON / FIT). Out of scope for v1.
- Preserving raw per-stroke detail for past sessions. Replaced by
  the downsampled `summary_json.samples` series. Per-stroke detail
  is live-only.
- Undo of hard-delete. None.
- Per-rower or per-session retention overrides. The household uses
  one model.

## Consistency with existing specs

Needs updates after this spec lands:

- **FEAT-0003** acceptance: "Deleting a session is reversible for 7
  days (soft delete)" — replaced by **immediate hard delete with
  confirmation**. No restore.
- **FEAT-0003a** long-press menu: drop "Exportieren". Delete entry
  triggers the confirmation dialog defined here.
- **FEAT-0004** PB/lifetime recompute trigger is currently implicit
  ("Stats recompute correctly after a session is deleted"). Replace
  with explicit reference to `on_session_change` from this spec.
- **ADR-0007** pipeline is untouched — cleanup operates on persisted
  state, not on the ingest pipeline.

## Resolved (no longer open)

- **Admin role**: dropped. Household rowers are trusted peers.
- **Stroke retention TTL**: dropped — replaced by end-of-session
  compaction. Strokes never persist past a session.
- **Per-rower retention override**: dropped — single model.
- **Exports**: dropped from v1.
- **Soft-delete / Papierkorb / restore**: dropped. Delete is
  immediate after confirmation.
- **30-day cool-off / purge job**: dropped along with soft-delete.
- **First-boot data migration**: dropped. Empty DB assumption —
  no historical strokes to back-fill.
- **Live session re-access**: explicit acceptance criterion above
  (`GET /session/active` + tab-close no longer ends session).
- **Sample-series cap**: dropped. Use fixed N-stroke averaging,
  series length scales with session length.
- **Storage footprint**: heuristic (row-count math), not real
  page-count.
- **Recompute model**: `on_session_change` runs in a background
  goroutine; HTTP responses include a `stats_version` header that
  the UI polls until matching the latest write.

## Open questions

1. **Post-session-end PB visibility.** `on_session_change` runs
   asynchronously in a goroutine. Between session_end and
   recompute completion (typically a few seconds, longer on first
   ever session), the Live → "Workout beendet" overlay and the
   Profil PB grid may not yet reflect new PBs. UI handling
   approach is captured in the Resolved → "Recompute model"
   bullet (`stats_version` header + UI polling). FEAT-0010 spells
   the UX states out — see its "Post-session-end UI states"
   section.
