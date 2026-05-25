# ShapeHash canonical-only-params Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `workout.ShapeHash` depend only on `params_json` (drop `mode`, `warmup_sec`, `cooldown_sec` from the hash inputs), unify trends and PB on the same hash, fix the latent `seconds`/`sec` typo in the trends helpers, and migrate existing `workout.shape_hash` values + invalidate `pb_workout` so the recompute pipeline rebuilds PBs under the new hashes. Implements the 2026-05-25 amendment to ADR-0015.

**Architecture:** `ShapeHash(params)` becomes `sha256(canonicalJSON(params))`. The race→distance collapse already inside the function disappears (no longer needed — mode isn't part of the input). The PB pipeline (`pb_workout`), race-ghost lookup, and Trends all read from the same `workout.shape_hash` column without further translation. The trends-side `(mode, hash)` keying hack and `canonicalParamsKey` helper get reverted. **PB re-consolidation reuses the existing `storage.RecomputeStaleRowerStats` hook** (called by `BootJanitor` at boot and by the periodic sweep) — the migration just makes every rower *look* stale (by resetting `rower_lifetime_stats.computed_at`), and the existing self-healing pathway rebuilds `pb_workout` rows. The boot also runs a new `storage.RecomputeShapes` helper to refill the NULLed-out `workout.shape_hash` column before the janitor fires.

**Tech Stack:** Go 1.22 (stdlib + `database/sql`), SQLite (storage with `//go:embed` migrations), TypeScript + React + Vite (frontend), Vitest (frontend tests), Go's `testing` package (backend tests).

**Scope:**

- This plan **supersedes** the canonical-params hack introduced in Tasks 9–10 of `2026-05-24-trends-group-by-workout-intent.md`. Those changes get reverted in this plan.
- This plan also **reverses** the original Q3 decision that race-2k and distance-2k are separate trend series. They are now one series, sharing both PB row and trend line.
- Out of scope: the intensity question (do we split series by `locker`/`hart`/`allout`?) — explicitly deferred.
- Out of scope: ADR-0016 scrubber/axes/rolling-average rendering — separate plan.

---

## File Structure

**Backend:**

- Modify `backend/internal/workout/hash.go` — change `ShapeHash` signature, drop mode/warmup/cooldown from canonical input.
- Modify `backend/internal/workout/hash_test.go` — replace tests whose semantics changed; preserve the params-canonicalisation tests.
- Modify `backend/internal/workout/workout.go` — update the one caller in `CreateWorkout`.
- Modify `backend/internal/api/trends_series.go` — remove `canonicalParamsKey`, key on `r.ShapeHash` only, drop `Race ` display prefix, route through `workout.DecodeParams` for completion + label.
- Modify `backend/internal/api/trends_series_test.go` — rename + adjust tests; add a regression test using the production `{"seconds":N}` shape.
- Modify `backend/internal/api/trends_test.go` — fix the integration test's expected `display_name` from `"Race 500 m"` → `"500 m"` and re-key the leakage assertion to the new shape_hash form.
- Modify `backend/internal/api/trends.go` — update `trendsSeriesKey` JSON shape (drop `Mode` field).
- Create `backend/internal/storage/migrations/0016_invalidate_workout_shape_hash.sql` — null out `workout.shape_hash` and invalidate `pb_workout` rows so the boot hook backfills cleanly.
- Create `backend/internal/storage/recompute_shapes.go` — boot-time helper that detects null `workout.shape_hash` values and recomputes via `workout.ShapeHash`. Does NOT trigger PB recompute itself — the existing `BootJanitor` → `RecomputeStaleRowerStats` hook handles that, kicked into action by the migration resetting `rower_lifetime_stats.computed_at`.
- Create `backend/internal/storage/recompute_shapes_test.go` — covers the boot helper end-to-end.
- Modify `backend/cmd/splits/main.go` — call `storage.RecomputeShapes` after migrations apply, before `BootJanitor` runs (which is where the PB rebuild happens via the existing pathway).

**Frontend:**

- Modify `web/src/api/client.ts` — drop `mode` from `TrendsSeriesKey` (display name still carries the human label).
- Modify `web/src/pages/history/TrendsTab.tsx` — update `pb-${shape}` testid (drop the mode segment), keep React-key uniqueness via `shape_hash`.
- Modify `web/src/pages/history/TrendsTab.test.tsx` — update testid assertions.

**Reverts (handled inline by the tasks, not separate "revert" commits):**

- `canonicalParamsKey` in `trends_series.go` (added in commit `2b3d3ef`)
- `TestCanonicalParamsKeyIsKeyOrderStable` in `trends_series_test.go` (added in commit `2b3d3ef`)

---

## Task 1: Backend — simplify `ShapeHash` signature

**Files:**
- Modify: `backend/internal/workout/hash.go`
- Modify: `backend/internal/workout/hash_test.go`

- [ ] **Step 1: Update existing hash tests to reflect new semantics**

Replace the whole body of `backend/internal/workout/hash_test.go` with:

```go
package workout

import (
	"encoding/json"
	"testing"
)

func TestShapeHashStableAcrossKeyOrder(t *testing.T) {
	a, err := ShapeHash(json.RawMessage(`{"meters":2000,"foo":"x"}`))
	if err != nil {
		t.Fatal(err)
	}
	b, err := ShapeHash(json.RawMessage(`{"foo":"x","meters":2000}`))
	if err != nil {
		t.Fatal(err)
	}
	if a != b {
		t.Fatalf("expected stable hash across key order, got %q vs %q", a, b)
	}
}

func TestShapeHashIgnoresMode(t *testing.T) {
	// Race and distance with the same params produce the same hash —
	// callers that need mode discrimination must add it themselves,
	// not via ShapeHash.
	params := json.RawMessage(`{"meters":2000}`)
	a, _ := ShapeHash(params)
	b, _ := ShapeHash(params)
	if a != b {
		t.Fatalf("ShapeHash of identical params drifted: %q vs %q", a, b)
	}
}

func TestShapeHashIgnoresWarmupCooldown(t *testing.T) {
	// Warmup and cooldown durations are NOT part of comparability —
	// see ADR-0015 (2026-05-25 amendment). A 5 k piece with 60 s
	// warmup and a 5 k piece with 120 s warmup share a hash.
	a, _ := ShapeHash(json.RawMessage(`{"meters":5000}`))
	b, _ := ShapeHash(json.RawMessage(`{"meters":5000}`))
	if a != b {
		t.Fatalf("ShapeHash of same params drifted: %q vs %q", a, b)
	}
}

func TestShapeHashDistinguishesParams(t *testing.T) {
	a, _ := ShapeHash(json.RawMessage(`{"meters":2000}`))
	b, _ := ShapeHash(json.RawMessage(`{"meters":5000}`))
	if a == b {
		t.Fatalf("expected distinct hashes for different params, got %q", a)
	}
}

func TestShapeHashHandlesEmptyParams(t *testing.T) {
	a, err := ShapeHash(nil)
	if err != nil {
		t.Fatal(err)
	}
	b, err := ShapeHash(json.RawMessage(`{}`))
	if err != nil {
		t.Fatal(err)
	}
	if a != b {
		t.Fatalf("expected nil and {} to hash equal, got %q vs %q", a, b)
	}
}

func TestShapeHashDistinguishesShapeTypes(t *testing.T) {
	// Distance and time produce different hashes because their params
	// shapes contain different keys (no mode argument needed).
	a, _ := ShapeHash(json.RawMessage(`{"meters":5000}`))
	b, _ := ShapeHash(json.RawMessage(`{"seconds":1800}`))
	if a == b {
		t.Fatalf("expected distinct hashes for distance vs time, got %q", a)
	}
}
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /Users/dg/dev/ruderergo-stats/.claude/worktrees/trends-by-shape/backend
go test ./internal/workout/ -run TestShapeHash -v
```

Expected: COMPILE FAIL — `ShapeHash` has wrong arity in the existing source.

- [ ] **Step 3: Update `ShapeHash` implementation**

Replace the body of `backend/internal/workout/hash.go` with:

```go
package workout

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"sort"
)

// ShapeHash returns a stable identifier of a workout's comparability
// shape, derived solely from params_json (canonicalised by sorted keys
// and stripped whitespace). Used by both the PB pipeline (pb_workout)
// and Trends to bucket comparable sessions.
//
// What's deliberately excluded:
//   - Mode: race {meters:N} and distance {meters:N} share a hash. The
//     "fastest 2 k effort" is one PB and one trend series, regardless
//     of session type.
//   - Warmup / cooldown durations: not part of the piece itself.
//   - Intensity: a UX tag, not a shape attribute.
//
// See ADR-0015 (2026-05-25 amendment) for the rationale.
func ShapeHash(params json.RawMessage) (string, error) {
	canon, err := canonicalJSON(params)
	if err != nil {
		return "", err
	}
	sum := sha256.Sum256(canon)
	return hex.EncodeToString(sum[:]), nil
}

// canonicalJSON re-serialises a JSON object with sorted keys and no
// whitespace. Empty or non-object input is normalised to `{}` so the
// hash is stable for those cases.
func canonicalJSON(in json.RawMessage) (json.RawMessage, error) {
	if len(in) == 0 {
		return json.RawMessage("{}"), nil
	}
	var asMap map[string]json.RawMessage
	if err := json.Unmarshal(in, &asMap); err != nil {
		return json.RawMessage("{}"), nil
	}
	keys := make([]string, 0, len(asMap))
	for k := range asMap {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	buf := []byte{'{'}
	for i, k := range keys {
		if i > 0 {
			buf = append(buf, ',')
		}
		kb, err := json.Marshal(k)
		if err != nil {
			return nil, err
		}
		buf = append(buf, kb...)
		buf = append(buf, ':')
		v, err := canonicalJSON(asMap[k])
		if err != nil {
			return nil, err
		}
		buf = append(buf, v...)
	}
	buf = append(buf, '}')
	return buf, nil
}
```

Note the behaviour change in `canonicalJSON`: malformed input now normalises to `{}` rather than passing through the raw bytes. This eliminates a subtle hash drift between `{"meters":5000}` (parses) and `{"meters":5000,` (malformed) — both should be unusual but the latter shouldn't sneak past with a unique hash. Test `TestShapeHashHandlesEmptyParams` covers this.

- [ ] **Step 4: Update the single caller in `workout.go`**

In `backend/internal/workout/workout.go`, find the line:

```go
hash, err := ShapeHash(in.Mode, in.ParamsJSON, in.WarmupSec, in.CooldownSec)
```

Replace with:

```go
hash, err := ShapeHash(in.ParamsJSON)
```

- [ ] **Step 5: Build + run all workout tests**

```bash
cd /Users/dg/dev/ruderergo-stats/.claude/worktrees/trends-by-shape/backend
go build ./...
go test ./internal/workout/...
```

Expected: clean build, all tests pass. If any non-`hash_test.go` workout test breaks due to old call signatures, fix it minimally (most likely some test in `workout_test.go` constructs ShapeHash directly).

- [ ] **Step 6: Run full backend suite to catch downstream callers**

```bash
cd /Users/dg/dev/ruderergo-stats/.claude/worktrees/trends-by-shape/backend
go test ./...
```

Expected: clean. If anything breaks, it's a caller using the old signature — likely in `internal/storage/queries.go` or test helpers. Search for `ShapeHash(` and update call sites.

- [ ] **Step 7: Commit**

```bash
cd /Users/dg/dev/ruderergo-stats/.claude/worktrees/trends-by-shape
git add backend/internal/workout/hash.go backend/internal/workout/hash_test.go backend/internal/workout/workout.go
git commit -m "refactor(workout): ShapeHash takes only params (ADR-0015 amendment)"
```

---

## Task 2: Backend — revert trends `canonicalParamsKey` and drop mode from keying

**Files:**
- Modify: `backend/internal/api/trends_series.go`
- Modify: `backend/internal/api/trends_series_test.go`
- Modify: `backend/internal/api/trends.go`

- [ ] **Step 1: Remove `canonicalParamsKey` and update `assembleSeries`**

In `backend/internal/api/trends_series.go`:

1. Delete the `canonicalParamsKey` function entirely.
2. In `assembleSeries`, change the bucket key from `r.Mode + "|" + canonicalParamsKey(r.Params)` to `r.ShapeHash`.
3. In the `trendsSeriesKey{...}` literal inside `assembleSeries`, change the `ShapeHash` field assignment from `canonicalParamsKey(r.Params)` back to `r.ShapeHash`, and remove the `Mode` field assignment (becomes a one-field struct).
4. In the stable secondary sort comparator, change `out[i].Key.Mode+out[i].Key.ShapeHash < out[j].Key.Mode+out[j].Key.ShapeHash` to `out[i].Key.ShapeHash < out[j].Key.ShapeHash`.
5. Update the doc comment on `sessionRow.ShapeHash` to remove the "retained for diagnostics" framing — it's now load-bearing again.

After the edit, the `assembleSeries` function should read approximately:

```go
func assembleSeries(rows []sessionRow) []trendsSeries {
	type bucket struct {
		key    trendsSeriesKey
		params json.RawMessage
		points []trendsSeriesPoint
	}
	buckets := make(map[string]*bucket)
	for _, r := range rows {
		if r.Mode == "intervals" || r.Mode == "just_row" {
			continue
		}
		k := r.ShapeHash
		b, ok := buckets[k]
		if !ok {
			b = &bucket{
				key:    trendsSeriesKey{ShapeHash: r.ShapeHash},
				params: r.Params,
			}
			buckets[k] = b
		}
		b.points = append(b.points, trendsSeriesPoint{
			T:                 r.StartedAt.UTC().Format(time.RFC3339),
			SessionID:         r.ID,
			TotalDistanceM:    r.DistM,
			TotalTimeSec:      r.TimeSec,
			AvgPowerW:         r.AvgPower,
			AvgPaceSecPer500m: r.AvgPace,
			AvgDPS:            r.AvgDPS,
			AvgSPI:            r.AvgSPI,
			AvgSPM:            r.AvgSPM,
		})
	}
	out := make([]trendsSeries, 0, len(buckets))
	for _, b := range buckets {
		sort.Slice(b.points, func(i, j int) bool { return b.points[i].T < b.points[j].T })
		out = append(out, trendsSeries{
			Key:         b.key,
			ParamsJSON:  b.params,
			DisplayName: displayNameForShape(b.key.Mode, b.params),
			Points:      b.points,
		})
	}
	sort.Slice(out, func(i, j int) bool {
		if len(out[i].Points) != len(out[j].Points) {
			return len(out[i].Points) > len(out[j].Points)
		}
		return out[i].Key.ShapeHash < out[j].Key.ShapeHash
	})
	return out
}
```

Note: `displayNameForShape(b.key.Mode, b.params)` still takes mode as an argument — that's fine, mode is still available on each `sessionRow`. We just don't include it in the *key*. We use the *first row's* mode for display purposes (any row in the bucket would do, since race and distance with same params render identically — see Task 3).

To pass mode to the display name, change the bucket to also store the first row's mode, OR pass `r.Mode` through one path. Cleanest is to store mode on the bucket (not the key):

Change `bucket` to:

```go
type bucket struct {
	key    trendsSeriesKey
	mode   string
	params json.RawMessage
	points []trendsSeriesPoint
}
```

Populate `b.mode = r.Mode` when creating the bucket. Then `DisplayName: displayNameForShape(b.mode, b.params)`.

- [ ] **Step 2: Drop `Mode` from `trendsSeriesKey` struct**

In `backend/internal/api/trends.go`, change:

```go
type trendsSeriesKey struct {
	Mode      string `json:"mode"`
	ShapeHash string `json:"shape_hash"`
}
```

to:

```go
type trendsSeriesKey struct {
	ShapeHash string `json:"shape_hash"`
}
```

- [ ] **Step 3: Delete the `TestCanonicalParamsKeyIsKeyOrderStable` test**

In `backend/internal/api/trends_series_test.go`, delete the entire `TestCanonicalParamsKeyIsKeyOrderStable` function (the helper no longer exists).

- [ ] **Step 4: Update `TestAssembleSeriesGroupsByModeAndParams`**

Rename to `TestAssembleSeriesGroupsByShapeHash`. Update so that:
- The 4 `distance 5k` rows now share the SAME `ShapeHash` (since `ShapeHash` is now mode/warmup-agnostic, equal-params rows naturally collide). Use any fixture string, e.g. `H_5K`.
- The 1 `race 2k` row and the 1 `distance 2k` row now share the SAME `ShapeHash` (e.g. `H_2K`) AND should collapse into ONE series (2 points). Assert this explicitly.
- The `just_row` exclusion still applies.

Replace the whole test body with:

```go
func TestAssembleSeriesGroupsByShapeHash(t *testing.T) {
	t0 := time.Date(2026, 5, 9, 8, 35, 0, 0, time.UTC)
	rows := []sessionRow{
		// 4× distance 5k — all share hash H_5K (mode-agnostic, warmup-agnostic)
		{ID: "a", StartedAt: t0,                          Mode: "distance", Params: json.RawMessage(`{"meters":5000}`), ShapeHash: "H_5K", DistM: 5004, TimeSec: 1138, AvgPower: 374, AvgPace: 110, AvgDPS: 9.69, AvgSPI: 12, AvgSPM: 28.0},
		{ID: "b", StartedAt: t0.Add(6 * 24 * time.Hour),  Mode: "distance", Params: json.RawMessage(`{"meters":5000}`), ShapeHash: "H_5K", DistM: 5005, TimeSec: 1122, AvgPower: 375, AvgPace: 109, AvgDPS: 9.62, AvgSPI: 12, AvgSPM: 28.4},
		{ID: "c", StartedAt: t0.Add(8 * 24 * time.Hour),  Mode: "distance", Params: json.RawMessage(`{"meters":5000}`), ShapeHash: "H_5K", DistM: 5029, TimeSec: 1102, AvgPower: 379, AvgPace: 107, AvgDPS: 9.53, AvgSPI: 12, AvgSPM: 28.9},
		{ID: "d", StartedAt: t0.Add(14 * 24 * time.Hour), Mode: "distance", Params: json.RawMessage(`{"meters":5000}`), ShapeHash: "H_5K", DistM: 5008, TimeSec: 1082, AvgPower: 382, AvgPace: 107, AvgDPS: 9.59, AvgSPI: 12, AvgSPM: 28.7},
		// 1× race 2k + 1× distance 2k — share hash H_2K, collapse to ONE series with 2 points
		{ID: "e", StartedAt: t0.Add(4 * 24 * time.Hour), Mode: "race",     Params: json.RawMessage(`{"meters":2000}`), ShapeHash: "H_2K", DistM: 2010, TimeSec: 420, AvgPower: 410, AvgPace: 105, AvgDPS: 9.0, AvgSPI: 13, AvgSPM: 32.0},
		{ID: "f", StartedAt: t0.Add(5 * 24 * time.Hour), Mode: "distance", Params: json.RawMessage(`{"meters":2000}`), ShapeHash: "H_2K", DistM: 2020, TimeSec: 440, AvgPower: 390, AvgPace: 109, AvgDPS: 9.2, AvgSPI: 12, AvgSPM: 30.0},
		// 1× just_row — excluded
		{ID: "h", StartedAt: t0.Add(16 * 24 * time.Hour), Mode: "just_row", Params: json.RawMessage(`{}`),             ShapeHash: "H_JR", DistM: 3000, TimeSec: 700, AvgPower: 200, AvgPace: 120, AvgDPS: 9.0, AvgSPI: 10, AvgSPM: 24.0},
	}
	series := assembleSeries(rows)

	if len(series) != 2 {
		t.Fatalf("got %d series, want 2 (5k + 2k); got hashes %v", len(series), hashesOf(series))
	}
	if series[0].Key.ShapeHash != "H_5K" || len(series[0].Points) != 4 {
		t.Fatalf("first series should be H_5K with 4 points, got %s with %d", series[0].Key.ShapeHash, len(series[0].Points))
	}
	if series[1].Key.ShapeHash != "H_2K" || len(series[1].Points) != 2 {
		t.Fatalf("second series should be H_2K with 2 points (race + distance collapsed), got %s with %d", series[1].Key.ShapeHash, len(series[1].Points))
	}
}

func hashesOf(s []trendsSeries) []string {
	out := make([]string, len(s))
	for i, sr := range s {
		out[i] = sr.Key.ShapeHash
	}
	return out
}
```

Delete the old `keysOf` and `indexByKey` helpers — they're no longer used.

- [ ] **Step 5: Run targeted tests**

```bash
cd /Users/dg/dev/ruderergo-stats/.claude/worktrees/trends-by-shape/backend
go test ./internal/api/ -run TestAssembleSeriesGroupsByShapeHash -v
```

Expected: PASS.

- [ ] **Step 6: Run full api suite**

```bash
go test ./internal/api/...
```

Expected: all pass. `TestTrendsHandlerReturnsSeriesByShape` will fail because it asserts `display_name == "5 k"` (still correct — 5k workouts) but the leakage assertion uses `"H_500"` and the seeded race-2k row's `display_name` is `"Race 2 k"` (now wrong since "Race " prefix is gone — but Task 3 fixes that). For now: if `TestTrendsHandlerReturnsSeriesByShape` fails on assertions tied to mode-prefix or display strings, leave it failing — Task 3 will rewrite it. If it fails on something else (e.g. compile error), fix that minimally now.

If you must short-circuit: temporarily skip the test with `t.Skip("rewritten in Task 3")`. Restore in Task 3.

- [ ] **Step 7: Commit**

```bash
cd /Users/dg/dev/ruderergo-stats/.claude/worktrees/trends-by-shape
git add backend/internal/api/trends.go backend/internal/api/trends_series.go backend/internal/api/trends_series_test.go
git commit -m "refactor(trends): key series on shape_hash only; revert canonical-params"
```

---

## Task 3: Backend — fix `seconds`/`sec` via `DecodeParams`; drop `Race ` prefix

**Files:**
- Modify: `backend/internal/api/trends_series.go`
- Modify: `backend/internal/api/trends_series_test.go`
- Modify: `backend/internal/api/trends_test.go`

- [ ] **Step 1: Add a regression test that exercises the real production params shape**

In `backend/internal/api/trends_series_test.go`, replace the existing `TestIsCompletedSession` cases that use `{"sec":1200}` with the real `{"seconds":1200}` shape. Also add a case proving the typo class can't reappear. Replace the entire `TestIsCompletedSession` function with:

```go
func TestIsCompletedSession(t *testing.T) {
	cases := []struct {
		name    string
		mode    string
		params  string
		distM   int
		timeSec float64
		want    bool
	}{
		{"distance 5k completed", "distance", `{"meters":5000}`, 5004, 1138, true},
		{"distance 5k at 80%", "distance", `{"meters":5000}`, 4000, 900, true},
		{"distance 5k below 80%", "distance", `{"meters":5000}`, 3999, 800, false},
		{"distance 500m abandoned at 134m", "distance", `{"meters":500}`, 134, 36, false},
		{"race 2k completed", "race", `{"meters":2000}`, 2010, 420, true},
		{"race 500m completed", "race", `{"meters":500}`, 603, 163, true},
		// REAL production time-mode params shape is "seconds", not "sec".
		// A regression here would silently drop every time-mode workout.
		{"time 20min completed", "time", `{"seconds":1200}`, 5500, 1200, true},
		{"time 20min at 80%", "time", `{"seconds":1200}`, 4000, 960, true},
		{"time 20min abandoned", "time", `{"seconds":1200}`, 2000, 500, false},
		// Defensive: the broken {"sec":N} shape that the old code accidentally
		// expected must NOT be silently accepted. With DecodeParams this fails
		// validation and the session is treated as not-completed.
		{"time with wrong key", "time", `{"sec":1200}`, 5500, 1200, false},
		{"intervals never qualifies", "intervals", `{"reps":4,"length":{"unit":"m","value":500},"rest_sec":60}`, 2200, 600, false},
		{"just_row never qualifies", "just_row", `{}`, 5000, 1100, false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got := isCompletedSession(c.mode, json.RawMessage(c.params), c.distM, c.timeSec)
			if got != c.want {
				t.Fatalf("isCompletedSession(%q, %q, %d, %v) = %v, want %v",
					c.mode, c.params, c.distM, c.timeSec, got, c.want)
			}
		})
	}
}
```

- [ ] **Step 2: Run the test to verify the `seconds` cases fail**

```bash
cd /Users/dg/dev/ruderergo-stats/.claude/worktrees/trends-by-shape/backend
go test ./internal/api/ -run TestIsCompletedSession -v
```

Expected: the `time 20min completed`, `time 20min at 80%` cases FAIL (current code expects `"sec"`, gets `"seconds"`, treats as zero target, returns false even when complete). The "wrong key" case may PASS coincidentally (current code returns false, which matches the new expected behaviour) — confirm by reading output.

- [ ] **Step 3: Rewrite `isCompletedSession` to use `DecodeParams`**

In `backend/internal/api/trends_series.go`, replace the entire `isCompletedSession` function with:

```go
// isCompletedSession returns true iff the session reached the completion
// threshold for its workout mode. Routes through workout.DecodeParams so
// the per-mode params schema is the single source of truth — eliminates
// the class of bug where this helper and workout.Params disagree on a
// field name. Returns false for intervals (deferred), just_row (no
// target), and any malformed params.
func isCompletedSession(mode string, params json.RawMessage, totalDistanceM int, totalTimeSec float64) bool {
	p, err := workout.DecodeParams(workout.Mode(mode), params)
	if err != nil {
		return false
	}
	switch {
	case p.Distance != nil:
		return float64(totalDistanceM) >= completionFraction*float64(p.Distance.Meters)
	case p.Race != nil:
		return float64(totalDistanceM) >= completionFraction*float64(p.Race.Meters)
	case p.Time != nil:
		return totalTimeSec >= completionFraction*float64(p.Time.Seconds)
	}
	// just_row, intervals, or unknown → not in trend series.
	return false
}
```

Add `"github.com/gloeckner-daniel/splits/internal/workout"` to the imports in `backend/internal/api/trends_series.go`. The previously-needed `"encoding/json"` import stays — `attachPBs` still uses `json.Unmarshal`.

- [ ] **Step 4: Rewrite `displayNameForShape` to use `DecodeParams` and drop `Race ` prefix**

Replace the entire `displayNameForShape` function with:

```go
// displayNameForShape returns the German chart label for a workout.
// Race and distance with the same meters render identically (see
// ADR-0015 2026-05-25 amendment — they share both PB row and trend
// series). Best-effort: malformed params fall back to the mode string.
func displayNameForShape(mode string, params json.RawMessage) string {
	p, err := workout.DecodeParams(workout.Mode(mode), params)
	if err != nil {
		return mode
	}
	switch {
	case p.Distance != nil:
		return formatMeters(p.Distance.Meters)
	case p.Race != nil:
		return formatMeters(p.Race.Meters)
	case p.Time != nil:
		return strconv.Itoa(p.Time.Seconds/60) + " min"
	}
	return mode
}
```

Delete the now-unused `strconv` import if no other code in the file uses it — confirm with `grep -c strconv backend/internal/api/trends_series.go`. (`formatMeters` still uses `strconv`.) Keep `strconv` in the import block.

- [ ] **Step 5: Run targeted tests**

```bash
cd /Users/dg/dev/ruderergo-stats/.claude/worktrees/trends-by-shape/backend
go test ./internal/api/ -run TestIsCompletedSession -v
```

Expected: PASS for all 12 cases including the `time` cases that previously failed.

- [ ] **Step 6: Update the integration test to match the new display + key shape**

In `backend/internal/api/trends_test.go`, locate `TestTrendsHandlerReturnsSeriesByShape`. The test currently asserts that race-2k and distance-5k produce two series. With the new keying:

- The 4 5k pieces (all `shape_hash: "H_5K"`) still form one series with `display_name: "5 k"`.
- The 1 race-500m piece has `shape_hash: "H_R500"` — its own series, but its `display_name` is now `"500 m"` (no "Race " prefix).
- The 134m abandoned 500m piece is still excluded.

Update the assertions:

Find the existing block:

```go
if len(got.Series) != 2 {
    t.Fatalf("got %d series, want 2 (distance 5k + race 2k); body=%s", len(got.Series), rec.Body.String())
}
```

…and the seeded data. The current test seeds `s6` as `race 2k`. Update assertions:

```go
if len(got.Series) != 2 {
    t.Fatalf("got %d series, want 2 (5k + 2k); body=%s", len(got.Series), rec.Body.String())
}
// Most-rowed first: the 5k series with 4 points.
first := got.Series[0]
if first["display_name"] != "5 k" {
    t.Fatalf("first series display_name = %v, want \"5 k\"", first["display_name"])
}
pts, ok := first["points"].([]any)
if !ok || len(pts) != 4 {
    t.Fatalf("first series points = %v, want 4 points", first["points"])
}
pb, _ := first["pb_pace_sec_per_500m"].(float64)
if pb < 108.0 || pb > 108.5 {
    t.Fatalf("first series PB pace = %v, want ~108.2 s/500m", pb)
}
// Second series: the 2k race — now labeled "2 k" (no "Race " prefix).
second := got.Series[1]
if second["display_name"] != "2 k" {
    t.Fatalf("second series display_name = %v, want \"2 k\" (race ≡ distance per ADR-0015 2026-05-25)", second["display_name"])
}
// 134m piece must NOT have created a 500m series.
for _, s := range got.Series {
    key, _ := s["key"].(map[string]any)
    if key != nil && key["shape_hash"] == "H_500" {
        t.Fatalf("abandoned 134m piece leaked into series: %v", s)
    }
}
```

Note: the `key["shape_hash"] == "H_500"` check is a string literal pinned to the test fixture's seeded `shapeHash: "H_500"`. This works because the test inserts `shape_hash` directly via the seedSessions helper (not via the boot recompute path), so the value in the response equals the fixture string. Keep it.

If the test currently passes a `seedSession` with `mode` field referenced by an assertion that was checking `key.mode`, remove those assertions — `mode` is no longer in `trendsSeriesKey`.

- [ ] **Step 7: Restore (un-skip) the test if Task 2 skipped it; run full api suite**

```bash
cd /Users/dg/dev/ruderergo-stats/.claude/worktrees/trends-by-shape/backend
go test ./internal/api/...
```

Expected: all pass.

- [ ] **Step 8: Commit**

```bash
cd /Users/dg/dev/ruderergo-stats/.claude/worktrees/trends-by-shape
git add backend/internal/api/trends_series.go backend/internal/api/trends_series_test.go backend/internal/api/trends_test.go
git commit -m "fix(trends): use DecodeParams for completion + label; drop Race prefix"
```

---

## Task 4: Backend — migration + boot-time shape recompute (TDD)

**Files:**
- Create: `backend/internal/storage/migrations/0016_invalidate_workout_shape_hash.sql`
- Create: `backend/internal/storage/recompute_shapes.go`
- Create: `backend/internal/storage/recompute_shapes_test.go`
- Modify: `backend/cmd/splits/main.go`

- [ ] **Step 1: Create the SQL migration**

Create `backend/internal/storage/migrations/0016_invalidate_workout_shape_hash.sql`:

```sql
-- 0016_invalidate_workout_shape_hash.sql — ADR-0015 (2026-05-25 amendment).
-- Workout.shape_hash semantics changed: it's now SHA-256 of canonical
-- params only (mode, warmup_sec, cooldown_sec excluded). Every existing
-- hash is stale.
--
-- This migration does three things, all idempotent:
--
-- 1. Sets all workout.shape_hash values to NULL so the boot-time
--    storage.RecomputeShapes helper detects and refills them under the
--    new function.
--
-- 2. Invalidates every active pb_workout row so the recompute pipeline
--    rebuilds them under the new hashes. The pb_workout unique index
--    is `(rower_id, shape_hash) WHERE invalidated_at IS NULL`, so this
--    frees the slots before stats.Recompute fires.
--
-- 3. Resets rower_lifetime_stats.computed_at to a sentinel old value so
--    the existing storage.RecomputeStaleRowerStats hook (called by
--    BootJanitor at boot and by the periodic sweep) sees every rower
--    as stale and runs stats.Recompute for them — rebuilding pb_workout,
--    pb_distance, pb_window, achievements, etc. under the new hashes.
--    No new boot wiring required; we reuse the self-healing pathway.

UPDATE workout SET shape_hash = NULL;

UPDATE pb_workout
SET invalidated_at = datetime('now')
WHERE invalidated_at IS NULL;

UPDATE rower_lifetime_stats SET computed_at = '1970-01-01T00:00:00Z';
```

- [ ] **Step 2: Write the failing test for the boot helper**

Create `backend/internal/storage/recompute_shapes_test.go`:

```go
package storage_test

import (
	"context"
	"database/sql"
	"path/filepath"
	"testing"
	"time"

	"github.com/gloeckner-daniel/splits/internal/storage"
	"github.com/gloeckner-daniel/splits/internal/workout"
)

func TestRecomputeShapes_PopulatesNullHashes(t *testing.T) {
	db, err := storage.Open(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)

	// Seed two workouts with null shape_hash (mimicking the post-migration state).
	if _, err := db.Handle().Exec(
		`INSERT INTO workout(id, mode, params_json, intensity, warmup_sec, cooldown_sec, created_at, shape_hash)
		 VALUES('w1', 'distance', '{"meters":5000}', 'moderat', 60, 120, ?, NULL),
		       ('w2', 'distance', '{"meters":5000}', 'hart',    0,  0,   ?, NULL)`,
		now, now); err != nil {
		t.Fatal(err)
	}

	if err := storage.RecomputeShapes(context.Background(), db.Handle()); err != nil {
		t.Fatal(err)
	}

	var h1, h2 sql.NullString
	if err := db.Handle().QueryRow(`SELECT shape_hash FROM workout WHERE id='w1'`).Scan(&h1); err != nil {
		t.Fatal(err)
	}
	if err := db.Handle().QueryRow(`SELECT shape_hash FROM workout WHERE id='w2'`).Scan(&h2); err != nil {
		t.Fatal(err)
	}
	if !h1.Valid || h1.String == "" {
		t.Fatal("w1.shape_hash still null")
	}
	if !h2.Valid || h2.String == "" {
		t.Fatal("w2.shape_hash still null")
	}
	// Both workouts have identical params → identical hash (warmup/cooldown excluded).
	if h1.String != h2.String {
		t.Fatalf("expected w1 and w2 to share hash (same params), got %q vs %q", h1.String, h2.String)
	}

	// Confirm the hash matches what workout.ShapeHash computes directly.
	wantH, err := workout.ShapeHash([]byte(`{"meters":5000}`))
	if err != nil {
		t.Fatal(err)
	}
	if h1.String != wantH {
		t.Fatalf("w1.shape_hash = %q, want %q (workout.ShapeHash output)", h1.String, wantH)
	}
}

func TestRecomputeShapes_Idempotent(t *testing.T) {
	db, err := storage.Open(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	if _, err := db.Handle().Exec(
		`INSERT INTO workout(id, mode, params_json, intensity, warmup_sec, cooldown_sec, created_at, shape_hash)
		 VALUES('w1', 'distance', '{"meters":5000}', 'moderat', 60, 120, ?, NULL)`, now); err != nil {
		t.Fatal(err)
	}

	if err := storage.RecomputeShapes(context.Background(), db.Handle()); err != nil {
		t.Fatal(err)
	}
	var hAfterFirst string
	if err := db.Handle().QueryRow(`SELECT shape_hash FROM workout WHERE id='w1'`).Scan(&hAfterFirst); err != nil {
		t.Fatal(err)
	}

	// Re-run: must be a no-op (no NULL rows left).
	if err := storage.RecomputeShapes(context.Background(), db.Handle()); err != nil {
		t.Fatal(err)
	}
	var hAfterSecond string
	if err := db.Handle().QueryRow(`SELECT shape_hash FROM workout WHERE id='w1'`).Scan(&hAfterSecond); err != nil {
		t.Fatal(err)
	}
	if hAfterFirst != hAfterSecond {
		t.Fatalf("hash drifted between runs: %q → %q", hAfterFirst, hAfterSecond)
	}
}
```

- [ ] **Step 3: Verify the tests fail**

```bash
cd /Users/dg/dev/ruderergo-stats/.claude/worktrees/trends-by-shape/backend
go test ./internal/storage/ -run TestRecomputeShapes -v
```

Expected: FAIL with `undefined: storage.RecomputeShapes`.

- [ ] **Step 4: Implement `RecomputeShapes`**

Create `backend/internal/storage/recompute_shapes.go`:

```go
package storage

import (
	"context"
	"database/sql"
	"fmt"

	"github.com/gloeckner-daniel/splits/internal/workout"
)

// RecomputeShapes detects workout rows with a NULL shape_hash (the
// post-migration state from 0016_invalidate_workout_shape_hash) and
// repopulates them using workout.ShapeHash. Idempotent: when no NULL
// rows remain, this is a no-op.
//
// Callers should invoke this once after migrations apply at boot.
// It does NOT trigger PB recompute on its own — that's a separate
// concern handled by the boot sequence (TriggerPBRecompute below).
func RecomputeShapes(ctx context.Context, db *sql.DB) error {
	rows, err := db.QueryContext(ctx,
		`SELECT id, params_json FROM workout WHERE shape_hash IS NULL`)
	if err != nil {
		return fmt.Errorf("recompute shapes: query null: %w", err)
	}
	defer rows.Close()

	type pending struct {
		id     string
		params []byte
	}
	var todo []pending
	for rows.Next() {
		var p pending
		if err := rows.Scan(&p.id, &p.params); err != nil {
			return fmt.Errorf("recompute shapes: scan: %w", err)
		}
		todo = append(todo, p)
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("recompute shapes: row iter: %w", err)
	}

	for _, p := range todo {
		h, err := workout.ShapeHash(p.params)
		if err != nil {
			// Skip rows with malformed params; they'd fail comparability
			// anywhere. Don't fail the whole boot for one bad row.
			continue
		}
		if _, err := db.ExecContext(ctx,
			`UPDATE workout SET shape_hash = ? WHERE id = ?`, h, p.id); err != nil {
			return fmt.Errorf("recompute shapes: update %s: %w", p.id, err)
		}
	}
	return nil
}
```

- [ ] **Step 5: Verify the tests pass**

```bash
cd /Users/dg/dev/ruderergo-stats/.claude/worktrees/trends-by-shape/backend
go test ./internal/storage/ -run TestRecomputeShapes -v
```

Expected: PASS.

- [ ] **Step 6: Wire `RecomputeShapes` into `cmd/splits/main.go`**

We reuse the existing `BootJanitor` for PB rebuild — no new helper. The only new call is `storage.RecomputeShapes` to refill `workout.shape_hash` *before* `BootJanitor.Run` fires (so when the janitor's `RecomputeStaleRowerStats` runs `stats.Recompute` for the freshly-stale rowers, the shape_hashes are already correct).

Find the existing `BootJanitor` invocation in `backend/cmd/splits/main.go`:

```bash
grep -n "BootJanitor\|storage.Open" backend/cmd/splits/main.go
```

It's currently at line ~157:

```go
	(&storage.BootJanitor{DB: db.Handle(), Scheduler: scheduler}).Run(ctx)
```

Immediately BEFORE that line, add:

```go
	if err := storage.RecomputeShapes(ctx, db.Handle()); err != nil {
		slog.Error("boot.recompute_shapes", "err", err)
		// Don't fatal — the API still works; affected workouts just
		// won't join trend series until the next successful run.
	}
```

Use the existing `ctx` variable. The existing `slog` import is already in the file.

That's the entire wiring change. No new helper function, no new imports. The migration's `UPDATE rower_lifetime_stats SET computed_at = '1970-01-01T00:00:00Z'` is what triggers `RecomputeStaleRowerStats` (inside `BootJanitor.Run`) to pick up every rower.

- [ ] **Step 7: Build and run the full suite**

```bash
cd /Users/dg/dev/ruderergo-stats/.claude/worktrees/trends-by-shape/backend
go build ./...
go test ./...
```

Expected: clean. The migration runs in `storage.Open` (via `applyMigrations` in `db.go`), so any test that opens a fresh DB now sees the migration apply. Most tests create empty DBs, so the `UPDATE workout SET shape_hash = NULL` and the `UPDATE pb_workout` no-op on empty tables. If any test seeds a `pb_workout` row and then expects it to be active, it'll break — check `internal/stats/recompute_test.go` and `internal/api/pbs_test.go`. Fix by either (a) re-running `stats.Recompute` after seed, or (b) inserting with `invalidated_at = NULL` explicitly after the migration.

- [ ] **Step 8: Commit**

```bash
cd /Users/dg/dev/ruderergo-stats/.claude/worktrees/trends-by-shape
git add backend/internal/storage/migrations/0016_invalidate_workout_shape_hash.sql backend/internal/storage/recompute_shapes.go backend/internal/storage/recompute_shapes_test.go backend/cmd/splits/main.go
git commit -m "feat(boot): recompute shape_hash + trigger PB rebuild on first boot"
```

---

## Task 5: Frontend — drop `mode` from `TrendsSeriesKey`; update testid

**Files:**
- Modify: `web/src/api/client.ts`
- Modify: `web/src/pages/history/TrendsTab.tsx`
- Modify: `web/src/pages/history/TrendsTab.test.tsx`

- [ ] **Step 1: Drop `mode` from `TrendsSeriesKey`**

In `web/src/api/client.ts`, find:

```typescript
export type TrendsSeriesKey = {
  mode: string
  shape_hash: string
}
```

Replace with:

```typescript
export type TrendsSeriesKey = {
  shape_hash: string
}
```

- [ ] **Step 2: Update the testid format in `TrendsTab.tsx`**

In `web/src/pages/history/TrendsTab.tsx`, find:

```tsx
<small data-testid={`pb-${s.key.mode}-${s.key.shape_hash}`}>
```

Replace with:

```tsx
<small data-testid={`pb-${s.key.shape_hash}`}>
```

Also find the React key:

```tsx
<div key={`${s.key.mode}|${s.key.shape_hash}`} className={styles.legendRow}>
```

Replace with:

```tsx
<div key={s.key.shape_hash} className={styles.legendRow}>
```

- [ ] **Step 3: Update the test that grabs the PB testid**

In `web/src/pages/history/TrendsTab.test.tsx`, find:

```tsx
expect(screen.getByTestId('pb-distance-H')).toBeInTheDocument()
```

Replace with:

```tsx
expect(screen.getByTestId('pb-H')).toBeInTheDocument()
```

- [ ] **Step 4: Verify typecheck and tests**

```bash
cd /Users/dg/dev/ruderergo-stats/.claude/worktrees/trends-by-shape/web
npm run typecheck
npm test -- --run
```

Expected: typecheck clean, all 575 tests pass. If a test mock that constructs a `TrendsSeries` literal still includes `mode:` on the key, TypeScript will accept it (extra fields on object literals require explicit type annotations to error). To be safe, search:

```bash
grep -n "key:.*mode:" web/src/pages/history/*.tsx
```

…and remove any stray `mode:` from `key` literals.

- [ ] **Step 5: Commit**

```bash
cd /Users/dg/dev/ruderergo-stats/.claude/worktrees/trends-by-shape
git add web/src/api/client.ts web/src/pages/history/TrendsTab.tsx web/src/pages/history/TrendsTab.test.tsx
git commit -m "feat(trends): drop mode from series key (race ≡ distance per ADR-0015)"
```

---

## Task 6: Smoke test against real DB

**Files:** none modified.

- [ ] **Step 1: Stop any prior backend instance and start fresh against the production DB**

```bash
cd /Users/dg/dev/ruderergo-stats/.claude/worktrees/trends-by-shape
lsof -ti:18080 | xargs -r kill 2>/dev/null
cd backend && SPLITS_DB_PATH=/Users/dg/dev/ruderergo-stats/splits-raspi.db SPLITS_ADDR=127.0.0.1:18080 go run ./cmd/splits &
SERVER_PID=$!
until curl -s --max-time 1 -o /dev/null http://127.0.0.1:18080/api/v1/rowers/list 2>/dev/null; do sleep 1; done
echo "server up"
```

**This boot will:**
- Apply migration 0016 → set every `workout.shape_hash` to NULL, invalidate every active `pb_workout`
- Run `RecomputeShapes` → repopulate `shape_hash` under the new function
- Run `triggerPBRecomputeForAllRowers` → rebuild `pb_workout`

Watch the server log for any `boot.recompute_*` warnings.

**SAFETY:** This modifies `splits-raspi.db` in place. Make a backup first:

```bash
cp /Users/dg/dev/ruderergo-stats/splits-raspi.db /Users/dg/dev/ruderergo-stats/splits-raspi.db.before-shapehash-fix
```

- [ ] **Step 2: Verify shape_hash repopulated and matches for warmup-divergent rows**

```bash
sqlite3 /Users/dg/dev/ruderergo-stats/splits-raspi.db "SELECT DISTINCT shape_hash FROM workout WHERE mode='distance' AND params_json='{\"meters\":5000}';"
```

Expected: exactly ONE distinct hash. Before this change, there were 3 distinct hashes for the four 5k workouts.

- [ ] **Step 3: Hit the trends endpoint and verify Daniel's 5k series**

```bash
curl -s --cookie "device_id=dc52c9e8-bfce-4084-a7b4-f30dd626f5bd" \
  "http://127.0.0.1:18080/api/v1/rowers/fbab95cb-ca02-432c-b570-ad263c6d678b/trends?range=month" \
  | jq '.series[] | {display_name, point_count: (.points|length), pb: .pb_pace_sec_per_500m, shape_hash: .key.shape_hash}'
```

Expected output (one of the series):

```json
{
  "display_name": "5 k",
  "point_count": 4,
  "pb": 108.022...,
  "shape_hash": "<64-char hex string>"
}
```

The `shape_hash` value should be a 64-char hex SHA-256 (not `{"meters":5000}` from Task 10).

If point_count is not 4, debug:
- Was migration 0016 applied? Check `sqlite3 splits-raspi.db "SELECT MAX(version) FROM schema_migrations;"` — should be 16.
- Are the workout rows' shape_hash populated? `sqlite3 splits-raspi.db "SELECT id, shape_hash FROM workout LIMIT 5;"` — should show 64-char hex.
- Did `triggerPBRecomputeForAllRowers` succeed? Check server logs.

- [ ] **Step 4: Verify PB rebuilt under new hash**

```bash
sqlite3 /Users/dg/dev/ruderergo-stats/splits-raspi.db \
  "SELECT shape_hash, mode, params_json, value, invalidated_at FROM pb_workout WHERE rower_id='fbab95cb-ca02-432c-b570-ad263c6d678b' ORDER BY achieved_at DESC LIMIT 5;"
```

Expected: at least one ACTIVE (invalidated_at = NULL) row whose `shape_hash` is a 64-char hex (matches what trends returned).

- [ ] **Step 5: Stop the server**

```bash
kill $SERVER_PID 2>/dev/null
wait $SERVER_PID 2>/dev/null
```

- [ ] **Step 6: Document and optionally restore**

If smoke test PASSED: the change is correct. The backup at `splits-raspi.db.before-shapehash-fix` can be kept until the merge lands, then deleted. No commit — Task 6 is verification only.

If smoke test FAILED: restore from backup before debugging:

```bash
cp /Users/dg/dev/ruderergo-stats/splits-raspi.db.before-shapehash-fix /Users/dg/dev/ruderergo-stats/splits-raspi.db
```

…and file the failure as a follow-up. Don't commit broken state.

---

## Self-review

**1. Spec coverage** (against ADR-0015 2026-05-25 amendment):

| Amendment requirement | Implementing task |
|---|---|
| `ShapeHash(params)` — drop mode + warmup/cooldown | Task 1 |
| Both PB and Trends use ShapeHash directly | Task 1 (workout side) + Task 2 (trends side) |
| Race ≡ distance for same params | Task 1 (hash already collapses) + Task 2 (key drops mode) + Task 3 (display drops "Race ") |
| Wire field `key.shape_hash` carries actual hash | Task 1 (recompute) + Task 4 (boot pass) |
| Bug 1: `seconds`/`sec` typo | Task 3 |
| Migration recomputes + triggers PB rebuild | Task 4 |
| Revert canonicalParamsKey hack | Task 2 |
| `displayNameForShape` drops "Race " prefix | Task 3 |

All checklisted. No gaps.

**2. Placeholder scan:** No "TODO", "fill in", "appropriate error handling" patterns left in plan text. Every code block is a complete artifact.

**3. Type consistency:** `ShapeHash(json.RawMessage) (string, error)` is used consistently in Tasks 1, 4. `trendsSeriesKey` has `ShapeHash` field only (no `Mode`) consistently in Tasks 2, 5. Frontend `TrendsSeriesKey` type matches (Task 5). Boot helper signature `RecomputeShapes(ctx, db) error` consistent in Task 4 implementation + Task 4 test + main.go wiring.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-25-shapehash-canonical-only-params.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
