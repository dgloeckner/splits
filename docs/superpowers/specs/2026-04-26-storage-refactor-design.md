# Storage refactor: typed session aggregates + native PB candidates

**Status:** approved 2026-04-26
**Sub-project:** A (precedes 2026-04-26-history-trends-design)

## Problem

Session aggregate metrics, PB candidates, consistency stats, and the
downsampled samples blob all live in a single `summary_json` TEXT column on
`sessions`. Every code path that needs any of those fields must
`json.Unmarshal` the whole blob.

PB recompute reads every non-deleted session for a rower and parses each
`summary_json` solely to extract `pb_candidates`. Samples bloat each parse to
tens of KB. The forthcoming Trends endpoint would compound the cost — it
reads aggregate metrics across every session in a date range.

## Goals

- Recompute reads only the data it needs, with index-only scans where possible.
- Aggregate reads (Trends) hit typed columns, no JSON.
- One source of truth per data point; no drift between JSON and columns.
- Session-detail rendering unchanged from API consumer perspective.

## Non-goals

- Frontend changes (handled by sub-project B).
- Backfill of pre-existing data — new app, no production data to migrate.
- Removing `samples_json` — samples remain opaque per-session timeseries
  with no query needs beyond detail render.

## Design

### Schema changes (migration 0008)

**Add typed aggregate columns to `sessions`:**

```sql
ALTER TABLE sessions ADD COLUMN avg_power_w REAL;
ALTER TABLE sessions ADD COLUMN peak_power_w REAL;
ALTER TABLE sessions ADD COLUMN avg_spm REAL;
ALTER TABLE sessions ADD COLUMN avg_dps REAL;
ALTER TABLE sessions ADD COLUMN avg_spi REAL;
ALTER TABLE sessions ADD COLUMN avg_pace_sec_per_500m REAL;
ALTER TABLE sessions ADD COLUMN session_calories REAL;
```

`total_distance_m`, `total_time_sec`, `total_strokes` already exist as columns.

**Keep `summary_json` column name and TEXT type.** After refactor it carries
only `{samples: [...]}` — the downsampled per-bucket timeseries used by
session-detail charts. No rename: read pattern is always whole-blob (never
queried by row), single read site (`GET /api/v1/sessions/{id}/samples`), so
JSON remains the natural representation. Native-table extraction was
considered and declined — would add 200–1000 row inserts per session-end
with no read-perf gain.

**New native candidate tables:**

```sql
CREATE TABLE session_pb_distance_candidates (
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  rower_id TEXT NOT NULL,
  started_at TEXT NOT NULL,
  distance_m INTEGER NOT NULL,
  time_sec REAL NOT NULL,
  window_start_stroke INTEGER NOT NULL,
  window_end_stroke INTEGER NOT NULL,
  PRIMARY KEY(session_id, distance_m)
);

CREATE TABLE session_pb_window_candidates (
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  rower_id TEXT NOT NULL,
  started_at TEXT NOT NULL,
  metric TEXT NOT NULL,
  window_kind TEXT NOT NULL,
  window_size INTEGER NOT NULL,
  value REAL NOT NULL,
  PRIMARY KEY(session_id, metric, window_kind, window_size)
);

CREATE TABLE session_pb_workout_candidate (
  session_id TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
  rower_id TEXT NOT NULL,
  started_at TEXT NOT NULL,
  shape_hash TEXT NOT NULL,
  mode TEXT NOT NULL,
  value_kind TEXT NOT NULL,
  value REAL NOT NULL
);

CREATE TABLE session_consistency (
  session_id TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
  rower_id TEXT NOT NULL,
  started_at TEXT NOT NULL,
  power_cv REAL NOT NULL,
  pace_split_cv REAL NOT NULL,
  spm_cv REAL NOT NULL
);
```

`rower_id` and `started_at` denormalized so recompute queries scope by rower
without joining `sessions`. ON DELETE CASCADE handles hard-delete; soft-delete
issues an explicit DELETE on candidate rows.

**Indices:**

```sql
CREATE INDEX idx_pbc_dist_rower
  ON session_pb_distance_candidates(rower_id, distance_m, time_sec);
CREATE INDEX idx_pbw_rower
  ON session_pb_window_candidates(rower_id, metric, window_kind, window_size, value);
CREATE INDEX idx_pbo_rower
  ON session_pb_workout_candidate(rower_id, shape_hash, value);
CREATE INDEX idx_pbcons_rower
  ON session_consistency(rower_id);
```

Each index is covering for its respective recompute query: rower scope first,
then grouping keys, then sortable value last.

### Write path (`backend/internal/storage/persister.go`)

At session end, the in-memory `SessionSummary` struct (unchanged) is split:

1. Aggregate metric fields → UPDATE `sessions` columns
2. `samples` slice → marshalled into `summary_json` as `{samples: [...]}`
3. `pb_candidates.distance` → INSERT rows into `session_pb_distance_candidates`
4. `pb_candidates.window` → INSERT rows into `session_pb_window_candidates`
5. `pb_candidates.workout` (optional) → INSERT row into `session_pb_workout_candidate`
6. `pb_candidates.consistency` (optional) → INSERT row into `session_consistency`

All inside the existing session-end transaction.

### Soft-delete (`storage/queries.go` or wherever soft-delete lives)

Soft-deleting a session: in the same transaction, `DELETE FROM
session_pb_*_candidates WHERE session_id = ?` and the consistency row.
Candidate rows are derived; they don't need to survive the parent's soft
state. Recompute queries gain simplicity (no `WHERE deleted_at IS NULL`).

Undelete (currently unused but defined): rebuild candidates from scratch
using the same struct→rows mapping the persister uses. Out of scope unless
already implemented; flag if the read path requires it.

### Recompute (`backend/internal/stats/recompute.go`)

Replace the current `SELECT … summary_json` + `json.Unmarshal` loop with four
SQL aggregates, each picking the best candidate per group:

```sql
-- Distance PBs
SELECT distance_m, time_sec, session_id, started_at,
       window_start_stroke, window_end_stroke
FROM (
  SELECT distance_m, time_sec, session_id, started_at,
         window_start_stroke, window_end_stroke,
         ROW_NUMBER() OVER (
           PARTITION BY distance_m ORDER BY time_sec ASC
         ) AS rn
  FROM session_pb_distance_candidates
  WHERE rower_id = ?
)
WHERE rn = 1;
```

Analogous queries for window (metric/kind/size), workout (shape_hash, with
ORDER BY direction depending on `value_kind`), and consistency (per CV
metric, ORDER BY value ASC).

Lifetime totals + volume milestones still need session-level aggregates:

```sql
SELECT SUM(total_distance_m), SUM(total_time_sec), SUM(total_strokes), COUNT(*)
FROM sessions WHERE rower_id = ? AND deleted_at IS NULL AND ended_at IS NOT NULL;
```

Pure SQL. No Go-side iteration.

### Read path (`sessions.go`, session detail)

Session-detail GET reads aggregate columns directly + reads `summary_json` for
the samples timeseries. Builds the existing `SessionSummary` API shape from
columns + samples. API response shape unchanged.

`storage/reads.go` SELECT lists updated to pull aggregate columns instead of
parsing the old broad `summary_json`. `summary_json` is read only on the
session-detail / samples endpoint.

### Janitor

`storage/janitor.go` currently rekeys legacy CamelCase `summary_json` blobs
(e.g. `AvgPowerW` → `avg_power_w`). After refactor those keys live in typed
columns, not JSON. The remaining `summary_json` content (samples) was never
CamelCased. Drop the rekey path entirely, or narrow it to no-op.

## Test plan

### Migration test
- Apply 0008 against a DB seeded with prior-format data (no production, but
  test fixtures exist). Verify post-migration row counts and column presence.

### Persister tests
- Session end with full SessionSummary populates aggregate columns,
  `samples_json` (samples only), and the four candidate tables correctly.
- Sessions with no candidates (e.g. JustRow with no qualifying windows) leave
  candidate tables empty.

### Recompute tests
- Numerical equivalence vs old behaviour: seed N sessions with known
  candidates, compare PB tables before/after refactor produces same rows.
- Soft-delete a session → its candidates removed → next recompute excludes
  it.
- Empty rower → no PB rows, lifetime zeros.

### Read path tests
- Session detail GET returns same `SessionSummary` shape as before.
- `pbs_test.go` continues to pass.

## Risks

- **Soft-delete semantics on undelete.** If undelete is wired anywhere,
  candidate rows must be reconstructable. Audit current code; if undelete
  uses zero columns from candidates today, no action; otherwise add
  reconstruct path.
- **Index bloat.** Four covering indices increase write cost on session
  end. Acceptable: writes are infrequent (one per session), reads are
  hot.
- **`summary_json` content shrink.** Code that previously parsed it for
  aggregates/candidates must switch to columns/native tables. Grep all
  `summary_json` reads, audit each.

## Out of scope

- Frontend changes
- Backfilling existing rows
- Trends endpoint (sub-project B)
