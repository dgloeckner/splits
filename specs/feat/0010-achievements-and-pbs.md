# FEAT-0010: Achievements & Personal Bests

- **Status**: Shipped
- **Depends on**: FEAT-0003 (session history), FEAT-0004 (statistics —
  supersedes its PB section), FEAT-0007 (metrics catalogue),
  FEAT-0009 (cleanup — consumes `on_session_change`), ADR-0004
  (persistence), ADR-0008 (cleanup & derived stats)
- **Referenced by**: FEAT-0003a (PB-badge on session cards),
  FEAT-0001a (optional home milestone tile)

## Summary

A single achievement system that covers every "how am I doing vs. my
own best" question a rower might ask: standard-distance PBs computed
by rolling-window over strokes, window-PBs (best N seconds of power,
best 30 strokes of SPI, …), consistency records, lifetime volume
milestones, and per-workout PBs keyed by the workout's shape rather
than its database id.

Design anchor: every achievement row is **self-sufficient**. It stores
enough snapshot data (the value, the date, the session start time) to
render its card without touching the source session — important
because per-stroke data does not survive session_end (FEAT-0009
Mode 0). When the source session is soft- or hard-deleted, the
achievement is **invalidated or removed** by `on_session_change`
(FEAT-0009) and the full recompute finds the next-best effort. We
never patch incrementally; the source of truth is "re-scan what is
still live".

The recompute always reads from a session's `summary_json` plus
the now-current set of live sessions. Per-stroke rolling-window
scans run **once**, at session_end, while the strokes still
exist; the per-session best-effort *candidates* are written into
`summary_json.pb_candidates` and the strokes are then deleted.
Recomputes after soft- or hard-delete read these candidates across
all non-deleted sessions and pick the best — no need to re-scan
strokes that no longer exist.

```jsonc
// summary_json (extended; companion to FEAT-0009's `samples` field)
{
  "totals":   { /* … */ },
  "splits":   [ /* … */ ],
  "samples":  { /* FEAT-0009 */ },
  "consistency": { "power_stddev": 18.4 },
  "pb_candidates": {
    "distance": [
      { "distance_m": 500,  "time_sec": 92.3,  "window_start_stroke": 14, "window_end_stroke": 47 },
      { "distance_m": 1000, "time_sec": 196.0, /* … */ },
      // … 2000, 5000, 6000, 10000 if achievable
    ],
    "window": [
      { "metric": "power", "kind": "seconds", "size": 60, "value": 245.8 },
      // … all configured window definitions
    ],
    "workout": { "shape_hash": "…", "value_kind": "time_sec", "value": 410.2 }
  },
  "flags":    []
}
```

A session contributes a candidate only if the session is long
enough for that target (no 500 m candidate from a 300 m session).
The candidates are computed at session_end; subsequent additions
to the configured window list (FEAT-0010's Go constants) require
a backfill pass over `summary_json` — but only if those new
window definitions are themselves stroke-based and therefore can
**not** be retro-computed (since strokes are gone). Adding a new
distance / window after deployment is therefore allowed only if
its computation reduces to existing candidate fields, or accepts
that historical sessions cannot contribute.

## User stories

- As a rower, I want a new PB for 2000 m to be detected even when I
  set it inside a longer session, not only in standalone 2 k rows.
- As a rower, I want to see when I beat my own best 60 s power or best
  30 strokes of DPS, because those are the levers I am actually
  working on.
- As a rower, I want "lifetime: 100 km" to show up as a milestone
  without me having to compute anything.
- As a rower, I want my "best HIIT 4×500" PB to be tracked across the
  many times I have created nominally-the-same workout.
- As a rower, when I delete a session that set a PB, I want the PB to
  disappear from "current best" but stay visible in my PB history, so
  I can tell that I once did better.

## Achievement categories

### (a) Standard-distance PBs

Distances: **500 m, 1000 m, 2000 m, 5000 m, 6000 m, 10000 m.**

Algorithm: rolling window over the session's active strokes
(strokes within an open rowing interval, excluding any pause gaps).
For each target distance D, slide over the sequence of
`(distance_m, time_sec)` samples and find the minimum Δt such that
`Δdistance ≥ D`. Store that Δt, its start/end stroke indices, and
the session id.

A longer session contributes at most one PB candidate per distance
(the best window inside it); the per-rower PB is the minimum across
all sessions. The window is computed on **active** strokes only —
pause intervals are excluded from both the distance sum and the
time delta, matching pause-aware live view behaviour.

### (b) Window-PBs

Fixed windows, all configurable as Go constants (adding a window
must not change the schema — see below):

| Metric      | Window              |
|-------------|---------------------|
| Power (W)   | 60 s                |
| DPS         | 30 strokes          |
| SPI         | 30 strokes          |

A window-PB row is keyed by `(rower_id, metric, window_kind,
window_size)` where `window_kind ∈ {seconds, strokes}`. The value is
the rolling-mean best (higher-is-better for all current metrics).
`window_size` is stored as an integer.

> Pace was originally a window-PB metric (best 60 s avg /500m split)
> but was retired: split is sec/500m by definition, so a "best 60 s
> avg pace" is not a metric rowers track in standard tools (Concept2,
> Painsled, rowsandall). Continuous distance-PBs (500 m, 1 k, 2 k…)
> cover the split story; window-PBs are reserved for intensity
> metrics with no natural distance equivalent (power) or stroke-
> quality metrics (DPS, SPI). The 'pace' branch in the recompute SQL
> and the `pace` case in `strokeMetric` / `better` are kept as dead
> code so historical rows invalidate cleanly during recompute.

Window list is **locked at deployment**: adding a window later
cannot back-fill historical sessions because their strokes are
gone. New windows would only apply to future sessions, creating
asymmetric PB grids. Decided not worth the friction.

### (c) Consistency

Three within-session consistency PBs, all "lower is better"
(the **most consistent** session wins):

| Key                       | Formula                                | Reads                       |
|---------------------------|----------------------------------------|-----------------------------|
| `consistency_power_cv`    | `σ(stroke_power) / mean(stroke_power)` | Force application steady    |
| `consistency_pace_split_cv` | `σ(per-500m split) / mean(split)`    | Even pacing across distance |
| `consistency_spm_cv`      | `σ(per-stroke spm) / mean(spm)`        | Steady stroke rate          |

CV (coefficient of variation) is unitless, scales with mean — a
fast session is not penalised for absolute variance. All three
computed at session_end while strokes still exist; values stored
in `summary_json.consistency` and as candidates in
`summary_json.pb_candidates.consistency`.

Minimum active-stroke count for a session to qualify: **80
strokes** (≈ 5 min steady rowing). Stored as a Go constant.
Sessions below threshold do not contribute candidates and cannot
hold consistency PBs.

**Multi-session** (v1.1, marked stretch):
- Streak of N consecutive sessions whose `avg_pace_sec_per_500m`
  stays inside a **±3 % corridor around the rower's
  30-session median pace**. Stored as an `achievements` row keyed
  by streak length (e.g. `streak_pace_5`).

### (d) Volume milestones

Lifetime totals crossing any threshold from a **configuration list**:

```go
var milestoneThresholds = struct {
    DistanceMeters []int // 10, 25, 50, 100, 250, 500, 1000, 2500, 5000 (km → m)
    Strokes        []int // 10_000, 50_000, 100_000, 250_000, 500_000, 1_000_000
    ActiveSeconds  []int // 10h, 50h, 100h, 250h, 500h in seconds
}
```

Adding a threshold ships as a code change, no migration needed —
each threshold becomes an `achievements` row when a recompute
detects the rower has crossed it.

### (e) Workout-specific PBs

Workouts with identical shape are one PB bucket even when the
`workout.id`s differ (rowers who repeat "2 k distance" create a new
`workout` row each time).

Identity: `workout_hash = hex(sha256(canonical_json(workout_shape)))`
where `workout_shape` contains only:

```json
{
  "mode": "distance",
  "params": { "meters": 2000 },
  "warmup_sec": 0,
  "cooldown_sec": 0
}
```

Canonicalisation rules (deterministic and documented):
- `params_json` deserialised, re-serialised with sorted keys, no
  whitespace.
- `intensity` **excluded** — it is a UX tag, not part of the workout
  geometry.
- `warmup_sec` / `cooldown_sec` coerced to integer seconds (never
  null).
- All numeric zeros included (`warmup_sec: 0` is meaningful — a
  2 k with a warmup is a different shape than a bare 2 k).

The hash is stored on the workout row at creation
(`workout.shape_hash`) so every subsequent `workout_attached` event
carries an identity that collapses across duplicates.

Per-workout PB metric:
- **Distance-mode** workouts: minimum time to complete the target
  distance (measured as an inside-window PB — see (a)).
- **Time-mode** workouts: maximum distance during the target time
  window.
- **Interval workouts** (future — see FEAT-0005a): one PB per
  `(shape_hash, segment_index)`. Deferred; v1 handles only
  single-segment distance/time workouts.

## Data model

### New tables

```sql
-- (a) Standard-distance PBs.
CREATE TABLE pb_distance (
  id                     INTEGER PRIMARY KEY,
  rower_id               TEXT NOT NULL REFERENCES rowers(id),
  distance_m             INTEGER NOT NULL,         -- 500, 1000, 2000, …
  time_sec               REAL NOT NULL,            -- best window time
  source_session_id      TEXT NOT NULL REFERENCES sessions(id),
  source_session_started_at TEXT NOT NULL,         -- snapshot, RFC3339
  achieved_at            TEXT NOT NULL,            -- wall-time PB confirmed
  window_start_stroke    INTEGER NOT NULL,
  window_end_stroke      INTEGER NOT NULL,
  invalidated_at         TEXT                      -- null = active
);
-- Exactly one ACTIVE PB per (rower, distance). Historical
-- invalidated rows can accumulate freely.
CREATE UNIQUE INDEX pb_distance_active_uniq
  ON pb_distance(rower_id, distance_m)
  WHERE invalidated_at IS NULL;

-- (b) Window-PBs.
CREATE TABLE pb_window (
  id                     INTEGER PRIMARY KEY,
  rower_id               TEXT NOT NULL REFERENCES rowers(id),
  metric                 TEXT NOT NULL,            -- 'power', 'pace', 'dps', 'spi'
  window_kind            TEXT NOT NULL,            -- 'seconds' | 'strokes'
  window_size            INTEGER NOT NULL,
  value                  REAL NOT NULL,            -- metric-dependent unit
  source_session_id      TEXT NOT NULL REFERENCES sessions(id),
  source_session_started_at TEXT NOT NULL,
  achieved_at            TEXT NOT NULL,
  invalidated_at         TEXT
);
CREATE UNIQUE INDEX pb_window_active_uniq
  ON pb_window(rower_id, metric, window_kind, window_size)
  WHERE invalidated_at IS NULL;

-- (e) Workout-specific PBs.
CREATE TABLE pb_workout (
  id                     INTEGER PRIMARY KEY,
  rower_id               TEXT NOT NULL REFERENCES rowers(id),
  shape_hash             TEXT NOT NULL,            -- sha256 hex
  mode                   TEXT NOT NULL,            -- copy for display
  params_json            TEXT NOT NULL,            -- canonicalised copy
  value_kind             TEXT NOT NULL,            -- 'time_sec' | 'distance_m'
  value                  REAL NOT NULL,
  source_session_id      TEXT NOT NULL REFERENCES sessions(id),
  source_session_started_at TEXT NOT NULL,
  achieved_at            TEXT NOT NULL,
  invalidated_at         TEXT
);
CREATE UNIQUE INDEX pb_workout_active_uniq
  ON pb_workout(rower_id, shape_hash)
  WHERE invalidated_at IS NULL;

-- (c) + (d) Generic achievements: milestones, consistency, any
-- future category that does not fit the per-PB shape.
CREATE TABLE achievements (
  id                     INTEGER PRIMARY KEY,
  rower_id               TEXT NOT NULL REFERENCES rowers(id),
  achievement_type       TEXT NOT NULL,            -- 'volume', 'consistency_intra', 'consistency_streak'
  achievement_key        TEXT NOT NULL,            -- e.g. 'distance_100km', 'power_stddev'
  value                  REAL,                     -- typed per type
  source_session_id      TEXT REFERENCES sessions(id),   -- null for volume-lifetime
  source_session_started_at TEXT,
  achieved_at            TEXT NOT NULL,
  invalidated_at         TEXT
);
CREATE UNIQUE INDEX achievements_active_uniq
  ON achievements(rower_id, achievement_type, achievement_key)
  WHERE invalidated_at IS NULL;

-- Lifetime stats cache: re-derived, never authoritative. Kept for
-- cheap reads; recompute overwrites wholesale.
CREATE TABLE rower_lifetime_stats (
  rower_id               TEXT PRIMARY KEY REFERENCES rowers(id),
  total_distance_m       INTEGER NOT NULL DEFAULT 0,
  total_active_sec       INTEGER NOT NULL DEFAULT 0,
  total_strokes          INTEGER NOT NULL DEFAULT 0,
  total_sessions         INTEGER NOT NULL DEFAULT 0,
  computed_at            TEXT NOT NULL
);
```

### Workout hash

```sql
ALTER TABLE workout ADD COLUMN shape_hash TEXT;
CREATE INDEX workout_shape_hash_idx ON workout(shape_hash);
```

Backfill on migration (see Migration section).

## `on_session_change`

Single entry point for every lifecycle transition. Contract:

```go
type SessionChange string
const (
    SessionCreated     SessionChange = "created"
    SessionHardDeleted SessionChange = "hard_deleted"
    SessionCompacted   SessionChange = "compacted" // boot-janitor only
)

// Idempotent. Transactional. Runs inside the caller's tx when
// provided, else opens its own.
func OnSessionChange(ctx context.Context, tx *sql.Tx,
    rowerID, sessionID string, change SessionChange) error
```

Per change type:

| Change         | Action                                                        |
|----------------|---------------------------------------------------------------|
| `created`      | Read `summary_json.pb_candidates` for the new session; insert |
|                | PB rows that beat current actives; generate volume-milestone   |
|                | rows for any newly-crossed threshold; refresh                 |
|                | `rower_lifetime_stats`. Strokes still exist at this point but |
|                | are deleted by FEAT-0009 Mode 0 *after* this hook returns.    |
| `hard_deleted` | `DELETE FROM pb_* WHERE source_session_id = X`; same for       |
|                | `achievements`. Then **full recompute** by scanning every      |
|                | remaining session's `summary_json.pb_candidates`; per-rower    |
|                | active for each (distance / window / workout) becomes the     |
|                | best candidate across live sessions. Refresh                  |
|                | `rower_lifetime_stats`.                                       |
| `compacted`    | Reserved enum value for the boot-time janitor's repair path.  |
|                | In steady state never fires — Mode 0 compaction is part of    |
|                | the `created` transaction.                                    |

Full-recompute cost is bounded: O(sessions) — one scan over
`summary_json` per rower, each row cheap because the candidates
are pre-computed. At 1 000 sessions, comfortably sub-second on a
Pi. If measurement shows otherwise, ADR-0008 reserves the option
to move the recompute into a background goroutine with UI
"Stats aktualisieren…" feedback.

### Newly-crossed milestones

A "newly crossed" milestone is one whose threshold ≤ new lifetime
total **and** no active achievement row exists for `(rower_id,
volume, key)`. This is derived, not event-sourced — a soft-delete
that drops the rower back below 100 km invalidates the `distance_100km`
row; the next session that crosses 100 km again inserts a new one.

## API

Per-PB endpoints return snapshot data directly; nothing here needs
to join back to `sessions` to render.

| Method | Path                                          | Purpose                   |
|--------|-----------------------------------------------|---------------------------|
| GET    | `/api/v1/rowers/{id}/pbs`                     | All active PBs grouped    |
| GET    | `/api/v1/rowers/{id}/pbs/history`             | Invalidated + active      |
| GET    | `/api/v1/rowers/{id}/achievements`            | Milestones + consistency  |
| GET    | `/api/v1/rowers/{id}/lifetime`                | Cached `rower_lifetime_stats` |
| GET    | `/api/v1/sessions/{id}/pb-banners`            | PBs this session set      |

`pb-banners` is what FEAT-0003a renders as the ribbon badge: every
active PB whose `source_session_id = {id}`. The badge is **not
dismissable** — a session that contains a PB always shows it on
re-open. Decision: a PB is a fact about the session, not a
notification, so it persists with the session view forever.

## Post-session-end UI states

`on_session_change(created)` runs in a background goroutine
(per ADR-0008). Between `session_end` arriving and the recompute
finishing, the UI can be in three states:

| State            | When                                                                | UI shows                                                       |
|------------------|---------------------------------------------------------------------|----------------------------------------------------------------|
| **Computing**    | session_end emitted; `stats_version` not yet bumped                 | "Bestleistungen werden berechnet…" + skeleton on the PB strip  |
| **Resolved, no PB** | recompute done, no new actives for this session                  | Hero summary as today; PB strip absent                         |
| **Resolved, PB(s)** | recompute done, ≥ 1 PB row with `source_session_id = this`       | Ribbon banner(s): `🏆 Neue Bestzeit über 2000 m`, etc.         |

Mechanism:
- Every HTTP write returns a `X-Stats-Version` response header (a
  monotonic counter on `rower_lifetime_stats.computed_at` or a
  per-rower seq column).
- The Live page caches the version it last saw. When session_end
  arrives, the page polls `GET /api/v1/sessions/{id}/pb-banners`
  with a small backoff (e.g. 250 ms → 500 ms → 1 s, max ~5 s) until
  the response carries an `X-Stats-Version` newer than the cached
  one. Then it renders the resolved state.
- If polling exceeds a timeout (e.g. 10 s), the page falls back to
  the resolved-no-PB state and the UI quietly catches up on the
  next mount of Session-Detail. Recompute drift is treated as a
  bug, not as silent data loss.

Same pattern applies to the Profil PB grid: it reads with a
`If-None-Match` / `X-Stats-Version` and updates when the version
bumps. No manual reload required.

This is the only place the asynchronous recompute leaks into the
UX. Everywhere else (Historie list, lifetime totals, Wartung
footprint) the small delay is invisible to the user.

## UI implications

Out of scope for implementation here — listed so the feature-map is
explicit for downstream specs.

- **Session-Detail** (FEAT-0003a): ribbon-badge already defined for
  one PB; extend copy to handle multiple (`🏆 Neue Bestzeit: 2000 m
  + 60 s Power`).
- **Profil** (FEAT-0004): PB grid renders from `pb_distance`
  actives; window-PB and workout-PB grids are new sections.
  Invalidated history behind a collapsed "Historie" toggle.
- **Home-Screen** (FEAT-0001a): optional "Nächster Meilenstein in
  N km" tile using the active milestone + next-unclaimed threshold.

Each is a separate change set; this spec only provides the data
and the API.

## Acceptance criteria

- [ ] After a session lands, every standard-distance PB that beats
      the current active is inserted; the prior active is moved to
      `invalidated_at` for historical visibility.
- [ ] A PB can be set by an inner window of a longer session — e.g.
      a 6 k session sets a new 2 k PB equal to the fastest 2 k
      window inside it.
- [ ] Window-PBs for power 60 s, DPS 30-strokes, SPI 30-strokes are
      computed and stored in `pb_window`. (Pace 60 s was retired —
      see the note above the table in section (b).)
- [ ] Adding a new window value to the Go constant list is a code-
      only change — no migration, no schema change — and the next
      recompute populates it.
- [ ] `shape_hash` is stable across two separately-created workouts
      with identical mode/params/warmup/cooldown. Differing
      `intensity` does **not** change the hash.
- [ ] A session attached to a workout updates `pb_workout` keyed by
      `shape_hash`, not `workout.id`.
- [ ] Volume milestone rows appear in `achievements` when a rower
      crosses 10/25/50/100/…/5000 km, and again if they drop below
      (soft-delete) and re-cross later.
- [ ] Lifetime stats in `rower_lifetime_stats` match the sum over
      non-deleted sessions after every `on_session_change`.
- [ ] Soft-deleting a session invalidates any PBs it set; a
      `pb-banners` query on that session now returns empty; a
      different session's once-second-place effort is promoted to
      active.
- [ ] Hard-deleting physically removes PB rows tied to the session;
      the recompute re-creates the next-best actives.
- [ ] PB endpoints return snapshot data without joining to
      `strokes`; every past session is "compacted" the moment it
      ends, so this is the standard render path, not a fallback.
- [ ] After session_end, `summary_json.pb_candidates` is populated
      with the per-distance / per-window / per-workout best of
      that session; the strokes deletion that follows in FEAT-0009
      Mode 0 does not affect achievement state.
- [ ] Soft-deleting a session A whose 2 k PB was current promotes
      session B's 2 k candidate (the next-best across remaining
      live sessions) without touching strokes.
- [ ] Three within-session consistency PBs (`power_cv`,
      `pace_split_cv`, `spm_cv`) recorded when the session has at
      least 80 active strokes; CV computed correctly (`σ / mean`).
- [ ] PB banners on Session-Detail are persistent (not
      dismissable) — re-opening a past PB session always shows
      its banner(s).

## UX notes

- Ribbon copy in German (`🏆 Neue Bestzeit über {distance}`,
  `🏆 Neue Bestleistung: {metric} ({window})`, `🏆 Meilenstein:
  {n} km Gesamtdistanz`).
- Historical invalidated PBs render muted, with the date and a
  strike-through value; tap expands to show which session set it
  and which session broke it.
- Milestones show a "nächster Meilenstein in X km" progress bar
  derived from `rower_lifetime_stats.total_distance_m` vs. the
  next threshold, computed client-side.

## Non-goals

- Cross-rower leaderboards (explicit non-goal of FEAT-0004).
- Badges based on age-graded / weight-graded times.
- Push / email notifications for new PBs; the ribbon + Profil
  grid is the notification surface.
- Editable PB notes. PBs are facts, not journal entries.

## Migration

Empty-DB assumption. A single schema migration applied at startup:

1. Create the five new tables and indexes.
2. Add `workout.shape_hash`. (Existing `workout` rows in a
   non-empty dev DB get a hash backfilled in-process; on a fresh
   deploy the column is just empty.)

No historical recompute, no stroke backfill, no
`migrations_applied` sentinel. PB tables start empty and fill from
the first new session forward.

Existing FEAT-0004 PB acceptance items become implemented via this
spec; no separate PB computation code should remain.

## Resolved (no longer open)

- **Hash canonicalisation**: SHA-256 over JSON-sorted-keys-no-whitespace
  of `{mode, params, warmup_sec, cooldown_sec}`. `intensity`
  excluded. `warmup_sec`/`cooldown_sec` coerced to int seconds.
- **Window list**: power 60 s, DPS 30-strokes, SPI 30-strokes.
  Pace 60 s was retired (see section (b)).
- **Consistency PBs**: three within-session CVs (power, pace-split,
  spm). 80-stroke minimum.
- **Multi-session corridor**: relative ±3 % around 30-session
  median pace.
- **Celebrated-state**: dropped. PB banners are persistent facts,
  not dismissable notifications.
- **PB history depth**: keep all invalidated rows forever.
- **Recompute model**: background goroutine + `X-Stats-Version`
  header + UI polling (see Post-session-end UI states).
- **Migration backfill**: dropped. Empty-DB assumption — no
  historical strokes to scan.

## Open questions

None. All design decisions are resolved as listed above; remaining
work is implementation.
