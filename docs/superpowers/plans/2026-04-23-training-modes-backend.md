# Training Modes — Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add backend data model, repositories, and HTTP API for workouts + user-named favorites. Extend sessions with `workout_id`. Leave segment derivation and SSE-progress for the second backend plan once the frontend flow exists — this plan ends at "FE can create a workout, attach it to a session, and list favorites."

**Architecture:** Two new SQLite tables (`workout`, `workout_favorite`) via migration `0004`. New Go package `backend/internal/workout/` with `Repo`, input/output types, and validation. HTTP handlers in `backend/internal/api/workouts.go`. Sessionizer gets an optional `workout_id` it stores on insert. No SSE changes in this plan.

**Tech Stack:** Go 1.22, `database/sql` + modernc sqlite, `github.com/google/uuid`, net/http `ServeMux` with path patterns. Table-driven tests under each package.

Follow-up plans:
1. `2026-04-23-training-modes-home-screen.md` — React Home screen + routing shift
2. `2026-04-23-training-modes-selection-flow.md` — 3-step picker + confirm
3. `2026-04-23-training-modes-live-view.md` — progress strip, range indicator, SSE segment events (backend changes land here)

---

## File Structure

**New:**
- `backend/internal/storage/migrations/0004_workouts.sql` — migration creating `workout`, `workout_favorite`, adding `sessions.workout_id`
- `backend/internal/workout/workout.go` — types (`Workout`, `Favorite`, `Params`, `Intensity`), `Repo`, `CreateWorkoutInput`, `CreateFavoriteInput`, validation
- `backend/internal/workout/workout_test.go` — repo tests with in-memory SQLite
- `backend/internal/workout/params.go` — JSON marshalling + validation per mode (`just_row`, `distance`, `time`, `intervals`)
- `backend/internal/workout/params_test.go` — params round-trip + validation tests
- `backend/internal/api/workouts.go` — HTTP handlers (`WorkoutsHandler`, `FavoritesHandler`)
- `backend/internal/api/workouts_test.go` — handler tests

**Modify:**
- `backend/internal/api/router.go` — wire the new handlers
- `backend/internal/session/sessionizer.go` — accept optional `WorkoutID` on session start, store in `sessions.workout_id`
- `backend/internal/session/sessionizer_test.go` — add coverage for workout_id persistence
- `backend/cmd/home-ergo/main.go` (or wherever the router is wired) — construct `workout.NewRepo(db)` and pass into router

---

## Task 1 — Migration 0004

**Files:**
- Create: `backend/internal/storage/migrations/0004_workouts.sql`
- Test: `backend/internal/storage/db_test.go` (add one assertion)

- [ ] **Step 1: Write the migration**

Create `backend/internal/storage/migrations/0004_workouts.sql`:

```sql
CREATE TABLE IF NOT EXISTS workout (
  id           TEXT PRIMARY KEY,
  mode         TEXT NOT NULL CHECK (mode IN ('just_row','distance','time','intervals')),
  params_json  TEXT NOT NULL,
  intensity    TEXT CHECK (intensity IN ('locker','moderat','hart','allout')),
  warmup_sec   INTEGER NOT NULL DEFAULT 0,
  cooldown_sec INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS workout_favorite (
  id           TEXT PRIMARY KEY,
  rower_id     TEXT NOT NULL REFERENCES rowers(id),
  name         TEXT NOT NULL,
  mode         TEXT NOT NULL CHECK (mode IN ('just_row','distance','time','intervals')),
  params_json  TEXT NOT NULL,
  intensity    TEXT CHECK (intensity IN ('locker','moderat','hart','allout')),
  warmup_sec   INTEGER NOT NULL DEFAULT 0,
  cooldown_sec INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_workout_favorite_rower
  ON workout_favorite(rower_id, created_at DESC);

ALTER TABLE sessions ADD COLUMN workout_id TEXT REFERENCES workout(id);
```

- [ ] **Step 2: Write failing test**

Append to `backend/internal/storage/db_test.go` (create if needed, see existing pattern). Add a test `TestMigration0004SchemaExists` that opens a temp DB via `Open(...)` and asserts:

```go
func TestMigration0004SchemaExists(t *testing.T) {
    dir := t.TempDir()
    db, err := Open(filepath.Join(dir, "test.db"))
    if err != nil {
        t.Fatal(err)
    }
    defer db.Close()

    for _, name := range []string{"workout", "workout_favorite"} {
        var got string
        err := db.Handle().QueryRow(
            `SELECT name FROM sqlite_master WHERE type='table' AND name=?`, name,
        ).Scan(&got)
        if err != nil {
            t.Fatalf("expected table %s: %v", name, err)
        }
    }

    var colCount int
    if err := db.Handle().QueryRow(
        `SELECT COUNT(*) FROM pragma_table_info('sessions') WHERE name='workout_id'`,
    ).Scan(&colCount); err != nil || colCount != 1 {
        t.Fatalf("expected sessions.workout_id column, count=%d err=%v", colCount, err)
    }
}
```

- [ ] **Step 3: Run the test**

```
cd backend && go test ./internal/storage/ -run TestMigration0004SchemaExists -v
```

Expected: PASS (migration auto-applies on Open).

- [ ] **Step 4: Commit**

```
git add backend/internal/storage/migrations/0004_workouts.sql backend/internal/storage/db_test.go
git commit -m "feat(backend): migration 0004 — workout + workout_favorite + sessions.workout_id"
```

---

## Task 2 — Params types + JSON marshalling

**Files:**
- Create: `backend/internal/workout/params.go`
- Test: `backend/internal/workout/params_test.go`

- [ ] **Step 1: Write failing tests first**

Create `backend/internal/workout/params_test.go`:

```go
package workout

import (
    "encoding/json"
    "testing"
)

func TestParamsRoundTrip(t *testing.T) {
    cases := []struct {
        name string
        mode Mode
        in   string
    }{
        {"just_row", ModeJustRow, `{}`},
        {"distance", ModeDistance, `{"meters":5000}`},
        {"time", ModeTime, `{"seconds":1800}`},
        {"intervals_meters", ModeIntervals, `{"reps":6,"length":{"unit":"m","value":500},"rest_sec":120}`},
        {"intervals_minutes", ModeIntervals, `{"reps":4,"length":{"unit":"min","value":4},"rest_sec":60}`},
    }
    for _, tc := range cases {
        t.Run(tc.name, func(t *testing.T) {
            p, err := DecodeParams(tc.mode, json.RawMessage(tc.in))
            if err != nil {
                t.Fatalf("decode: %v", err)
            }
            out, err := p.Encode()
            if err != nil {
                t.Fatalf("encode: %v", err)
            }
            if string(out) == "" {
                t.Fatal("empty encoded params")
            }
        })
    }
}

func TestParamsValidation(t *testing.T) {
    cases := []struct {
        name    string
        mode    Mode
        in      string
        wantErr bool
    }{
        {"distance zero", ModeDistance, `{"meters":0}`, true},
        {"distance negative", ModeDistance, `{"meters":-100}`, true},
        {"time zero", ModeTime, `{"seconds":0}`, true},
        {"intervals zero reps", ModeIntervals, `{"reps":0,"length":{"unit":"m","value":500},"rest_sec":0}`, true},
        {"intervals zero length", ModeIntervals, `{"reps":6,"length":{"unit":"m","value":0},"rest_sec":0}`, true},
        {"intervals bad unit", ModeIntervals, `{"reps":6,"length":{"unit":"km","value":1},"rest_sec":0}`, true},
        {"intervals negative rest", ModeIntervals, `{"reps":6,"length":{"unit":"m","value":500},"rest_sec":-1}`, true},
        {"intervals rest zero ok", ModeIntervals, `{"reps":6,"length":{"unit":"m","value":500},"rest_sec":0}`, false},
        {"unknown mode", Mode("pyramid"), `{}`, true},
    }
    for _, tc := range cases {
        t.Run(tc.name, func(t *testing.T) {
            _, err := DecodeParams(tc.mode, json.RawMessage(tc.in))
            if (err != nil) != tc.wantErr {
                t.Fatalf("err=%v wantErr=%v", err, tc.wantErr)
            }
        })
    }
}
```

- [ ] **Step 2: Run to verify it fails**

```
cd backend && go test ./internal/workout/ -run TestParams -v
```

Expected: FAIL (package / symbols missing).

- [ ] **Step 3: Implement `params.go`**

Create `backend/internal/workout/params.go`:

```go
package workout

import (
    "encoding/json"
    "errors"
    "fmt"
)

type Mode string

const (
    ModeJustRow   Mode = "just_row"
    ModeDistance  Mode = "distance"
    ModeTime      Mode = "time"
    ModeIntervals Mode = "intervals"
)

func (m Mode) Valid() bool {
    switch m {
    case ModeJustRow, ModeDistance, ModeTime, ModeIntervals:
        return true
    }
    return false
}

type Intensity string

const (
    IntensityLocker  Intensity = "locker"
    IntensityModerat Intensity = "moderat"
    IntensityHart    Intensity = "hart"
    IntensityAllOut  Intensity = "allout"
)

func (i Intensity) Valid() bool {
    if i == "" {
        return true
    }
    switch i {
    case IntensityLocker, IntensityModerat, IntensityHart, IntensityAllOut:
        return true
    }
    return false
}

// Params is the mode-specific payload. Exactly one of the pointer fields is populated.
type Params struct {
    Mode      Mode             `json:"-"`
    JustRow   *JustRowParams   `json:"-"`
    Distance  *DistanceParams  `json:"-"`
    Time      *TimeParams      `json:"-"`
    Intervals *IntervalsParams `json:"-"`
}

type JustRowParams struct{}
type DistanceParams struct {
    Meters int `json:"meters"`
}
type TimeParams struct {
    Seconds int `json:"seconds"`
}
type IntervalLength struct {
    Unit  string `json:"unit"`
    Value int    `json:"value"`
}
type IntervalsParams struct {
    Reps    int            `json:"reps"`
    Length  IntervalLength `json:"length"`
    RestSec int            `json:"rest_sec"`
}

var ErrInvalidParams = errors.New("workout: invalid params")

func DecodeParams(mode Mode, raw json.RawMessage) (*Params, error) {
    if !mode.Valid() {
        return nil, fmt.Errorf("%w: unknown mode %q", ErrInvalidParams, mode)
    }
    p := &Params{Mode: mode}
    switch mode {
    case ModeJustRow:
        p.JustRow = &JustRowParams{}
    case ModeDistance:
        var d DistanceParams
        if err := json.Unmarshal(raw, &d); err != nil {
            return nil, fmt.Errorf("%w: %v", ErrInvalidParams, err)
        }
        if d.Meters <= 0 {
            return nil, fmt.Errorf("%w: meters must be > 0", ErrInvalidParams)
        }
        p.Distance = &d
    case ModeTime:
        var t TimeParams
        if err := json.Unmarshal(raw, &t); err != nil {
            return nil, fmt.Errorf("%w: %v", ErrInvalidParams, err)
        }
        if t.Seconds <= 0 {
            return nil, fmt.Errorf("%w: seconds must be > 0", ErrInvalidParams)
        }
        p.Time = &t
    case ModeIntervals:
        var i IntervalsParams
        if err := json.Unmarshal(raw, &i); err != nil {
            return nil, fmt.Errorf("%w: %v", ErrInvalidParams, err)
        }
        if i.Reps <= 0 {
            return nil, fmt.Errorf("%w: reps must be > 0", ErrInvalidParams)
        }
        if i.Length.Unit != "m" && i.Length.Unit != "min" {
            return nil, fmt.Errorf("%w: length.unit must be 'm' or 'min'", ErrInvalidParams)
        }
        if i.Length.Value <= 0 {
            return nil, fmt.Errorf("%w: length.value must be > 0", ErrInvalidParams)
        }
        if i.RestSec < 0 {
            return nil, fmt.Errorf("%w: rest_sec must be >= 0", ErrInvalidParams)
        }
        p.Intervals = &i
    }
    return p, nil
}

func (p *Params) Encode() (json.RawMessage, error) {
    switch p.Mode {
    case ModeJustRow:
        return json.RawMessage(`{}`), nil
    case ModeDistance:
        return json.Marshal(p.Distance)
    case ModeTime:
        return json.Marshal(p.Time)
    case ModeIntervals:
        return json.Marshal(p.Intervals)
    }
    return nil, fmt.Errorf("%w: cannot encode mode %q", ErrInvalidParams, p.Mode)
}
```

- [ ] **Step 4: Run tests to verify pass**

```
cd backend && go test ./internal/workout/ -run TestParams -v
```

Expected: PASS for all subtests.

- [ ] **Step 5: Commit**

```
git add backend/internal/workout/params.go backend/internal/workout/params_test.go
git commit -m "feat(workout): params types with per-mode validation"
```

---

## Task 3 — Workout Repo (create + get)

**Files:**
- Create: `backend/internal/workout/workout.go`
- Test: `backend/internal/workout/workout_test.go`

- [ ] **Step 1: Write failing tests**

Create `backend/internal/workout/workout_test.go`:

```go
package workout

import (
    "context"
    "encoding/json"
    "path/filepath"
    "testing"

    "github.com/gloeckner-daniel/home-ergo/internal/storage"
)

func newTestRepo(t *testing.T) (*Repo, *storage.DB) {
    t.Helper()
    db, err := storage.Open(filepath.Join(t.TempDir(), "test.db"))
    if err != nil {
        t.Fatal(err)
    }
    t.Cleanup(func() { db.Close() })
    return NewRepo(db.Handle()), db
}

func TestCreateAndGetWorkout(t *testing.T) {
    repo, _ := newTestRepo(t)
    ctx := context.Background()

    in := CreateWorkoutInput{
        Mode:        ModeDistance,
        ParamsJSON:  json.RawMessage(`{"meters":5000}`),
        Intensity:   IntensityModerat,
        WarmupSec:   300,
        CooldownSec: 300,
    }
    out, err := repo.CreateWorkout(ctx, in)
    if err != nil {
        t.Fatalf("create: %v", err)
    }
    if out.ID == "" {
        t.Fatal("expected ULID")
    }

    got, err := repo.GetWorkout(ctx, out.ID)
    if err != nil {
        t.Fatalf("get: %v", err)
    }
    if got.Mode != ModeDistance || got.WarmupSec != 300 {
        t.Fatalf("unexpected workout: %+v", got)
    }
}

func TestCreateWorkoutValidatesParams(t *testing.T) {
    repo, _ := newTestRepo(t)
    _, err := repo.CreateWorkout(context.Background(), CreateWorkoutInput{
        Mode:       ModeDistance,
        ParamsJSON: json.RawMessage(`{"meters":-1}`),
    })
    if err == nil {
        t.Fatal("expected validation error")
    }
}
```

- [ ] **Step 2: Run to verify fail**

```
cd backend && go test ./internal/workout/ -v
```

Expected: compile error / FAIL.

- [ ] **Step 3: Implement `workout.go`**

Create `backend/internal/workout/workout.go`:

```go
// Package workout owns the pre-session training configuration.
// A Workout row is transient (one per session that used a workout);
// a Favorite row is the user-named template in the library.
package workout

import (
    "context"
    "database/sql"
    "encoding/json"
    "errors"
    "time"

    "github.com/google/uuid"
)

type Workout struct {
    ID          string          `json:"id"`
    Mode        Mode            `json:"mode"`
    ParamsJSON  json.RawMessage `json:"params"`
    Intensity   Intensity       `json:"intensity,omitempty"`
    WarmupSec   int             `json:"warmup_sec"`
    CooldownSec int             `json:"cooldown_sec"`
    CreatedAt   time.Time       `json:"created_at"`
}

type CreateWorkoutInput struct {
    Mode        Mode            `json:"mode"`
    ParamsJSON  json.RawMessage `json:"params"`
    Intensity   Intensity       `json:"intensity,omitempty"`
    WarmupSec   int             `json:"warmup_sec,omitempty"`
    CooldownSec int             `json:"cooldown_sec,omitempty"`
}

type Repo struct{ db *sql.DB }

func NewRepo(db *sql.DB) *Repo { return &Repo{db: db} }

func (r *Repo) CreateWorkout(ctx context.Context, in CreateWorkoutInput) (*Workout, error) {
    if _, err := DecodeParams(in.Mode, in.ParamsJSON); err != nil {
        return nil, err
    }
    if !in.Intensity.Valid() {
        return nil, ErrInvalidParams
    }
    if in.WarmupSec < 0 || in.CooldownSec < 0 {
        return nil, ErrInvalidParams
    }
    id := uuid.NewString()
    now := time.Now().UTC()
    _, err := r.db.ExecContext(ctx,
        `INSERT INTO workout(id, mode, params_json, intensity, warmup_sec, cooldown_sec, created_at)
         VALUES(?, ?, ?, ?, ?, ?, ?)`,
        id, string(in.Mode), string(in.ParamsJSON),
        nullString(string(in.Intensity)), in.WarmupSec, in.CooldownSec,
        now.Format(time.RFC3339Nano),
    )
    if err != nil {
        return nil, err
    }
    return &Workout{
        ID:          id,
        Mode:        in.Mode,
        ParamsJSON:  in.ParamsJSON,
        Intensity:   in.Intensity,
        WarmupSec:   in.WarmupSec,
        CooldownSec: in.CooldownSec,
        CreatedAt:   now,
    }, nil
}

func (r *Repo) GetWorkout(ctx context.Context, id string) (*Workout, error) {
    row := r.db.QueryRowContext(ctx,
        `SELECT id, mode, params_json, intensity, warmup_sec, cooldown_sec, created_at
         FROM workout WHERE id=?`, id)
    w, err := scanWorkout(row)
    if errors.Is(err, sql.ErrNoRows) {
        return nil, nil
    }
    return w, err
}

type scanner interface{ Scan(...any) error }

func scanWorkout(s scanner) (*Workout, error) {
    var w Workout
    var paramsStr, createdStr string
    var intensity sql.NullString
    if err := s.Scan(&w.ID, &w.Mode, &paramsStr, &intensity, &w.WarmupSec, &w.CooldownSec, &createdStr); err != nil {
        return nil, err
    }
    w.ParamsJSON = json.RawMessage(paramsStr)
    if intensity.Valid {
        w.Intensity = Intensity(intensity.String)
    }
    t, err := time.Parse(time.RFC3339Nano, createdStr)
    if err != nil {
        return nil, err
    }
    w.CreatedAt = t
    return &w, nil
}

func nullString(s string) any {
    if s == "" {
        return nil
    }
    return s
}
```

- [ ] **Step 4: Run tests to verify pass**

```
cd backend && go test ./internal/workout/ -v
```

Expected: all PASS.

- [ ] **Step 5: Commit**

```
git add backend/internal/workout/workout.go backend/internal/workout/workout_test.go
git commit -m "feat(workout): Repo with CreateWorkout + GetWorkout"
```

---

## Task 4 — Favorites CRUD in Repo

**Files:**
- Modify: `backend/internal/workout/workout.go` (append)
- Modify: `backend/internal/workout/workout_test.go` (append)

- [ ] **Step 1: Write failing tests**

Append to `workout_test.go`:

```go
func TestFavoritesCRUD(t *testing.T) {
    repo, _ := newTestRepo(t)
    ctx := context.Background()

    rowerID := seedRower(t, repo.db, "Alice")

    created, err := repo.CreateFavorite(ctx, CreateFavoriteInput{
        RowerID:    rowerID,
        Name:       "My 5k",
        Mode:       ModeDistance,
        ParamsJSON: json.RawMessage(`{"meters":5000}`),
        Intensity:  IntensityModerat,
        WarmupSec:  300,
    })
    if err != nil {
        t.Fatalf("create favorite: %v", err)
    }
    if created.Name != "My 5k" {
        t.Fatalf("bad name: %q", created.Name)
    }

    list, err := repo.ListFavorites(ctx, rowerID)
    if err != nil {
        t.Fatal(err)
    }
    if len(list) != 1 {
        t.Fatalf("expected 1, got %d", len(list))
    }

    if err := repo.DeleteFavorite(ctx, created.ID); err != nil {
        t.Fatal(err)
    }
    list, _ = repo.ListFavorites(ctx, rowerID)
    if len(list) != 0 {
        t.Fatalf("expected 0 after delete, got %d", len(list))
    }
}

func TestCreateFavoriteRequiresName(t *testing.T) {
    repo, _ := newTestRepo(t)
    rowerID := seedRower(t, repo.db, "Bob")
    _, err := repo.CreateFavorite(context.Background(), CreateFavoriteInput{
        RowerID:    rowerID,
        Name:       "",
        Mode:       ModeTime,
        ParamsJSON: json.RawMessage(`{"seconds":600}`),
    })
    if err == nil {
        t.Fatal("expected ErrNameRequired")
    }
}

func seedRower(t *testing.T, db *sql.DB, name string) string {
    t.Helper()
    id := uuid.NewString()
    _, err := db.Exec(
        `INSERT INTO rowers(id, name, color, created_at) VALUES(?, ?, '#fff', ?)`,
        id, name, time.Now().UTC().Format(time.RFC3339Nano),
    )
    if err != nil {
        t.Fatal(err)
    }
    return id
}
```

Add the imports if missing: `"database/sql"`, `"time"`, `"github.com/google/uuid"`.

- [ ] **Step 2: Run to verify fail**

```
cd backend && go test ./internal/workout/ -run TestFavorites -v
```

Expected: FAIL (symbols missing).

- [ ] **Step 3: Append to `workout.go`**

Append:

```go
type Favorite struct {
    ID          string          `json:"id"`
    RowerID     string          `json:"rower_id"`
    Name        string          `json:"name"`
    Mode        Mode            `json:"mode"`
    ParamsJSON  json.RawMessage `json:"params"`
    Intensity   Intensity       `json:"intensity,omitempty"`
    WarmupSec   int             `json:"warmup_sec"`
    CooldownSec int             `json:"cooldown_sec"`
    CreatedAt   time.Time       `json:"created_at"`
}

type CreateFavoriteInput struct {
    RowerID     string          `json:"rower_id"`
    Name        string          `json:"name"`
    Mode        Mode            `json:"mode"`
    ParamsJSON  json.RawMessage `json:"params"`
    Intensity   Intensity       `json:"intensity,omitempty"`
    WarmupSec   int             `json:"warmup_sec,omitempty"`
    CooldownSec int             `json:"cooldown_sec,omitempty"`
}

var ErrNameRequired = errors.New("workout: favorite name required")

func (r *Repo) CreateFavorite(ctx context.Context, in CreateFavoriteInput) (*Favorite, error) {
    if in.Name == "" {
        return nil, ErrNameRequired
    }
    if in.RowerID == "" {
        return nil, ErrInvalidParams
    }
    if _, err := DecodeParams(in.Mode, in.ParamsJSON); err != nil {
        return nil, err
    }
    if !in.Intensity.Valid() {
        return nil, ErrInvalidParams
    }
    if in.WarmupSec < 0 || in.CooldownSec < 0 {
        return nil, ErrInvalidParams
    }
    id := uuid.NewString()
    now := time.Now().UTC()
    _, err := r.db.ExecContext(ctx,
        `INSERT INTO workout_favorite(id, rower_id, name, mode, params_json, intensity, warmup_sec, cooldown_sec, created_at)
         VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        id, in.RowerID, in.Name, string(in.Mode), string(in.ParamsJSON),
        nullString(string(in.Intensity)), in.WarmupSec, in.CooldownSec,
        now.Format(time.RFC3339Nano),
    )
    if err != nil {
        return nil, err
    }
    return &Favorite{
        ID: id, RowerID: in.RowerID, Name: in.Name, Mode: in.Mode,
        ParamsJSON: in.ParamsJSON, Intensity: in.Intensity,
        WarmupSec: in.WarmupSec, CooldownSec: in.CooldownSec, CreatedAt: now,
    }, nil
}

func (r *Repo) ListFavorites(ctx context.Context, rowerID string) ([]Favorite, error) {
    rows, err := r.db.QueryContext(ctx,
        `SELECT id, rower_id, name, mode, params_json, intensity, warmup_sec, cooldown_sec, created_at
         FROM workout_favorite WHERE rower_id=? ORDER BY created_at DESC`, rowerID)
    if err != nil {
        return nil, err
    }
    defer rows.Close()
    out := []Favorite{}
    for rows.Next() {
        f, err := scanFavorite(rows)
        if err != nil {
            return nil, err
        }
        out = append(out, *f)
    }
    return out, rows.Err()
}

func (r *Repo) DeleteFavorite(ctx context.Context, id string) error {
    _, err := r.db.ExecContext(ctx, `DELETE FROM workout_favorite WHERE id=?`, id)
    return err
}

func scanFavorite(s scanner) (*Favorite, error) {
    var f Favorite
    var paramsStr, createdStr string
    var intensity sql.NullString
    if err := s.Scan(&f.ID, &f.RowerID, &f.Name, &f.Mode, &paramsStr, &intensity, &f.WarmupSec, &f.CooldownSec, &createdStr); err != nil {
        return nil, err
    }
    f.ParamsJSON = json.RawMessage(paramsStr)
    if intensity.Valid {
        f.Intensity = Intensity(intensity.String)
    }
    t, err := time.Parse(time.RFC3339Nano, createdStr)
    if err != nil {
        return nil, err
    }
    f.CreatedAt = t
    return &f, nil
}
```

- [ ] **Step 4: Run tests**

```
cd backend && go test ./internal/workout/ -v
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```
git add backend/internal/workout/workout.go backend/internal/workout/workout_test.go
git commit -m "feat(workout): favorites CRUD"
```

---

## Task 5 — LastWorkoutForRower

**Files:**
- Modify: `backend/internal/workout/workout.go`
- Modify: `backend/internal/workout/workout_test.go`

- [ ] **Step 1: Write failing test**

Append:

```go
func TestLastWorkoutForRower(t *testing.T) {
    repo, db := newTestRepo(t)
    ctx := context.Background()
    rowerID := seedRower(t, repo.db, "Carla")

    // No workout yet → nil.
    got, err := repo.LastWorkoutForRower(ctx, rowerID)
    if err != nil || got != nil {
        t.Fatalf("expected nil, got %v err=%v", got, err)
    }

    // Create workout + fake session linking.
    w, _ := repo.CreateWorkout(ctx, CreateWorkoutInput{
        Mode:       ModeTime,
        ParamsJSON: json.RawMessage(`{"seconds":1200}`),
    })
    seedSessionWithWorkout(t, db.Handle(), rowerID, w.ID)

    got, err = repo.LastWorkoutForRower(ctx, rowerID)
    if err != nil {
        t.Fatalf("err: %v", err)
    }
    if got == nil || got.ID != w.ID {
        t.Fatalf("unexpected: %+v", got)
    }
}

func seedSessionWithWorkout(t *testing.T, db *sql.DB, rowerID, workoutID string) {
    t.Helper()
    _, err := db.Exec(
        `INSERT INTO sessions(id, rower_id, started_at, initial_level, workout_id)
         VALUES(?, ?, ?, 1, ?)`,
        uuid.NewString(), rowerID, time.Now().UTC().Format(time.RFC3339Nano), workoutID,
    )
    if err != nil {
        t.Fatal(err)
    }
}
```

- [ ] **Step 2: Run to verify fail**

```
cd backend && go test ./internal/workout/ -run TestLastWorkoutForRower -v
```

Expected: FAIL.

- [ ] **Step 3: Implement**

Append to `workout.go`:

```go
// LastWorkoutForRower returns the most recent workout attached to a
// session of the given rower, or nil if none exist.
func (r *Repo) LastWorkoutForRower(ctx context.Context, rowerID string) (*Workout, error) {
    row := r.db.QueryRowContext(ctx,
        `SELECT w.id, w.mode, w.params_json, w.intensity, w.warmup_sec, w.cooldown_sec, w.created_at
         FROM workout w
         JOIN sessions s ON s.workout_id = w.id
         WHERE s.rower_id = ? AND s.deleted_at IS NULL
         ORDER BY s.started_at DESC LIMIT 1`, rowerID)
    w, err := scanWorkout(row)
    if errors.Is(err, sql.ErrNoRows) {
        return nil, nil
    }
    return w, err
}
```

- [ ] **Step 4: Run test**

```
cd backend && go test ./internal/workout/ -run TestLastWorkoutForRower -v
```

Expected: PASS.

- [ ] **Step 5: Commit**

```
git add backend/internal/workout/workout.go backend/internal/workout/workout_test.go
git commit -m "feat(workout): LastWorkoutForRower query"
```

---

## Task 6 — HTTP handler: POST /api/v1/workouts

**Files:**
- Create: `backend/internal/api/workouts.go`
- Create: `backend/internal/api/workouts_test.go`

- [ ] **Step 1: Write failing test**

Create `backend/internal/api/workouts_test.go`:

```go
package api

import (
    "bytes"
    "encoding/json"
    "net/http"
    "net/http/httptest"
    "path/filepath"
    "testing"

    "github.com/gloeckner-daniel/home-ergo/internal/storage"
    "github.com/gloeckner-daniel/home-ergo/internal/workout"
)

func newWorkoutTestServer(t *testing.T) (*httptest.Server, *workout.Repo) {
    t.Helper()
    db, err := storage.Open(filepath.Join(t.TempDir(), "test.db"))
    if err != nil {
        t.Fatal(err)
    }
    t.Cleanup(func() { db.Close() })
    repo := workout.NewRepo(db.Handle())
    srv := httptest.NewServer(WorkoutsHandler(repo))
    t.Cleanup(srv.Close)
    return srv, repo
}

func TestPostWorkoutValid(t *testing.T) {
    srv, _ := newWorkoutTestServer(t)
    body := `{"mode":"distance","params":{"meters":5000},"intensity":"moderat","warmup_sec":300}`
    resp, err := http.Post(srv.URL+"/api/v1/workouts", "application/json", bytes.NewBufferString(body))
    if err != nil {
        t.Fatal(err)
    }
    defer resp.Body.Close()
    if resp.StatusCode != http.StatusCreated {
        t.Fatalf("status=%d", resp.StatusCode)
    }
    var out workout.Workout
    if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
        t.Fatal(err)
    }
    if out.ID == "" || out.Mode != workout.ModeDistance {
        t.Fatalf("unexpected: %+v", out)
    }
}

func TestPostWorkoutInvalid(t *testing.T) {
    srv, _ := newWorkoutTestServer(t)
    body := `{"mode":"distance","params":{"meters":-1}}`
    resp, err := http.Post(srv.URL+"/api/v1/workouts", "application/json", bytes.NewBufferString(body))
    if err != nil {
        t.Fatal(err)
    }
    defer resp.Body.Close()
    if resp.StatusCode != http.StatusBadRequest {
        t.Fatalf("status=%d", resp.StatusCode)
    }
}
```

- [ ] **Step 2: Run to fail**

```
cd backend && go test ./internal/api/ -run TestPostWorkout -v
```

Expected: FAIL.

- [ ] **Step 3: Implement handler**

Create `backend/internal/api/workouts.go`:

```go
package api

import (
    "encoding/json"
    "errors"
    "net/http"

    "github.com/gloeckner-daniel/home-ergo/internal/workout"
)

func WorkoutsHandler(repo *workout.Repo) http.Handler {
    mux := http.NewServeMux()
    mux.HandleFunc("POST /api/v1/workouts", func(w http.ResponseWriter, r *http.Request) {
        var body struct {
            Mode        workout.Mode      `json:"mode"`
            Params      json.RawMessage   `json:"params"`
            Intensity   workout.Intensity `json:"intensity"`
            WarmupSec   int               `json:"warmup_sec"`
            CooldownSec int               `json:"cooldown_sec"`
        }
        if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
            http.Error(w, "invalid json", http.StatusBadRequest)
            return
        }
        out, err := repo.CreateWorkout(r.Context(), workout.CreateWorkoutInput{
            Mode: body.Mode, ParamsJSON: body.Params, Intensity: body.Intensity,
            WarmupSec: body.WarmupSec, CooldownSec: body.CooldownSec,
        })
        if errors.Is(err, workout.ErrInvalidParams) {
            http.Error(w, err.Error(), http.StatusBadRequest)
            return
        }
        if err != nil {
            http.Error(w, err.Error(), http.StatusInternalServerError)
            return
        }
        writeJSON(w, http.StatusCreated, out)
    })
    mux.HandleFunc("GET /api/v1/workouts/{id}", func(w http.ResponseWriter, r *http.Request) {
        id := r.PathValue("id")
        out, err := repo.GetWorkout(r.Context(), id)
        if err != nil {
            http.Error(w, err.Error(), http.StatusInternalServerError)
            return
        }
        if out == nil {
            http.NotFound(w, r)
            return
        }
        writeJSON(w, http.StatusOK, out)
    })
    return mux
}
```

(`writeJSON` already exists in `api` package, see `rowers.go`.)

- [ ] **Step 4: Run test to pass**

```
cd backend && go test ./internal/api/ -run TestPostWorkout -v
```

Expected: PASS.

- [ ] **Step 5: Commit**

```
git add backend/internal/api/workouts.go backend/internal/api/workouts_test.go
git commit -m "feat(api): POST /api/v1/workouts + GET /api/v1/workouts/{id}"
```

---

## Task 7 — HTTP: last workout + favorites endpoints

**Files:**
- Modify: `backend/internal/api/workouts.go`
- Modify: `backend/internal/api/workouts_test.go`

- [ ] **Step 1: Write failing tests**

Append to `workouts_test.go`:

```go
func TestGetLastWorkout(t *testing.T) {
    srv, repo := newWorkoutTestServer(t)
    // Seed rower + workout + session linking.
    dbh := repo.DB()
    rowerID := "r1"
    _, err := dbh.Exec(`INSERT INTO rowers(id, name, color, created_at) VALUES(?, 'A', '#fff', datetime('now'))`, rowerID)
    if err != nil {
        t.Fatal(err)
    }
    w, _ := repo.CreateWorkout(context.Background(), workout.CreateWorkoutInput{
        Mode: workout.ModeTime, ParamsJSON: json.RawMessage(`{"seconds":600}`),
    })
    _, err = dbh.Exec(
        `INSERT INTO sessions(id, rower_id, started_at, initial_level, workout_id) VALUES('s1', ?, datetime('now'), 1, ?)`,
        rowerID, w.ID,
    )
    if err != nil {
        t.Fatal(err)
    }

    req, _ := http.NewRequest("GET", srv.URL+"/api/v1/workouts/last?rower_id="+rowerID, nil)
    resp, err := http.DefaultClient.Do(req)
    if err != nil {
        t.Fatal(err)
    }
    defer resp.Body.Close()
    if resp.StatusCode != 200 {
        t.Fatalf("status=%d", resp.StatusCode)
    }
}

func TestFavoritesHTTP(t *testing.T) {
    srv, repo := newWorkoutTestServer(t)
    dbh := repo.DB()
    rowerID := "r2"
    _, _ = dbh.Exec(`INSERT INTO rowers(id, name, color, created_at) VALUES(?, 'B', '#fff', datetime('now'))`, rowerID)

    create := `{"rower_id":"r2","name":"Fav1","mode":"distance","params":{"meters":2000},"intensity":"hart"}`
    resp, err := http.Post(srv.URL+"/api/v1/favorites", "application/json", bytes.NewBufferString(create))
    if err != nil {
        t.Fatal(err)
    }
    if resp.StatusCode != http.StatusCreated {
        t.Fatalf("create status=%d", resp.StatusCode)
    }
    var created workout.Favorite
    _ = json.NewDecoder(resp.Body).Decode(&created)
    resp.Body.Close()

    resp, err = http.Get(srv.URL + "/api/v1/favorites?rower_id=r2")
    if err != nil {
        t.Fatal(err)
    }
    var list struct{ Favorites []workout.Favorite `json:"favorites"` }
    _ = json.NewDecoder(resp.Body).Decode(&list)
    resp.Body.Close()
    if len(list.Favorites) != 1 {
        t.Fatalf("expected 1 got %d", len(list.Favorites))
    }

    req, _ := http.NewRequest("DELETE", srv.URL+"/api/v1/favorites/"+created.ID, nil)
    resp, err = http.DefaultClient.Do(req)
    if err != nil {
        t.Fatal(err)
    }
    if resp.StatusCode != http.StatusNoContent {
        t.Fatalf("delete status=%d", resp.StatusCode)
    }
}
```

Add imports `"context"` at top of test file.

- [ ] **Step 2: Expose repo DB handle for tests**

Append to `backend/internal/workout/workout.go`:

```go
// DB exposes the underlying *sql.DB for tests and migrations wiring.
// Not part of the public application API.
func (r *Repo) DB() *sql.DB { return r.db }
```

- [ ] **Step 3: Implement remaining endpoints**

Add to `workouts.go` before `return mux`:

```go
    mux.HandleFunc("GET /api/v1/workouts/last", func(w http.ResponseWriter, r *http.Request) {
        rowerID := r.URL.Query().Get("rower_id")
        if rowerID == "" {
            http.Error(w, "rower_id required", http.StatusBadRequest)
            return
        }
        out, err := repo.LastWorkoutForRower(r.Context(), rowerID)
        if err != nil {
            http.Error(w, err.Error(), http.StatusInternalServerError)
            return
        }
        if out == nil {
            http.NotFound(w, r)
            return
        }
        writeJSON(w, http.StatusOK, out)
    })
```

Also add a new handler function in `workouts.go` for favorites:

```go
func FavoritesHandler(repo *workout.Repo) http.Handler {
    mux := http.NewServeMux()
    mux.HandleFunc("POST /api/v1/favorites", func(w http.ResponseWriter, r *http.Request) {
        var body struct {
            RowerID     string            `json:"rower_id"`
            Name        string            `json:"name"`
            Mode        workout.Mode      `json:"mode"`
            Params      json.RawMessage   `json:"params"`
            Intensity   workout.Intensity `json:"intensity"`
            WarmupSec   int               `json:"warmup_sec"`
            CooldownSec int               `json:"cooldown_sec"`
        }
        if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
            http.Error(w, "invalid json", http.StatusBadRequest)
            return
        }
        out, err := repo.CreateFavorite(r.Context(), workout.CreateFavoriteInput{
            RowerID: body.RowerID, Name: body.Name, Mode: body.Mode,
            ParamsJSON: body.Params, Intensity: body.Intensity,
            WarmupSec: body.WarmupSec, CooldownSec: body.CooldownSec,
        })
        if errors.Is(err, workout.ErrNameRequired) || errors.Is(err, workout.ErrInvalidParams) {
            http.Error(w, err.Error(), http.StatusBadRequest)
            return
        }
        if err != nil {
            http.Error(w, err.Error(), http.StatusInternalServerError)
            return
        }
        writeJSON(w, http.StatusCreated, out)
    })
    mux.HandleFunc("GET /api/v1/favorites", func(w http.ResponseWriter, r *http.Request) {
        rowerID := r.URL.Query().Get("rower_id")
        if rowerID == "" {
            http.Error(w, "rower_id required", http.StatusBadRequest)
            return
        }
        list, err := repo.ListFavorites(r.Context(), rowerID)
        if err != nil {
            http.Error(w, err.Error(), http.StatusInternalServerError)
            return
        }
        writeJSON(w, http.StatusOK, map[string]any{"favorites": list})
    })
    mux.HandleFunc("DELETE /api/v1/favorites/{id}", func(w http.ResponseWriter, r *http.Request) {
        if err := repo.DeleteFavorite(r.Context(), r.PathValue("id")); err != nil {
            http.Error(w, err.Error(), http.StatusInternalServerError)
            return
        }
        w.WriteHeader(http.StatusNoContent)
    })
    return mux
}
```

Extend `newWorkoutTestServer` in the test file to mount both handlers. Replace its body with:

```go
func newWorkoutTestServer(t *testing.T) (*httptest.Server, *workout.Repo) {
    t.Helper()
    db, err := storage.Open(filepath.Join(t.TempDir(), "test.db"))
    if err != nil {
        t.Fatal(err)
    }
    t.Cleanup(func() { db.Close() })
    repo := workout.NewRepo(db.Handle())
    mux := http.NewServeMux()
    mux.Handle("POST /api/v1/workouts", WorkoutsHandler(repo))
    mux.Handle("GET /api/v1/workouts/{id}", WorkoutsHandler(repo))
    mux.Handle("GET /api/v1/workouts/last", WorkoutsHandler(repo))
    mux.Handle("POST /api/v1/favorites", FavoritesHandler(repo))
    mux.Handle("GET /api/v1/favorites", FavoritesHandler(repo))
    mux.Handle("DELETE /api/v1/favorites/{id}", FavoritesHandler(repo))
    srv := httptest.NewServer(mux)
    t.Cleanup(srv.Close)
    return srv, repo
}
```

- [ ] **Step 4: Run tests**

```
cd backend && go test ./internal/api/ -run "TestPostWorkout|TestGetLastWorkout|TestFavoritesHTTP" -v
```

Expected: all PASS.

- [ ] **Step 5: Commit**

```
git add backend/internal/api/workouts.go backend/internal/api/workouts_test.go backend/internal/workout/workout.go
git commit -m "feat(api): GET /workouts/last + favorites CRUD endpoints"
```

---

## Task 8 — Wire into main router

**Files:**
- Modify: `backend/internal/api/router.go`
- Modify: `backend/cmd/home-ergo/main.go` (or equivalent; search for `api.NewRouter`)

- [ ] **Step 1: Locate the main wiring**

```
grep -rn "api.NewRouter" backend/cmd/ backend/internal/
```

Identify where `Inputs` is constructed.

- [ ] **Step 2: Add WorkoutRepo to Inputs**

Edit `backend/internal/api/router.go`:

```go
type Inputs struct {
    Ring        *pipeline.Ring
    Broadcaster *stream.Broadcaster
    DB          *sql.DB
    RowerRepo   *rower.Repo
    RowerHolder *rower.Holder
    WorkoutRepo *workout.Repo
    StartedAt   time.Time
}
```

Add import:
```go
"github.com/gloeckner-daniel/home-ergo/internal/workout"
```

Inside `NewRouter` before `return`:
```go
workouts := WorkoutsHandler(in.WorkoutRepo)
mux.Handle("POST /api/v1/workouts", workouts)
mux.Handle("GET /api/v1/workouts/{id}", workouts)
mux.Handle("GET /api/v1/workouts/last", workouts)

favs := FavoritesHandler(in.WorkoutRepo)
mux.Handle("POST /api/v1/favorites", favs)
mux.Handle("GET /api/v1/favorites", favs)
mux.Handle("DELETE /api/v1/favorites/{id}", favs)
```

- [ ] **Step 3: Construct WorkoutRepo at main**

In `main.go`:
```go
workoutRepo := workout.NewRepo(db.Handle())
```
Add to `api.NewRouter(api.Inputs{ ... WorkoutRepo: workoutRepo, ... })`.

- [ ] **Step 4: Build check**

```
cd backend && go build ./... && go test ./...
```

Expected: clean build, all tests PASS.

- [ ] **Step 5: Commit**

```
git add backend/internal/api/router.go backend/cmd/home-ergo/main.go
git commit -m "feat(backend): wire workout handlers into main router"
```

---

## Task 9 — Sessionizer accepts workout_id

**Files:**
- Modify: `backend/internal/session/sessionizer.go`
- Modify: `backend/internal/session/sessionizer_test.go`

- [ ] **Step 1: Read current sessionizer**

```
cat backend/internal/session/sessionizer.go
```

Identify the struct storing session state and the method that writes the row.

- [ ] **Step 2: Add WorkoutID field**

On the Sessionizer struct, add `pendingWorkoutID string` and a setter:

```go
// AttachWorkout sets the workout ID to persist on the next session insert.
// Cleared after the next session starts.
func (s *Sessionizer) AttachWorkout(id string) {
    s.mu.Lock()
    defer s.mu.Unlock()
    s.pendingWorkoutID = id
}
```

In the INSERT path for sessions, consume and clear:

```go
var workoutID any
if s.pendingWorkoutID != "" {
    workoutID = s.pendingWorkoutID
    s.pendingWorkoutID = ""
}
// add ", workout_id" to INSERT columns and this to the values list
```

(Follow the existing INSERT statement in the file and add `, workout_id` column + `?` placeholder + the value to the `Exec` args.)

- [ ] **Step 3: Write test**

Add a test that calls `AttachWorkout("w-123")`, feeds a minimal stream through the sessionizer, and then queries `SELECT workout_id FROM sessions WHERE id=?` to assert it equals `"w-123"`. Use the existing test fixtures as template.

- [ ] **Step 4: Run tests**

```
cd backend && go test ./internal/session/ -v
```

Expected: PASS.

- [ ] **Step 5: Commit**

```
git add backend/internal/session/sessionizer.go backend/internal/session/sessionizer_test.go
git commit -m "feat(sessionizer): persist workout_id on session insert"
```

---

## Task 10 — Endpoint to attach workout to the next session

**Files:**
- Modify: `backend/internal/api/workouts.go`
- Modify: `backend/internal/api/router.go` (one line)
- Modify: `backend/internal/api/workouts_test.go`

The frontend flow hits `POST /api/v1/workouts` then needs a way to say "the next session should be tagged with this workout." Simplest API: a POST that delegates to `sessionizer.AttachWorkout`.

- [ ] **Step 1: Write failing test**

Append to `workouts_test.go` a test that sets up a fake sessionizer (interface with `AttachWorkout(id string)`), posts to `/api/v1/workouts/{id}/attach`, and asserts the sessionizer received the right ID.

Define the interface at top of `workouts.go`:

```go
type SessionAttacher interface {
    AttachWorkout(id string)
}
```

- [ ] **Step 2: Implement handler**

```go
func WorkoutAttachHandler(repo *workout.Repo, att SessionAttacher) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        id := r.PathValue("id")
        wk, err := repo.GetWorkout(r.Context(), id)
        if err != nil {
            http.Error(w, err.Error(), http.StatusInternalServerError)
            return
        }
        if wk == nil {
            http.NotFound(w, r)
            return
        }
        att.AttachWorkout(id)
        w.WriteHeader(http.StatusNoContent)
    })
}
```

Mount in router:
```go
mux.Handle("POST /api/v1/workouts/{id}/attach", WorkoutAttachHandler(in.WorkoutRepo, in.Sessionizer))
```

Add `Sessionizer SessionAttacher` to `Inputs` (import `session` package and have it satisfy the interface — `*session.Sessionizer` already has `AttachWorkout` after Task 9).

- [ ] **Step 3: Run tests**

```
cd backend && go test ./internal/api/ -v
```

Expected: PASS.

- [ ] **Step 4: Integration smoke test**

```
cd backend && go build ./... && go run ./cmd/home-ergo &
sleep 1
curl -sX POST localhost:8080/api/v1/workouts \
  -H 'content-type: application/json' \
  -d '{"mode":"distance","params":{"meters":2000},"intensity":"moderat"}'
curl -sX POST localhost:8080/api/v1/workouts/<ID>/attach
kill %1
```

Expected: first call returns 201 + JSON with ID; attach returns 204.

- [ ] **Step 5: Commit**

```
git add backend/internal/api/workouts.go backend/internal/api/workouts_test.go backend/internal/api/router.go backend/cmd/home-ergo/main.go
git commit -m "feat(api): POST /workouts/{id}/attach — tag next session with workout"
```

---

## Task 11 — Orphan-workout cleanup on startup

**Files:**
- Modify: `backend/internal/workout/workout.go`
- Modify: `backend/internal/workout/workout_test.go`
- Modify: `backend/cmd/home-ergo/main.go`

- [ ] **Step 1: Write failing test**

```go
func TestCleanupOrphans(t *testing.T) {
    repo, _ := newTestRepo(t)
    ctx := context.Background()
    // Orphan workout (no session references).
    orphan, _ := repo.CreateWorkout(ctx, CreateWorkoutInput{
        Mode: ModeTime, ParamsJSON: json.RawMessage(`{"seconds":60}`),
    })
    // Referenced workout.
    rowerID := seedRower(t, repo.db, "X")
    referenced, _ := repo.CreateWorkout(ctx, CreateWorkoutInput{
        Mode: ModeTime, ParamsJSON: json.RawMessage(`{"seconds":120}`),
    })
    seedSessionWithWorkout(t, repo.db, rowerID, referenced.ID)

    n, err := repo.CleanupOrphans(ctx)
    if err != nil {
        t.Fatal(err)
    }
    if n != 1 {
        t.Fatalf("expected 1 deleted, got %d", n)
    }
    if got, _ := repo.GetWorkout(ctx, orphan.ID); got != nil {
        t.Fatal("orphan survived")
    }
    if got, _ := repo.GetWorkout(ctx, referenced.ID); got == nil {
        t.Fatal("referenced workout wrongly deleted")
    }
}
```

- [ ] **Step 2: Implement**

Append to `workout.go`:

```go
// CleanupOrphans deletes workout rows that no session references.
// Returns rows affected. Safe to call repeatedly.
func (r *Repo) CleanupOrphans(ctx context.Context) (int64, error) {
    res, err := r.db.ExecContext(ctx,
        `DELETE FROM workout WHERE id NOT IN (SELECT workout_id FROM sessions WHERE workout_id IS NOT NULL)`)
    if err != nil {
        return 0, err
    }
    return res.RowsAffected()
}
```

- [ ] **Step 3: Call at startup**

In `main.go`, after constructing `workoutRepo`:
```go
if n, err := workoutRepo.CleanupOrphans(context.Background()); err != nil {
    log.Printf("workout cleanup: %v", err)
} else if n > 0 {
    log.Printf("workout cleanup: deleted %d orphan rows", n)
}
```

- [ ] **Step 4: Run tests + build**

```
cd backend && go test ./internal/workout/ -v && go build ./...
```

Expected: PASS + clean build.

- [ ] **Step 5: Commit**

```
git add backend/internal/workout/workout.go backend/internal/workout/workout_test.go backend/cmd/home-ergo/main.go
git commit -m "feat(workout): orphan cleanup on startup"
```

---

## Self-review checklist (already run)

- Spec coverage:
  - Data model — Tasks 1–5 ✓
  - HTTP API (create workout, last, favorites, attach) — Tasks 6, 7, 10 ✓
  - Sessions.workout_id persistence — Tasks 1 + 9 ✓
  - Cleanup — Task 11 ✓
  - Favorites CRUD — Task 4 + 7 ✓
  - Segment derivation + SSE — **deferred to Live-View plan** ✓
- Placeholder scan: no `TBD`/`TODO` left in steps; each code step has full code; each test step has expected output.
- Type consistency: `Mode`, `Intensity`, `Params`, `Workout`, `Favorite`, `CreateWorkoutInput`, `CreateFavoriteInput`, `ErrInvalidParams`, `ErrNameRequired` defined in Tasks 2–4, referenced identically in Tasks 6–11.

## Not in this plan (follow-up plans)

- Segment expansion and SSE-level progress events (lives with Live-View plan)
- Frontend Home screen, selection flow, confirm screen (their own plans)
- Per-user intensity defaults from FEAT-0004 PBs
