# Historie-Optimierung — Verlauf + Rekorde

Design spec, 2026-06-11. Outcome of the history/stats feature review
(same date) and a brainstorming session. Supersedes the current
three-tab structure (Sessions · Trends · Rekorde).

Amended same date after a full code review (backend, frontend, tests,
e2e) verified every premise against the implementation. The two
substantive corrections: workout-PBs are a **build, not a trim** (the
pipeline is dead code today), and the records migration must ship
**in lockstep with the recompute code changes** or the next recompute
resurrects the invalidated rows. See §Implementation architecture for
the extraction-first slice the test plan depends on.

Amended 2026-06-12 after the data-integrity precondition fixes landed
(`01c97b2`, `e72cd26`, `42f5e69`, `ddf7489`, `f387b51`) and were
code-reviewed. The preconditions are **done**; what changed in this
spec as a result: the prune that shipped is deliberately narrower
than first written (zero persisted strokes, not zero *work* strokes),
so the trends endpoint additionally **filters zero-work sessions**
(§Backend & data); the records migration is now **0018** (0017 is the
phantom prune) and is preceded by a **migration-runner transaction
fix** — the earlier claim that migrations run transactionally was
wrong.

## Goals

The section serves three jobs, in priority order:

1. **Am I getting better?** — progress per comparable workout, in the
   metrics rowers think in (split, watts, SPM, DPS).
2. **How was my last session?** — quick post-row review.
3. **What are my records?** — the trophy wall.

"Am I training enough?" (volume/habit) is explicitly demoted: volume
appears as a footnote, never as the headline.

Non-goals: streaks/gamification beyond existing milestones, social
features, new workout modes.

## Decisions carried in from the review

- **SPI is retired everywhere** (task #2). It had two conflicting
  definitions (watts/spm with integer division in the sessionizer;
  joules/stroke in the window-PB candidates) and means nothing to
  rowers.
- **DPS is the efficiency metric** and gets first-class display
  (task #3).
- **Auswertung (per-session insights) stays as is** and is backfilled
  for historical sessions (task #1).
- **Konstanz-Bestleistungen are cut from Rekorde.** Within-session
  consistency lives solely in the per-session Auswertung finding.
  Cross-session consistency "records" (best-ever CV across unlike
  workouts) are statistically indefensible and demotivating.

## Structure

Two tabs under Historie:

- **Verlauf** (default) — merges the old Sessions and Trends tabs.
- **Rekorde** — the trophy wall.

Routing: `/historie` renders Verlauf; `/historie/rekorde` unchanged;
`/historie/trends` redirects to `/historie`; query `range=week`
(old links) maps to the month window. `/historie/:sessionId` detail
route unchanged.

## Verlauf

Top to bottom (iPhone, single column):

### 1. Global range bar

`Monat · Jahr · Alles`. **Woche is dropped.** One window scopes
everything on the surface — chart, session list, volume footnote.
Persisted in the URL query (`?window=`), default Monat.

Windows are **rolling and end today**: Monat = last 30 days, Jahr =
last 365 days, Alles = everything. Consequences:

- The delta in the volume footnote always compares equal-length
  windows (last 30 days vs the 30 days before), so the
  "−98 % on the 1st of the month" failure mode is impossible.
- There is exactly one window. The current split between "headline
  period" and "silently wider chart window" is removed.

### 2. Progress card

One chart card.

- **Line series**: completed sessions (≥ 80 % of workout target,
  existing rule) of one workout shape (shape_hash grouping,
  unchanged). If several shapes have ≥ 3 completed sessions in the
  window, small chips (`5 km · 2 km · …`) switch the line; default is
  the most-rowed shape in the window.
- **Context dots**: every other session in the window (Just Row,
  intervals, aborted, other shapes) renders as a faint dot at its avg
  split (or the toggled metric). Nothing rowed is invisible; a
  free-rower sees dots instead of an empty chart. Exception:
  zero-work sessions (warmup-only, race false-start) are filtered by
  the API and never appear — as dot, list row, or footnote
  contribution (§Backend & data).
- **Metric toggle**: `Split | Watt | SPM | DPS`. Split is default.
  DPS folds in here — there is no separate Effizienz chart anymore.
  Data is already in the API per point (avg_pace / avg_power_w /
  avg_spm / avg_dps).
- **Scrubber** (existing) stays: drag shows per-point strip values,
  tap on a dot opens the session AND highlights the matching list row.

### 3. Session list

All sessions in the window, newest first. Row: date, workout-shape
chip, distance, time, split (visually strongest element). Tapping a
row opens session detail. 🏆 badge only when the session set a
**standard-distance PB** — not for window/workout PBs — so the badge
stops appearing on virtually every row.

Chart dots and list rows are two views of the same items: selecting
either highlights both.

### 4. Volume footnote

One quiet line: `Letzte 30 Tage: 12 km · 6 Sessions · 1 h 30 min`
plus a small, fair delta vs the prior equal-length window (no red
oversized percent chip). Durations use real units (`1 h 30 min`,
`2 min`) — never bare `h:mm` like the current `Dauer 0:01`.

### Empty states

Keep the existing pattern: copy + widen-range action
("Zeitraum erweitern → Jahr"). With context dots, the chart is
non-empty whenever any session with work strokes exists in the
window (zero-work sessions are API-filtered and don't count).

## Chart rules (all charts in the section)

- **Split axis is NOT inverted.** Lower split = lower on the axis,
  matching erg displays rowers know. Watt/SPM/DPS naturally read
  up = better. Verified 2026-06-11: the current `TrendsChart` already
  complies (`toY` maps lower values lower, pace is passed raw) — this
  is a keep-it rule for the new chart family, not a work item.
- **Reference lines are always direct-labeled** — no line without its
  name and value printed at its right end in the line's own color:
  gold dashed `PB 1:47` (distance-PB pace, from the already-plumbed
  `pb_pace_sec_per_500m`; Split mode only), grey dashed `Ø 14 T`
  (rolling average, all modes). Rolling-average window per range keeps
  the existing mapping minus Woche: Monat → 14 d, Jahr → 30 d,
  Alles → 90 d. At most two reference lines per plot. The scrubber
  strip uses the same color swatches.
- **X ticks sit on calendar boundaries** (day/week/month/year starts)
  chosen from the actual data span, deduplicated, with the coarser
  unit appended when the span crosses it ("Mai ’26"). This makes the
  observed bug class (2026 2026 2026 / Mai Mai Mai / weekday labels
  on an 8-week window) structurally impossible.
- **Y ticks on round values** per metric (split: 5 s steps; watt:
  10 W; SPM: 1; DPS: 0.5 m), not data-span ± 5 %.
- **Strip delta in rower language**: `−1,3 s vs Ø 14 Tage`, not
  `↓0:01.3 vs 14-d Ø`. Sign and color agree (no `↓ −98 %`
  double-encoding anywhere).

## Responsive layout

Targets: iPhone (~390 pt) and iPad (~768 pt+).

- **iPhone**: single column as described above.
- **iPad (≥ 768 pt)**: Verlauf becomes **two panes** — range bar +
  progress card + volume footnote fixed on the left, session list
  scrolling independently on the right. Chart and list share the
  screen permanently, making the dot ↔ row link the primary iPad
  interaction. Rekorde scales its existing card grids to the width
  (no second layout).
- Both form factors are covered by the e2e capture spec (below).

## Rekorde

- **Distance-PB grid**: layout unchanged; the displayed date becomes
  `source_session_started_at` (fixes every card reading the recompute
  date, e.g. "11.06.26" on all PBs). Frontend-only: the API already
  returns the field and the hero/timeline entries already prefer it —
  the grid card is the one consumer reading `achieved_at`. Deep-link
  flash stays.
- **Window-PBs**: only `Beste 60 s Ø Power` survives — an honest
  sprint benchmark that gives short hard sessions a record to aim at.
  The SPI *and* DPS window-PB definitions are deleted (`WindowDefs`
  shrinks to power/seconds/60): SPI is retired entirely; DPS as a
  trophy rewards low-rate hauling, not progress — it stays first-class
  in the Verlauf metric toggle and the planned Auswertung detector,
  where it compares like with like. Existing spi/dps `pb_window` rows
  are invalidated by migration and drop out of cards, hero, timeline,
  and session-detail PB banners.
- **Workout-PBs are built, time-mode only, with the duration named.**
  Reality check (2026-06-11 review): the workout-PB pipeline is dead
  code — `PBCandidates.Workout` is never populated anywhere, so
  `session_pb_workout_candidate` and `pb_workout` are empty on every
  device. This is a build, not a trim:
  - The persister emits a time-mode candidate (`value_kind =
    distance_m`, value = work-phase distance, higher better) only
    when the work phase ran the fully prescribed duration
    (CONTEXT.md §PB-leader / pb_workout). Distance/race-mode sessions
    never emit one — which also settles "distance-mode workout-PBs
    are dropped" (redundant with the Distanz grid): there is nothing
    to invalidate, just no branch to build.
  - Historical time-mode sessions are **backfilled in the same
    migration**: unlike window-PBs, the candidate needs only session
    aggregates (work distance, work time, decoded params for the
    completion check), not strokes — so the section isn't empty on
    day one and the FEAT-0010 "cannot back-fill" caveat does not
    apply here.
  Time-mode cards render as `Beste Distanz · 20 min: 4.812 m`, the
  duration taken from the workout params. This section is the
  natural home of classic 20/30/60-min tests.
- **Konstanz-Bestleistungen: section deleted.** Consistency
  achievements (`consistency_intra`) are invalidated by migration and
  no longer produced by recompute.
- Hero ("Neuester Erfolg"), Meilensteine, and the achievement
  timeline stay, minus SPI/DPS-window/Konstanz/distance-workout
  entries.

## Session detail

- Hero loses **Ø SPI**; keeps Distanz, Zeit, Ø Split, Ø SPM, Ø Watt,
  Ø DPS, Schläge.
- The three charts (Split/Watt/SPM-Verlauf) adopt the shared chart
  rules: round y-ticks, time x-axis, direct-labeled grey reference
  line for the session Ø. Same component family as the progress
  chart — one chart language everywhere.
- Auswertung unchanged in shape; historical sessions get findings via
  backfill (task #1). A DPS detector for the defined-but-empty
  EFFICIENCY category is a follow-up (task #3).

## Backend & data

- **Trends endpoint reworked to the one-window model**:
  `GET /api/v1/rowers/{id}/trends?window=30d|365d|all` returns
  - all session points in window (timestamp, session id, mode/shape,
    distance, time, avg split/watt/spm/dps, plus a
    `distance_pb: bool` flag — true only for standard-distance PBs,
    driving the list's 🏆 badge) — feeds context dots AND the session
    list in one fetch; **sessions with zero work strokes are
    excluded** from points, list, and totals (warmup-only and
    false-start-only sessions persist with stroke rows and zero work
    totals — the prune cannot delete them, see §Data-integrity
    preconditions);
  - per-shape series of completed sessions (existing grouping),
    each with `pb_pace_sec_per_500m`;
  - window totals + prior-equal-window totals for the footnote delta.
  The never-rendered `performance`/`efficiency` aggregate blocks and
  all SPI fields are removed from the response.
  Implementation note: this is a **rewrite of the handler, not a
  patch**. `getTrends` today mixes calendar-period math, a silently
  wider chart window, per-session aggregation, and response assembly
  in one ~230-line function; the dual-window logic and the dead
  blocks die together with the shape change. The proven seams carry
  over as-is: `isCompletedSession` (single source of truth via
  `workout.DecodeParams`), shape-hash grouping (ADR-0015),
  Berlin-time bounds. The `distance_pb` flag needs no new join:
  active `pb_distance` rows already carry `source_session_id` — a
  post-fetch map of standard-distance PB source sessions marks the
  points.
- **SPI removal end-to-end** (task #2): sessionizer accumulator,
  sample buckets, summary field, `WindowDefs` entry, API types.
- **One records change — code and migration in lockstep.** The
  migration is **0018** (0017 is the phantom prune, landed
  `e72cd26`). Precursor, since 0018 is multi-statement:
  `applyMigrations` (db.go) currently execs migration bodies
  **without** a transaction — it must first be changed to wrap each
  migration body plus its `schema_migrations` insert in one
  transaction (fixes the class for all future migrations; 0017 was
  safe only as a single implicitly-atomic DELETE). Recompute
  re-creates active PB rows from the candidate tables, and the
  spi/dps/consistency candidates persist; an invalidation-only
  migration would be undone on the next recompute. One commit ships
  all of:
  - `WindowDefs` shrinks to power/seconds/60 — this also stops
    candidate *emission* for spi/dps, since `ComputeCandidates`
    iterates `WindowDefs`;
  - the recompute window query's metric filter
    (`metric IN ('power','dps','spi')`) shrinks to `'power'`;
  - `recomputeConsistency` is deleted and the persister stops
    emitting `session_consistency` candidates (the table feeds
    nothing else);
  - `recomputeWorkout` keeps only the time-mode branch
    (`value_kind = 'distance_m'`, DESC); the distance-mode branch
    (`value_kind = 'time_sec'`) is deleted;
  - the persister starts emitting time-mode workout candidates and
    the migration backfills them from session aggregates (see
    §Rekorde);
  - the migration invalidates spi + dps `pb_window` rows and
    `consistency_intra` achievements (distance-mode `pb_workout`
    rows: none exist, nothing to invalidate);
  - the FEAT-0010 "locked WindowDefs" note gets an amendment
    documenting the removals and the workout-PB addition.
- **Empty-session prune** — ✅ landed (`01c97b2`, migration 0017
  `e72cd26`); see §Data-integrity preconditions for what actually
  shipped and the residual zero-work class the endpoint filter above
  covers.
- Unchanged: ≥ 80 % completion rule, shape-hash series grouping
  (ADR-0015), Berlin-time window bounds.

## Implementation architecture

Constraints from the 2026-06-11 code review. These are preconditions
for the test plan below, not nice-to-haves.

### Data-integrity preconditions — ✅ landed 2026-06-11/12

Surfaced by a real rowing session on 2026-06-11 (journal- and
DB-verified, not theory). Verlauf renders sessions in the window as
dots, list rows, and contributions to the volume footnote — so any
phantom or empty session is a visible defect and poisons the e2e
capture fixtures. These fixed the **sources** of bad rows; they were
not part of the live-surface redesign (still out of scope), only the
data the new endpoint reads. All three landed and were code-reviewed
on 2026-06-12; statuses below record what actually shipped where it
deviates from the original wording.

- **Empty sessions never persist.** ✅ Landed (`01c97b2`; migration
  0017 `e72cd26` removed the existing phantoms `01KTW2CNVS`,
  `01KTW2DKXS`, `01KTW3SBV4`). What shipped is deliberately narrower
  than first written: pruned is an ended session with **zero
  persisted strokes and an empty authoritative summary** — not "zero
  work strokes" — because deleting stroke-bearing sessions would
  violate replay-grade persistence (ADR-0011) and the strokes FK.
  The prune lives in `persister.applySessionEnd` (logged); the boot
  janitor's zero-stroke delete and the stale path's `ErrZeroStrokes`
  cover the other two shutdown routes through `FinaliseSession`.
  Residual class this leaves: a deliberately ended warmup-only or
  race-false-start session persists with stroke rows and zero work
  totals — handled by the trends endpoint's zero-work filter
  (§Backend & data), same user-visible outcome, data kept.
- **Discard leaves no trace and pops no save-overlay.** ✅ Landed
  (`42f5e69`): the two duplicated `onDiscard` closures collapsed
  into one `useDiscardSession` hook (used by `WorkoutProgressStrip`
  and `PauseDialog`) that sets the discarding intent *before*
  awaiting the delete, suppresses the save-overlay latch, and clears
  the `sessionStorage` latch. The e2e (`discard-session.spec.ts`)
  covers overlay suppression and return-home; the remaining
  acceptance assertions are deferred to the Verlauf list slice
  (§Testing).
- **Foreign keys already enforced** (verified 2026-06-11, no work
  needed). The app opens SQLite with `_pragma=foreign_keys(on)` in
  the DSN (`storage/db.go`), so enforcement is on per-connection — a
  stroke cannot reference a deleted session. The `PRAGMA
  foreign_keys → 0` observed earlier was the `sqlite3` CLI's own
  default on the file, not the app's connection. The orphan-row
  class is already structurally impossible. Correction 2026-06-12:
  the earlier claim that migrations run inside a transaction was
  wrong — `applyMigrations` execs bodies un-wrapped; 0017 was safe
  only as a single statement. The runner fix under §Backend & data
  closes this for 0018+.

### Extraction-first slice

The unit tests this spec demands are currently unwritable: tick and
axis logic lives inline in `TrendsChart` useMemos, and no
human-duration formatter exists. The first implementation slice
extracts pure modules, each landing **together with its unit suite**,
before any UI work consumes them:

- `selectXTicksAtCalendarBoundaries(from, to)` (frontend) — replaces
  linear min/max interpolation plus range-keyed labels. That pairing
  is the root cause of the observed axis bug class: labels were
  chosen by the *range name* while the chart silently plotted a
  *wider window* (range=all → "2026 2026 2026", range=week → weekday
  letters across 8 weeks). Deriving ticks from the actual data span
  makes the class structurally impossible.
- `selectYTicksRound(min, max, metric)` (frontend) — round steps per
  metric as defined under §Chart rules.
- `formatDurationHuman(sec)` (frontend) — `1 h 30 min`, `2 min`;
  becomes the only formatter for duration totals, replacing `hhmm`
  at those call sites.
- Window bounds + fair delta (backend) — one function returns the
  rolling window `[now − N d, now]` and the prior window
  `[now − 2N d, now − N d)` in Berlin time; invariant under test:
  both windows are always equal length, for every `now`.

### One chart family

Three chart implementations exist today: `TrendsChart` (axes,
rolling average, scrubber), `LineChart` (session detail — no axes at
all), and a vestigial `DualLineChart`. Target: one family.

- Shared primitives: plot scales, calendar x-axis, round y-axis,
  direct-labeled reference lines (gold PB / grey Ø), scrubber strip.
  `useChartScrubber` is already a deep module and carries over
  unchanged.
- The progress chart and the three session-detail charts are
  consumers of the family. `LineChart` is rebuilt on it;
  `DualLineChart` is deleted.
- The PB reference line is new chart code: `pb_pace_sec_per_500m` is
  plumbed in the API but never drawn today.

### Test conventions

- Backend response tests decode into **typed structs / golden
  fixtures**, not `map[string]any` — today's trends tests miss field
  removals silently. The new trends response lands with a typed
  golden test from day one.
- Frontend response mocks are **typed `TrendsResponse` literals** so
  the compiler flags drift; today's plain-object `trendsBody()`
  fixtures don't.
- Assertions track acceptance criteria, not implementation details:
  e.g. the existing "renders exactly 3 gridlines" assertion dies
  with round y-ticks — assert the tick *values* per metric instead.
- The records migration test follows the existing
  `TestRecomputeInvalidatesOnDeletedSource` template (invalidate →
  recompute → assert active set).
- E2E seeding: the `seedTrendsSessions` helper inserts session rows
  by hand and must track the schema (`avg_spi` goes away). Driving
  the 🏆 badge, the PB reference line, and the Rekorde cards needs
  seeded `pb_distance`/`pb_workout` rows or a recompute trigger in
  the seed helper.

## Testing

- **Unit**: calendar-boundary tick generation (regression suite for
  the axis bug class: single-year span, two-month span, multi-year
  span, sparse data), rolling-window bounds + fair-delta windows
  (equal-length invariant), round y-tick selection, human duration
  formatting.
- **API**: typed golden tests for the new trends response shape;
  migration test proving spi/dps `pb_window` rows and Konstanz
  achievements are invalidated and absent from responses, and that
  the workout-PB backfill produces time-mode rows from historical
  session aggregates.
- **Data-integrity preconditions** — partially delivered with the
  fixes. ✅ Delivered: prune unit/integration tests
  (`persister_test.go`), migration-predicate test
  (`migrations_prune_test.go`), discard e2e
  (`discard-session.spec.ts`) for overlay suppression + return home.
  **Outstanding, owned by the Verlauf/trends slices** (they need the
  new list and seed helpers): the response-level assertion that
  pruned and zero-work sessions are absent from the trends/list
  responses (fold into the typed golden tests), and the discard
  e2e's remaining assertions — *session absent from the list,
  Verlauf, and Rekorde; a fresh session starts cleanly* — which
  close the latch-leak and dead-deep-link coverage.
- **E2E**: new `web/tests/e2e/ux-audit/history-capture.spec.ts`
  driving Verlauf (all three windows, metric toggle, dot↔row link)
  and Rekorde on phone + tablet viewports, so the section joins the
  ux-heuristic-audit pipeline.

## Out of scope / follow-ups

- DPS detector in insights (EFFICIENCY category) — tracked in task #3.
- Insights backfill implementation — tracked in task #1.
- Any redesign of the live/workout surfaces. Note the boundary: the
  two data-integrity preconditions above (empty-session prune,
  discard-flow integrity) are in scope because they are *sources* of
  the rows Verlauf renders — not redesign.
- **Warmup-countdown regression** — ✅ fixed (`ddf7489`: the leading
  warmup counts against `phase_time_sec`; `f387b51`: a completed
  warmup no longer skews following time-based work segments via
  `timeAnchor`). The previously missing warmup test class now exists
  in `segments.test.ts`, including a time-mode-after-warmup case.
