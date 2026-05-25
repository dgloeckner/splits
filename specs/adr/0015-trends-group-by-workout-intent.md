# ADR-0015: Trends charts group sessions by workout intent, not by actual distance

- **Status**: Accepted
- **Date**: 2026-05-24

## Context

The Historie → Trends sub-tab shows per-rower performance over time.
FEAT-0003a calls for a multi-series line chart with "one series per
standard distance (500 m, 1 k, 2 k, 5 k, 6 k, 10 k, …)". The spec
does not define how a raw session maps to a series, and the v1
implementation sidestepped it entirely — it aggregates *all*
sessions into one dual-line chart of Ø Watt + Ø Pace.

Real data exposes the failure mode of that v1 chart. Daniel's
month range contains four 5 k tempo pieces (Ø 374–382 W, pace
1:50→1:47), one 603 m short piece (Ø 429 W, pace 2:09), and one
134 m abandoned start (Ø 182 W, pace 2:23). The current chart
renders all six as equal points on a shared y-axis. The two short
pieces dominate the scale; the actual story — a clean 3 s/500m
improvement across the 5 k series — is invisible.

The fix requires a series-assignment rule. Three families were
considered.

## Options considered

### Option A — Bucket by actual distance with a tolerance

Map a session to a standard distance if `total_distance_m` is
within ±N % of it (e.g. ±2 %).

- **Pros:** works for free rows that happen to land near a standard
  distance; doesn't require workout intent metadata.
- **Cons:** tolerance is arbitrary and long-tail bug-prone (4990 m
  + cooldown that stops at 5040 m looks like a 5 k piece when it
  wasn't); intent is lost; abandoned starts (134 m) can still leak
  into a "500 m" bucket at ±30 %, or get excluded at tighter
  tolerances while genuinely valid 503 m pieces also fall out.

### Option B — Hybrid: prefer explicit workout target, fall back to tolerance

If `workout.target_distance_m` exists, use it. Otherwise, bucket
by actual distance at tight tolerance.

- **Pros:** captures intent where present; doesn't lose free rows
  that target standard distances.
- **Cons:** carries A's tolerance complexity in the fallback path;
  two code paths to test and explain.

### Option C — Use workout intent only; free rows excluded

A session is assigned to a series iff its `workout` row carries a
shape (mode + parameters). Free rows (`mode = 'just_row'`) never
join any series. Abandoned sessions (those below the completion
threshold — see §Consequences) are also excluded.

- **Pros:** zero tolerance tuning; the series-assignment rule is a
  single SQL join; intent is preserved exactly; the schema already
  carries the needed data (`sessions.workout_id`, `workout.mode`,
  `workout.params_json`, `workout.shape_hash`).
- **Cons:** free rows have no Trends presence; rowers who never
  pin a workout target see an empty chart. Acceptable: free rows
  belong on volume/regularity surfaces (Volumen, Heatmap — both
  deferred from 0003a), not on a "comparable performance" chart.

## Decision

**Option C.** Trend series are keyed by `workout.shape_hash`. A
session contributes to a series iff:

1. It has a `workout_id` with a shape (any mode except `just_row`).
2. It is *completed* — reached ≥ 80 % of its workout target
   (`total_distance_m ≥ 0.8 × target` for distance/race;
   `total_time_sec ≥ 0.8 × target_sec` for time).
3. It is not soft-deleted.

The chart is **multi-series**, one series per shape that meets a
**threshold of ≥ 3 completed sessions in the current range**.
Sub-threshold series do not render and are not surfaced in the
chart UI — the existing "Zeitraum erweitern" affordance is the
only escape hatch. v1 scope covers `distance`, `time`, and `race`
shapes; `intervals` is deferred (the per-session aggregate hides
the only interesting thing about intervals — rep-to-rep
degradation — and deserves a different chart).

## Consequences

- The Trends API needs a series-aware response shape: instead of
  `points: [{t, avg_power_w, avg_pace_sec_per_500m}]`, it returns
  `series: [{shape_hash, mode, params, points: […]}]`.
- The Trends API must enforce the completion filter server-side so
  the client never sees abandoned sessions in trend points.
- The `workout.shape_hash` column already exists; the migration
  cost is in computing it for legacy rows that may pre-date the
  column. A backfill pass is required before the new chart can
  ship.
- Free-row trends are unsupported by design. If user feedback
  later demands them, they belong on Volumen-Chart (0003a) as a
  separate "Frei" bar segment, not on the Leistung line chart.
- The CONTEXT.md §Trends section is the canonical reference for
  *comparable workout shape*, *completion*, and *series* — code
  and copy must use these terms verbatim.
- The 0003a spec wording "one series per standard distance" is
  **narrower** than this ADR's "one series per workout shape" —
  this ADR supersedes that phrasing.

## Amendment (2026-05-24): Series key uses canonical params, not shape_hash

Smoke-testing against real production data revealed that `workout.shape_hash`
includes `warmup_sec` and `cooldown_sec` (see `backend/internal/workout/hash.go`).
For PB canonicalisation that distinction matters; for trend comparability it
does not — a rower thinks of "5 k" as a single piece regardless of whether the
session had a 60 s or 120 s warmup. Under the v1 ≥3-completed-sessions threshold,
keying on `shape_hash` caused real rowers' 5 k pieces to split into multiple
sub-threshold series, producing an empty chart where a clean 4-point series
should have appeared.

**Initial revised decision (superseded by the 2026-05-25 amendment below):**
Trend series are keyed on `(mode, canonical(params))`, where `canonical(params)`
is the workout's `params_json` re-marshaled with sorted keys. Warmup and cooldown
durations are NOT part of the trend-series identity. The JSON wire field name
remains `key.shape_hash` for backwards compatibility; its value is now the
canonicalized-params string rather than the original `workout.shape_hash`.

`workout.shape_hash` continues to be used by the PB pipeline. Only the trends
API was wrong to inherit that hash for grouping.

## Amendment (2026-05-25): Fix `ShapeHash` itself; collapse race ≡ distance

A second grilling pass surfaced two further issues with the 2026-05-24 fix:

1. **Bug**: the v1 `isCompletedSession` and `displayNameForShape` helpers
   unmarshalled time-mode params under the field name `"sec"`, but
   `workout.TimeParams` actually stores it as `"seconds"` (see
   `backend/internal/workout/params.go`). Time-mode workouts were silently
   filtered out of every series. Not caught by tests because the unit-test
   fixtures used the wrong field name too.
2. **Latent bug in `ShapeHash` itself**: every caller of `ShapeHash` — PB
   pipeline (`pb_workout`), race ghost lookup, trends — wants warmup/cooldown
   *out*. The `pb_workout` table would currently record two separate "5 k PBs"
   for a rower who did one piece with a 120 s warmup and one with a 60 s
   warmup. That's wrong; the user explicitly stated PB should be
   warmup/cooldown-agnostic. The 2026-05-24 fix patched only trends, leaving
   the PB pipeline buggy.

**Final revised decision:**

- **`ShapeHash(params)`**: drop both `mode` and `warmup/cooldown` arguments.
  Workouts with the same `params` map to the same hash, regardless of mode,
  warmup, cooldown, or intensity. This is the single, authoritative notion of
  "comparable workout shape" across the codebase.
- **Both PB and Trends use `ShapeHash` directly**. There is no separate
  `ShapeKey` function and no `(mode, hash)` tuple. The wire field `key.shape_hash`
  goes back to carrying an actual hash.
- **Race ≡ distance for the same params** (reverses the original Q3 D
  decision). A `race {meters:2000}` and a `distance {meters:2000}` share both
  a PB row and a trends series. Rationale: the rower's "fastest 2 k effort"
  is one number; trying to maintain race-2 k and tempo-2 k as separate trend
  lines complicates the UI for marginal payoff. `displayNameForShape` drops
  the `"Race "` prefix.
- **Time-mode params**: trends helpers use `workout.DecodeParams` to obtain
  the typed `*Params`, removing the `"sec"`/`"seconds"` typo class of bug
  entirely. Test fixtures use the real production shape (`{"seconds":1800}`).
- **Migration `0016_recompute_shape_hash`**: a Go-side one-shot startup pass
  that (a) recomputes `workout.shape_hash` for every existing row under the
  new function and (b) calls `stats.Recompute(ctx, db, rowerID)` for every
  rower. The existing recompute pipeline invalidates and rebuilds `pb_workout`
  rows under the new hashes automatically — no manual PB editing.

Consequence: the 2026-05-24 `canonicalParamsKey` helper, the `sessionRow.Mode`
component of the series-grouping key, and the `(mode, …)` tuple in
`trendsSeriesKey` are all reverted. The `Race ` display-name branch in
`displayNameForShape` is removed.
