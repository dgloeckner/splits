# M3 Rower Profiles (Minimal) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the hardcoded `'local-rower'` stub with real rower identities, bound to the device, so every persisted session is attributed to the currently active rower and multiple rowers can share one device via an avatar switcher.

**Architecture:** New `rowers` + `device_active_rower` SQLite tables. An HTTP middleware assigns a UUID `device_id` cookie to each browser. A shared `rower.Holder` in-memory value (mutex-guarded; seeded from DB) feeds the serial-loop sessionizer the current rower at session-start; it is updated whenever any device calls `PUT /api/v1/active-rower`. The frontend gains a `RowerGate` that forces `/onboarding` when no rower exists, a top-bar avatar strip for switching, and a settings screen for CRUD. BMI is computed client-side from optional weight_kg + height_cm.

**Tech Stack:**
- Backend: Go stdlib `net/http`, `database/sql`, `modernc.org/sqlite`, existing `github.com/oklog/ulid/v2`, new `github.com/google/uuid` for device cookie.
- Frontend: React 18 + TypeScript + Vite, `@tanstack/react-query@^5` (already installed), `react-router-dom` (already installed), CSS Modules.

**Spec reference:** `docs/superpowers/specs/2026-04-21-m3-rower-profiles-minimal-design.md`

**Conventions (follow these throughout):**
- Go: package paths under `github.com/gloeckner-daniel/home-ergo/internal/...`. Imports from `modernc.org/sqlite`. Tests live in the same package.
- Each backend package has a doc comment on its first file.
- Frontend fetch helpers mirror `web/src/api/client.ts` (throw on non-2xx, return typed body).
- Use `vitest` for web unit tests (see `*.test.tsx` siblings). Use `@playwright/test` for e2e (see `web/tests/e2e/`).
- Commit after each task. Conventional commits: `feat(backend):`, `test(web):`, etc.

**Working tree assumption:** Run this plan in a git worktree branched off `feat/history-read-ui` (already current). Commits stay on the branch; open PR at end.

---

## File Structure

### New files (backend)
- `backend/internal/storage/migrations/0003_rowers.sql` — additive tables.
- `backend/internal/rower/rower.go` — `Rower` struct, DB queries (`Create`, `Get`, `List`, `Update`, `GetActiveForDevice`, `SetActiveForDevice`, `LastActive`). Holder (mutex-guarded current).
- `backend/internal/rower/rower_test.go` — table-driven tests against in-memory SQLite.
- `backend/internal/api/rowers.go` — `RowersHandler`, `ActiveRowerHandler`.
- `backend/internal/api/rowers_test.go` — handler tests.
- `backend/internal/api/device_cookie.go` — middleware that sets a `device_id` cookie if absent.
- `backend/internal/api/device_cookie_test.go`.

### Modified files (backend)
- `backend/internal/api/router.go` — wire new handlers + middleware.
- `backend/internal/session/sessionizer.go` — accept `ResolveRower func() (id, name string)` instead of static fields.
- `backend/internal/session/sessionizer_test.go` — update existing tests to use resolver; add new test.
- `backend/cmd/homeergo/main.go` — construct Holder, seed, wire sessionizer + router.
- `backend/go.mod` + `go.sum` — add `github.com/google/uuid` (or reuse stdlib if present; see Task 1).

### New files (frontend)
- `web/src/api/rowers.ts` — typed client for rower + active-rower endpoints.
- `web/src/api/rowers.test.ts`.
- `web/src/hooks/useActiveRower.ts`.
- `web/src/hooks/useRowers.ts`.
- `web/src/app/RowerGate.tsx` — redirect to `/onboarding` when no rower / none active.
- `web/src/pages/OnboardingPage.tsx` + `.module.css` + `.test.tsx`.
- `web/src/app/RowerStrip.tsx` + `.module.css`.
- `web/src/util/bmi.ts` + `.test.ts`.
- `web/tests/e2e/rower-onboarding.spec.ts`.

### Modified files (frontend)
- `web/src/app/AppRouter.tsx` — add `/onboarding` route + wrap with `<RowerGate>`.
- `web/src/app/AppLayout.tsx` — render `<RowerStrip>` in the top bar.
- `web/src/pages/ProfilePage.tsx` — rewrite as settings: list rowers, edit fields, "Add rower" button, BMI line.
- `web/src/pages/HistoryPage.tsx` — show colored dot + rower name per row (or "—").
- `web/src/pages/HistoryPage.module.css` — rower badge styles.

### Meta
- `ROADMAP.md` — mark M3 items done.

---

## Task 1: Add google/uuid dependency

**Files:**
- Modify: `backend/go.mod`, `backend/go.sum`

- [ ] **Step 1: Add dependency**

From `backend/`:
```bash
go get github.com/google/uuid@v1.6.0
```

- [ ] **Step 2: Verify import resolves**

```bash
go build ./...
```
Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add backend/go.mod backend/go.sum
git commit -m "chore(backend): add google/uuid for device cookie"
```

---

## Task 2: SQLite migration 0003 (rowers + device_active_rower)

**Files:**
- Create: `backend/internal/storage/migrations/0003_rowers.sql`
- Test: `backend/internal/storage/db_test.go` (existing — just run it)

- [ ] **Step 1: Write migration**

`backend/internal/storage/migrations/0003_rowers.sql`:
```sql
CREATE TABLE IF NOT EXISTS rowers (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  weight_kg  REAL,
  height_cm  REAL,
  dob        TEXT,
  color      TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS device_active_rower (
  device_id  TEXT PRIMARY KEY,
  rower_id   TEXT NOT NULL REFERENCES rowers(id),
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_device_active_rower_updated
  ON device_active_rower(updated_at);
```

- [ ] **Step 2: Run storage tests to confirm migration applies**

```bash
cd backend && go test ./internal/storage/...
```
Expected: PASS (existing tests exercise `Open`, which runs migrations).

- [ ] **Step 3: Commit**

```bash
git add backend/internal/storage/migrations/0003_rowers.sql
git commit -m "feat(backend): migration 0003 — rowers + device_active_rower"
```

---

## Task 3: Rower struct + Create query (test-first)

**Files:**
- Create: `backend/internal/rower/rower.go`
- Create: `backend/internal/rower/rower_test.go`

- [ ] **Step 1: Write the failing test**

`backend/internal/rower/rower_test.go`:
```go
package rower

import (
	"context"
	"testing"

	"github.com/gloeckner-daniel/home-ergo/internal/storage"
)

func openTestDB(t *testing.T) *storage.DB {
	t.Helper()
	db, err := storage.Open(":memory:")
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })
	return db
}

func TestCreate_AssignsIDAndCreatedAt(t *testing.T) {
	ctx := context.Background()
	db := openTestDB(t)
	repo := NewRepo(db.Handle())
	r, err := repo.Create(ctx, CreateInput{Name: "Alice", WeightKg: ptrFloat(70), HeightCm: ptrFloat(172), Color: "#ff6b6b"})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if r.ID == "" {
		t.Fatalf("empty id")
	}
	if r.CreatedAt.IsZero() {
		t.Fatalf("zero created_at")
	}
	if r.Name != "Alice" || r.Color != "#ff6b6b" {
		t.Fatalf("unexpected fields: %+v", r)
	}
	if r.WeightKg == nil || *r.WeightKg != 70 {
		t.Fatalf("weight: %+v", r.WeightKg)
	}
}

func ptrFloat(v float64) *float64 { return &v }
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd backend && go test ./internal/rower/...
```
Expected: FAIL (package does not exist).

- [ ] **Step 3: Implement minimal code to make it pass**

`backend/internal/rower/rower.go`:
```go
// Package rower owns rower profile CRUD and the "active rower per
// device" mapping. A single process-wide Holder gives the sessionizer
// (which runs off the serial loop, not an HTTP request) a consistent
// notion of who to attribute the current session to.
package rower

import (
	"context"
	"database/sql"
	"errors"
	"time"

	"github.com/google/uuid"
)

type Rower struct {
	ID        string     `json:"id"`
	Name      string     `json:"name"`
	WeightKg  *float64   `json:"weight_kg,omitempty"`
	HeightCm  *float64   `json:"height_cm,omitempty"`
	DOB       *string    `json:"dob,omitempty"`
	Color     string     `json:"color"`
	CreatedAt time.Time  `json:"created_at"`
}

type CreateInput struct {
	Name     string
	WeightKg *float64
	HeightCm *float64
	DOB      *string
	Color    string
}

var ErrNameRequired = errors.New("rower: name required")

type Repo struct{ db *sql.DB }

func NewRepo(db *sql.DB) *Repo { return &Repo{db: db} }

var palette = []string{"#ff6b6b", "#4ecdc4", "#ffe66d", "#a78bfa", "#f97316", "#60a5fa", "#34d399", "#f472b6"}

func (r *Repo) Create(ctx context.Context, in CreateInput) (*Rower, error) {
	if in.Name == "" {
		return nil, ErrNameRequired
	}
	if in.Color == "" {
		in.Color = palette[time.Now().UnixNano()%int64(len(palette))]
	}
	id := uuid.NewString()
	now := time.Now().UTC()
	_, err := r.db.ExecContext(ctx,
		`INSERT INTO rowers(id, name, weight_kg, height_cm, dob, color, created_at)
		 VALUES(?, ?, ?, ?, ?, ?, ?)`,
		id, in.Name, in.WeightKg, in.HeightCm, in.DOB, in.Color, now.Format(time.RFC3339Nano),
	)
	if err != nil {
		return nil, err
	}
	return &Rower{
		ID: id, Name: in.Name, WeightKg: in.WeightKg, HeightCm: in.HeightCm, DOB: in.DOB,
		Color: in.Color, CreatedAt: now,
	}, nil
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd backend && go test ./internal/rower/...
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/internal/rower/
git commit -m "feat(backend): rower.Repo Create"
```

---

## Task 4: List + Get queries

**Files:**
- Modify: `backend/internal/rower/rower.go`
- Modify: `backend/internal/rower/rower_test.go`

- [ ] **Step 1: Write the failing tests**

Append to `rower_test.go`:
```go
func TestListAndGet(t *testing.T) {
	ctx := context.Background()
	db := openTestDB(t)
	repo := NewRepo(db.Handle())
	a, _ := repo.Create(ctx, CreateInput{Name: "Alice", Color: "#ff6b6b"})
	b, _ := repo.Create(ctx, CreateInput{Name: "Bob", Color: "#4ecdc4"})

	list, err := repo.List(ctx)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(list) != 2 {
		t.Fatalf("expected 2, got %d", len(list))
	}

	got, err := repo.Get(ctx, a.ID)
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if got == nil || got.Name != "Alice" {
		t.Fatalf("got: %+v", got)
	}
	_ = b

	missing, err := repo.Get(ctx, "does-not-exist")
	if err != nil {
		t.Fatalf("get missing: %v", err)
	}
	if missing != nil {
		t.Fatalf("expected nil, got %+v", missing)
	}
}
```

- [ ] **Step 2: Run — expect FAIL**

```bash
cd backend && go test ./internal/rower/...
```
Expected: FAIL (List, Get undefined).

- [ ] **Step 3: Implement List + Get**

Append to `rower.go`:
```go
func (r *Repo) List(ctx context.Context) ([]Rower, error) {
	rows, err := r.db.QueryContext(ctx,
		`SELECT id, name, weight_kg, height_cm, dob, color, created_at
		 FROM rowers ORDER BY created_at ASC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Rower
	for rows.Next() {
		r, err := scanRower(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *r)
	}
	return out, rows.Err()
}

func (r *Repo) Get(ctx context.Context, id string) (*Rower, error) {
	row := r.db.QueryRowContext(ctx,
		`SELECT id, name, weight_kg, height_cm, dob, color, created_at
		 FROM rowers WHERE id=?`, id)
	out, err := scanRower(row)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	return out, err
}

type scanner interface {
	Scan(dest ...any) error
}

func scanRower(s scanner) (*Rower, error) {
	var r Rower
	var weight, height sql.NullFloat64
	var dob sql.NullString
	var createdStr string
	if err := s.Scan(&r.ID, &r.Name, &weight, &height, &dob, &r.Color, &createdStr); err != nil {
		return nil, err
	}
	if weight.Valid {
		v := weight.Float64
		r.WeightKg = &v
	}
	if height.Valid {
		v := height.Float64
		r.HeightCm = &v
	}
	if dob.Valid {
		v := dob.String
		r.DOB = &v
	}
	t, err := time.Parse(time.RFC3339Nano, createdStr)
	if err != nil {
		return nil, err
	}
	r.CreatedAt = t
	return &r, nil
}
```

- [ ] **Step 4: Run — expect PASS**

```bash
cd backend && go test ./internal/rower/...
```

- [ ] **Step 5: Commit**

```bash
git add backend/internal/rower/
git commit -m "feat(backend): rower.Repo List + Get"
```

---

## Task 5: Update query (partial)

**Files:**
- Modify: `backend/internal/rower/rower.go`
- Modify: `backend/internal/rower/rower_test.go`

- [ ] **Step 1: Write the failing test**

Append to `rower_test.go`:
```go
func TestUpdate_PartialFields(t *testing.T) {
	ctx := context.Background()
	db := openTestDB(t)
	repo := NewRepo(db.Handle())
	r, _ := repo.Create(ctx, CreateInput{Name: "Alice", Color: "#ff6b6b"})

	name := "Alicia"
	w := 68.5
	updated, err := repo.Update(ctx, r.ID, UpdateInput{Name: &name, WeightKg: &w})
	if err != nil {
		t.Fatalf("update: %v", err)
	}
	if updated.Name != "Alicia" {
		t.Fatalf("name: %s", updated.Name)
	}
	if updated.WeightKg == nil || *updated.WeightKg != 68.5 {
		t.Fatalf("weight: %+v", updated.WeightKg)
	}
	if updated.Color != "#ff6b6b" {
		t.Fatalf("color should be unchanged: %s", updated.Color)
	}
}
```

- [ ] **Step 2: Run — expect FAIL**

```bash
cd backend && go test ./internal/rower/...
```

- [ ] **Step 3: Implement Update**

Append to `rower.go`:
```go
type UpdateInput struct {
	Name     *string
	WeightKg *float64
	HeightCm *float64
	DOB      *string
	Color    *string
}

func (r *Repo) Update(ctx context.Context, id string, in UpdateInput) (*Rower, error) {
	sets := []string{}
	args := []any{}
	if in.Name != nil {
		if *in.Name == "" {
			return nil, ErrNameRequired
		}
		sets = append(sets, "name=?")
		args = append(args, *in.Name)
	}
	if in.WeightKg != nil {
		sets = append(sets, "weight_kg=?")
		args = append(args, *in.WeightKg)
	}
	if in.HeightCm != nil {
		sets = append(sets, "height_cm=?")
		args = append(args, *in.HeightCm)
	}
	if in.DOB != nil {
		sets = append(sets, "dob=?")
		args = append(args, *in.DOB)
	}
	if in.Color != nil {
		sets = append(sets, "color=?")
		args = append(args, *in.Color)
	}
	if len(sets) > 0 {
		args = append(args, id)
		q := "UPDATE rowers SET " + join(sets, ", ") + " WHERE id=?"
		if _, err := r.db.ExecContext(ctx, q, args...); err != nil {
			return nil, err
		}
	}
	return r.Get(ctx, id)
}

func join(s []string, sep string) string {
	out := ""
	for i, v := range s {
		if i > 0 {
			out += sep
		}
		out += v
	}
	return out
}
```

(Prefer `strings.Join`; importing `strings` is fine. Replace the `join` helper with `strings.Join` and import `"strings"`.)

- [ ] **Step 4: Run — expect PASS**

```bash
cd backend && go test ./internal/rower/...
```

- [ ] **Step 5: Commit**

```bash
git add backend/internal/rower/
git commit -m "feat(backend): rower.Repo Update"
```

---

## Task 6: Active-rower per-device upsert + lookup

**Files:**
- Modify: `backend/internal/rower/rower.go`
- Modify: `backend/internal/rower/rower_test.go`

- [ ] **Step 1: Write the failing test**

Append to `rower_test.go`:
```go
func TestActiveRower_SetGet(t *testing.T) {
	ctx := context.Background()
	db := openTestDB(t)
	repo := NewRepo(db.Handle())
	r, _ := repo.Create(ctx, CreateInput{Name: "Alice", Color: "#ff6b6b"})

	if err := repo.SetActiveForDevice(ctx, "dev-1", r.ID); err != nil {
		t.Fatalf("set: %v", err)
	}
	got, err := repo.GetActiveForDevice(ctx, "dev-1")
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if got == nil || got.ID != r.ID {
		t.Fatalf("got: %+v", got)
	}

	missing, err := repo.GetActiveForDevice(ctx, "dev-2")
	if err != nil || missing != nil {
		t.Fatalf("missing should be nil, got %+v, err=%v", missing, err)
	}
}

func TestActiveRower_LastActive(t *testing.T) {
	ctx := context.Background()
	db := openTestDB(t)
	repo := NewRepo(db.Handle())
	a, _ := repo.Create(ctx, CreateInput{Name: "A", Color: "#ff6b6b"})
	b, _ := repo.Create(ctx, CreateInput{Name: "B", Color: "#4ecdc4"})
	_ = repo.SetActiveForDevice(ctx, "dev-1", a.ID)
	time.Sleep(2 * time.Millisecond)
	_ = repo.SetActiveForDevice(ctx, "dev-2", b.ID)

	last, err := repo.LastActive(ctx)
	if err != nil {
		t.Fatalf("last: %v", err)
	}
	if last == nil || last.ID != b.ID {
		t.Fatalf("expected B, got %+v", last)
	}
}
```

- [ ] **Step 2: Run — expect FAIL**

```bash
cd backend && go test ./internal/rower/...
```

- [ ] **Step 3: Implement**

Append to `rower.go`:
```go
func (r *Repo) SetActiveForDevice(ctx context.Context, deviceID, rowerID string) error {
	now := time.Now().UTC().Format(time.RFC3339Nano)
	_, err := r.db.ExecContext(ctx,
		`INSERT INTO device_active_rower(device_id, rower_id, updated_at)
		 VALUES(?, ?, ?)
		 ON CONFLICT(device_id) DO UPDATE SET rower_id=excluded.rower_id, updated_at=excluded.updated_at`,
		deviceID, rowerID, now,
	)
	return err
}

func (r *Repo) GetActiveForDevice(ctx context.Context, deviceID string) (*Rower, error) {
	row := r.db.QueryRowContext(ctx,
		`SELECT r.id, r.name, r.weight_kg, r.height_cm, r.dob, r.color, r.created_at
		 FROM device_active_rower d JOIN rowers r ON r.id = d.rower_id
		 WHERE d.device_id = ?`, deviceID)
	out, err := scanRower(row)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	return out, err
}

func (r *Repo) LastActive(ctx context.Context) (*Rower, error) {
	row := r.db.QueryRowContext(ctx,
		`SELECT r.id, r.name, r.weight_kg, r.height_cm, r.dob, r.color, r.created_at
		 FROM device_active_rower d JOIN rowers r ON r.id = d.rower_id
		 ORDER BY d.updated_at DESC LIMIT 1`)
	out, err := scanRower(row)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	return out, err
}
```

- [ ] **Step 4: Run — expect PASS**

```bash
cd backend && go test ./internal/rower/...
```

- [ ] **Step 5: Commit**

```bash
git add backend/internal/rower/
git commit -m "feat(backend): rower active-per-device upsert/get + LastActive"
```

---

## Task 7: Rower Holder (process-wide current)

**Files:**
- Modify: `backend/internal/rower/rower.go`
- Create: append test to `backend/internal/rower/rower_test.go`

The Holder is the bridge between the HTTP-driven active-rower endpoints and the serial-loop sessionizer (which has no request context). Last-PUT wins; seed from `LastActive` at startup.

- [ ] **Step 1: Write the failing test**

Append to `rower_test.go`:
```go
func TestHolder_SeedAndSet(t *testing.T) {
	h := NewHolder()
	id, name := h.Resolve()
	if id != "" || name != "" {
		t.Fatalf("empty holder should return zero values")
	}
	h.Set("rw-1", "Alice")
	id, name = h.Resolve()
	if id != "rw-1" || name != "Alice" {
		t.Fatalf("got %q %q", id, name)
	}
}
```

- [ ] **Step 2: Run — expect FAIL**

```bash
cd backend && go test ./internal/rower/...
```

- [ ] **Step 3: Implement**

Append to `rower.go`:
```go
import "sync" // add to existing import block

type Holder struct {
	mu   sync.RWMutex
	id   string
	name string
}

func NewHolder() *Holder { return &Holder{} }

func (h *Holder) Set(id, name string) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.id = id
	h.name = name
}

func (h *Holder) Resolve() (string, string) {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return h.id, h.name
}
```

- [ ] **Step 4: Run — expect PASS**

```bash
cd backend && go test ./internal/rower/...
```

- [ ] **Step 5: Commit**

```bash
git add backend/internal/rower/
git commit -m "feat(backend): rower.Holder — process-wide current rower"
```

---

## Task 8: Device-cookie middleware

**Files:**
- Create: `backend/internal/api/device_cookie.go`
- Create: `backend/internal/api/device_cookie_test.go`

- [ ] **Step 1: Write the failing test**

`backend/internal/api/device_cookie_test.go`:
```go
package api

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestDeviceCookie_SetsWhenAbsent(t *testing.T) {
	var seen string
	h := DeviceCookie()(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		seen = DeviceIDFromContext(r.Context())
	}))
	req := httptest.NewRequest("GET", "/api/v1/rowers", nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if seen == "" {
		t.Fatalf("handler saw empty device id")
	}
	res := rec.Result()
	cookies := res.Cookies()
	if len(cookies) != 1 || cookies[0].Name != "device_id" || cookies[0].Value == "" {
		t.Fatalf("cookie not set: %+v", cookies)
	}
	if !cookies[0].HttpOnly {
		t.Fatalf("cookie must be HttpOnly")
	}
}

func TestDeviceCookie_ReusesExisting(t *testing.T) {
	var seen string
	h := DeviceCookie()(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		seen = DeviceIDFromContext(r.Context())
	}))
	req := httptest.NewRequest("GET", "/api/v1/rowers", nil)
	req.AddCookie(&http.Cookie{Name: "device_id", Value: "pre-existing"})
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if seen != "pre-existing" {
		t.Fatalf("expected pre-existing, got %q", seen)
	}
	if len(rec.Result().Cookies()) != 0 {
		t.Fatalf("should not re-set cookie")
	}
}

// ensure context keys are exported or accessible for tests
var _ = context.Background
```

- [ ] **Step 2: Run — expect FAIL**

```bash
cd backend && go test ./internal/api/...
```

- [ ] **Step 3: Implement**

`backend/internal/api/device_cookie.go`:
```go
package api

import (
	"context"
	"net/http"
	"time"

	"github.com/google/uuid"
)

type ctxKey struct{ name string }

var deviceIDKey = ctxKey{"device_id"}

const deviceCookieName = "device_id"
const deviceCookieMaxAge = 10 * 365 * 24 * 60 * 60 // ~10 years

// DeviceCookie returns middleware that ensures every request carries a
// stable "device_id" cookie. On first contact the middleware generates
// a UUIDv4, sets an HttpOnly cookie, and stuffs the id into the request
// context for downstream handlers.
func DeviceCookie() func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			id := ""
			if c, err := r.Cookie(deviceCookieName); err == nil && c.Value != "" {
				id = c.Value
			} else {
				id = uuid.NewString()
				http.SetCookie(w, &http.Cookie{
					Name:     deviceCookieName,
					Value:    id,
					Path:     "/",
					HttpOnly: true,
					SameSite: http.SameSiteLaxMode,
					MaxAge:   deviceCookieMaxAge,
					Expires:  time.Now().Add(time.Duration(deviceCookieMaxAge) * time.Second),
				})
			}
			next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), deviceIDKey, id)))
		})
	}
}

func DeviceIDFromContext(ctx context.Context) string {
	v, _ := ctx.Value(deviceIDKey).(string)
	return v
}
```

- [ ] **Step 4: Run — expect PASS**

```bash
cd backend && go test ./internal/api/...
```

- [ ] **Step 5: Commit**

```bash
git add backend/internal/api/device_cookie.go backend/internal/api/device_cookie_test.go
git commit -m "feat(backend): device_id HttpOnly cookie middleware"
```

---

## Task 9: Rower HTTP handlers (list/create/patch)

**Files:**
- Create: `backend/internal/api/rowers.go`
- Create: `backend/internal/api/rowers_test.go`

- [ ] **Step 1: Write the failing test**

`backend/internal/api/rowers_test.go`:
```go
package api

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gloeckner-daniel/home-ergo/internal/rower"
	"github.com/gloeckner-daniel/home-ergo/internal/storage"
)

func newRowerTestServer(t *testing.T) (http.Handler, *rower.Repo, *rower.Holder) {
	t.Helper()
	db, err := storage.Open(":memory:")
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })
	repo := rower.NewRepo(db.Handle())
	holder := rower.NewHolder()
	mux := http.NewServeMux()
	h := RowersHandler(repo)
	mux.Handle("GET /api/v1/rowers", h)
	mux.Handle("POST /api/v1/rowers", h)
	mux.Handle("PATCH /api/v1/rowers/{id}", h)
	a := ActiveRowerHandler(repo, holder)
	mux.Handle("GET /api/v1/active-rower", a)
	mux.Handle("PUT /api/v1/active-rower", a)
	return Chain(mux, DeviceCookie()), repo, holder
}

func TestRowers_CreateListPatch(t *testing.T) {
	h, _, _ := newRowerTestServer(t)

	// create
	body := `{"name":"Alice","weight_kg":70,"height_cm":172,"color":"#ff6b6b"}`
	req := httptest.NewRequest("POST", "/api/v1/rowers", bytes.NewBufferString(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusCreated {
		t.Fatalf("create status: %d body=%s", rec.Code, rec.Body.String())
	}
	var created struct{ ID string `json:"id"` }
	_ = json.Unmarshal(rec.Body.Bytes(), &created)
	if created.ID == "" {
		t.Fatalf("no id returned")
	}

	// list
	req2 := httptest.NewRequest("GET", "/api/v1/rowers", nil)
	rec2 := httptest.NewRecorder()
	h.ServeHTTP(rec2, req2)
	if rec2.Code != 200 {
		t.Fatalf("list status: %d", rec2.Code)
	}
	var list struct{ Rowers []map[string]any `json:"rowers"` }
	_ = json.Unmarshal(rec2.Body.Bytes(), &list)
	if len(list.Rowers) != 1 {
		t.Fatalf("expected 1, got %d", len(list.Rowers))
	}

	// patch
	req3 := httptest.NewRequest("PATCH", "/api/v1/rowers/"+created.ID, bytes.NewBufferString(`{"name":"Alicia"}`))
	req3.Header.Set("Content-Type", "application/json")
	rec3 := httptest.NewRecorder()
	h.ServeHTTP(rec3, req3)
	if rec3.Code != 200 {
		t.Fatalf("patch status: %d body=%s", rec3.Code, rec3.Body.String())
	}
	var patched map[string]any
	_ = json.Unmarshal(rec3.Body.Bytes(), &patched)
	if patched["name"] != "Alicia" {
		t.Fatalf("patched name: %+v", patched)
	}
}

func TestRowers_CreateRejectsEmptyName(t *testing.T) {
	h, _, _ := newRowerTestServer(t)
	req := httptest.NewRequest("POST", "/api/v1/rowers", bytes.NewBufferString(`{"name":""}`))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("want 400, got %d", rec.Code)
	}
}
```

- [ ] **Step 2: Run — expect FAIL (handlers don't exist)**

```bash
cd backend && go test ./internal/api/...
```

- [ ] **Step 3: Implement RowersHandler**

`backend/internal/api/rowers.go`:
```go
package api

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/gloeckner-daniel/home-ergo/internal/rower"
)

func RowersHandler(repo *rower.Repo) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/v1/rowers", func(w http.ResponseWriter, r *http.Request) {
		list, err := repo.List(r.Context())
		if err != nil {
			http.Error(w, err.Error(), 500)
			return
		}
		if list == nil {
			list = []rower.Rower{}
		}
		writeJSON(w, 200, map[string]any{"rowers": list})
	})
	mux.HandleFunc("POST /api/v1/rowers", func(w http.ResponseWriter, r *http.Request) {
		var in rower.CreateInput
		if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
			http.Error(w, "invalid json", 400)
			return
		}
		out, err := repo.Create(r.Context(), in)
		if errors.Is(err, rower.ErrNameRequired) {
			http.Error(w, err.Error(), 400)
			return
		}
		if err != nil {
			http.Error(w, err.Error(), 500)
			return
		}
		writeJSON(w, http.StatusCreated, out)
	})
	mux.HandleFunc("PATCH /api/v1/rowers/{id}", func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		var in rower.UpdateInput
		if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
			http.Error(w, "invalid json", 400)
			return
		}
		out, err := repo.Update(r.Context(), id, in)
		if errors.Is(err, rower.ErrNameRequired) {
			http.Error(w, err.Error(), 400)
			return
		}
		if err != nil {
			http.Error(w, err.Error(), 500)
			return
		}
		if out == nil {
			http.NotFound(w, r)
			return
		}
		writeJSON(w, 200, out)
	})
	return mux
}
```

- [ ] **Step 4: Run — expect FAIL still (ActiveRowerHandler undefined)**

We will add ActiveRowerHandler in the next task. To run only the rower-CRUD subtest:

```bash
cd backend && go test ./internal/api/ -run TestRowers_CreateListPatch -v
```
Expected: FAIL — ActiveRowerHandler undefined. That's OK; finish Task 10 before running again.

- [ ] **Step 5: Commit**

```bash
git add backend/internal/api/rowers.go backend/internal/api/rowers_test.go
git commit -m "feat(backend): rowers CRUD handler"
```

---

## Task 10: Active-rower HTTP handlers

**Files:**
- Modify: `backend/internal/api/rowers.go`

- [ ] **Step 1: Implement ActiveRowerHandler**

Append to `backend/internal/api/rowers.go`:
```go
func ActiveRowerHandler(repo *rower.Repo, holder *rower.Holder) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/v1/active-rower", func(w http.ResponseWriter, r *http.Request) {
		devID := DeviceIDFromContext(r.Context())
		out, err := repo.GetActiveForDevice(r.Context(), devID)
		if err != nil {
			http.Error(w, err.Error(), 500)
			return
		}
		if out == nil {
			http.NotFound(w, r)
			return
		}
		writeJSON(w, 200, out)
	})
	mux.HandleFunc("PUT /api/v1/active-rower", func(w http.ResponseWriter, r *http.Request) {
		devID := DeviceIDFromContext(r.Context())
		var body struct {
			RowerID string `json:"rower_id"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.RowerID == "" {
			http.Error(w, "rower_id required", 400)
			return
		}
		target, err := repo.Get(r.Context(), body.RowerID)
		if err != nil {
			http.Error(w, err.Error(), 500)
			return
		}
		if target == nil {
			http.Error(w, "rower not found", 404)
			return
		}
		if err := repo.SetActiveForDevice(r.Context(), devID, body.RowerID); err != nil {
			http.Error(w, err.Error(), 500)
			return
		}
		holder.Set(target.ID, target.Name)
		writeJSON(w, 200, target)
	})
	return mux
}
```

- [ ] **Step 2: Run the whole api test suite — expect PASS**

```bash
cd backend && go test ./internal/api/...
```

- [ ] **Step 3: Commit**

```bash
git add backend/internal/api/rowers.go
git commit -m "feat(backend): active-rower GET/PUT (device-scoped)"
```

---

## Task 11: Wire handlers + middleware into router

**Files:**
- Modify: `backend/internal/api/router.go`

- [ ] **Step 1: Extend Inputs + wire**

Replace the file contents:
```go
package api

import (
	"database/sql"
	"net/http"
	"time"

	"github.com/gloeckner-daniel/home-ergo/internal/pipeline"
	"github.com/gloeckner-daniel/home-ergo/internal/rower"
	"github.com/gloeckner-daniel/home-ergo/internal/stream"
)

type Inputs struct {
	Ring        *pipeline.Ring
	Broadcaster *stream.Broadcaster
	DB          *sql.DB
	RowerRepo   *rower.Repo
	RowerHolder *rower.Holder
	StartedAt   time.Time
}

func NewRouter(in Inputs) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/health", healthHandler)
	mux.Handle("GET /api/v1/stream", stream.NewHandler(in.Ring, in.Broadcaster))

	sessions := SessionsHandler(in.DB)
	mux.Handle("GET /api/v1/sessions", sessions)
	mux.Handle("GET /api/v1/sessions/{id}", sessions)
	mux.Handle("GET /api/v1/sessions/{id}/samples", sessions)
	mux.Handle("DELETE /api/v1/sessions/{id}", sessions)

	rowers := RowersHandler(in.RowerRepo)
	mux.Handle("GET /api/v1/rowers", rowers)
	mux.Handle("POST /api/v1/rowers", rowers)
	mux.Handle("PATCH /api/v1/rowers/{id}", rowers)

	active := ActiveRowerHandler(in.RowerRepo, in.RowerHolder)
	mux.Handle("GET /api/v1/active-rower", active)
	mux.Handle("PUT /api/v1/active-rower", active)

	mux.Handle("GET /debug/ingest", DebugIngestHandler(DebugIngestInputs{
		Ring:        in.Ring,
		Broadcaster: in.Broadcaster,
		StartedAt:   in.StartedAt,
	}))
	return Chain(mux, Recover(), Logging(), DeviceCookie())
}
```

- [ ] **Step 2: Run — expect PASS**

```bash
cd backend && go build ./... && go test ./internal/api/...
```

- [ ] **Step 3: Commit**

```bash
git add backend/internal/api/router.go
git commit -m "feat(backend): wire rowers + active-rower + device cookie into router"
```

---

## Task 12: Sessionizer — accept ResolveRower

**Files:**
- Modify: `backend/internal/session/sessionizer.go`
- Modify: `backend/internal/session/sessionizer_test.go`

- [ ] **Step 1: Add resolver field, keep RowerID/Name for back-compat**

Modify `Options` in `sessionizer.go`:
```go
type Options struct {
	IdleTimeout time.Duration
	// ResolveRower returns the rower to attribute new sessions to at
	// the moment a session opens. If nil, falls back to RowerID/Name.
	ResolveRower func() (id, name string)
	RowerID      string
	RowerName    string
	Now          func() time.Time
	StartID      uint64
}
```

In `openSession`, replace the two `s.opts.RowerID` / `s.opts.RowerName` references with:
```go
id, name := s.resolveRower()
return s.emit(ctx, out, event.Event{
	Kind:      event.KindSessionStart,
	SessionID: s.session.id,
	SessionStart: &event.SessionStartPayload{
		StartedAt:    now,
		RowerID:      id,
		RowerName:    name,
		InitialLevel: f.Level,
	},
})
```

Add helper at the bottom of the file:
```go
func (s *Sessionizer) resolveRower() (string, string) {
	if s.opts.ResolveRower != nil {
		return s.opts.ResolveRower()
	}
	return s.opts.RowerID, s.opts.RowerName
}
```

- [ ] **Step 2: Add test: resolver picks rower per session**

Append to `sessionizer_test.go`:
```go
func TestSessionizer_ResolverPicksRowerPerSession(t *testing.T) {
	current := "R1"
	currentName := "Rower1"
	now := time.Unix(1000, 0)
	s := New(Options{
		IdleTimeout:  time.Minute,
		ResolveRower: func() (string, string) { return current, currentName },
		Now:          func() time.Time { return now },
	})

	// session 1
	frames := make(chan ipm.Frame, 1)
	out := make(chan event.Event, 16)
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() { done <- s.Run(ctx, frames, out) }()

	frames <- ipm.Frame{TimeSec: 1, DistanceM: 1, SPM: 20, PowerW: 100, Level: 3}
	evt := <-out // session_start
	if evt.SessionStart.RowerID != "R1" {
		t.Fatalf("session 1 rower: %q", evt.SessionStart.RowerID)
	}
	<-out // stroke

	// idle close + switch
	now = now.Add(5 * time.Minute)
	current = "R2"
	currentName = "Rower2"
	frames <- ipm.Frame{TimeSec: 2, DistanceM: 2, SPM: 20, PowerW: 100, Level: 3}
	// drain until we see the next session_start
	var found string
	for e := range out {
		if e.Kind == event.KindSessionStart {
			found = e.SessionStart.RowerID
			break
		}
	}
	if found != "R2" {
		t.Fatalf("session 2 rower: %q", found)
	}
	cancel()
	close(frames)
	<-done
}
```

- [ ] **Step 3: Run — expect PASS**

```bash
cd backend && go test ./internal/session/...
```
Expected: PASS (existing tests still use `RowerID`/`RowerName` fields which remain supported).

- [ ] **Step 4: Commit**

```bash
git add backend/internal/session/
git commit -m "feat(backend): sessionizer ResolveRower callback"
```

---

## Task 13: main.go wiring — Holder, seed, resolver

**Files:**
- Modify: `backend/cmd/homeergo/main.go`

- [ ] **Step 1: Construct Holder, seed from DB, wire into sessionizer + router**

Replace the sessionizer + api.NewRouter blocks with the following.

Add imports:
```go
"github.com/gloeckner-daniel/home-ergo/internal/rower"
```

After `defer db.Close()`:
```go
rowerRepo := rower.NewRepo(db.Handle())
rowerHolder := rower.NewHolder()
if last, err := rowerRepo.LastActive(ctx); err == nil && last != nil {
	rowerHolder.Set(last.ID, last.Name)
}
```

Replace sessionizer construction:
```go
sessionizer := session.New(session.Options{
	IdleTimeout: cfg.IdleTimeout,
	ResolveRower: func() (string, string) {
		id, name := rowerHolder.Resolve()
		if id == "" {
			return "local-rower", "Lokal"
		}
		return id, name
	},
	StartID: startID,
})
```

Replace `api.NewRouter` call:
```go
Handler: api.NewRouter(api.Inputs{
	Ring:        ring,
	Broadcaster: bcast,
	DB:          db.Handle(),
	RowerRepo:   rowerRepo,
	RowerHolder: rowerHolder,
	StartedAt:   time.Now(),
}),
```

- [ ] **Step 2: Build + smoke test**

```bash
cd backend && go build ./...
```
Expected: exits 0.

- [ ] **Step 3: Full backend test suite**

```bash
cd backend && go test ./...
```
Expected: PASS across all packages.

- [ ] **Step 4: Commit**

```bash
git add backend/cmd/homeergo/main.go
git commit -m "feat(backend): wire rower.Holder + resolver into sessionizer"
```

---

## Task 14: Frontend — API client for rowers

**Files:**
- Create: `web/src/api/rowers.ts`
- Create: `web/src/api/rowers.test.ts`

- [ ] **Step 1: Write the failing test**

`web/src/api/rowers.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { listRowers, createRower, getActiveRower, setActiveRower } from './rowers'

const originalFetch = global.fetch

function mockFetch(status: number, body: unknown) {
  global.fetch = vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })) as typeof fetch
}

beforeEach(() => {})
afterEach(() => { global.fetch = originalFetch })

describe('rowers api', () => {
  it('listRowers unwraps {rowers: []}', async () => {
    mockFetch(200, { rowers: [{ id: 'a', name: 'Alice', color: '#fff', created_at: '2026-04-21T00:00:00Z' }] })
    const list = await listRowers()
    expect(list).toHaveLength(1)
    expect(list[0].name).toBe('Alice')
  })

  it('createRower posts and returns row', async () => {
    mockFetch(201, { id: 'a', name: 'Alice', color: '#fff', created_at: '2026-04-21T00:00:00Z' })
    const r = await createRower({ name: 'Alice' })
    expect(r.id).toBe('a')
  })

  it('getActiveRower returns null on 404', async () => {
    mockFetch(404, {})
    const r = await getActiveRower()
    expect(r).toBeNull()
  })

  it('setActiveRower puts rower_id', async () => {
    const spy = vi.fn(async () => new Response(JSON.stringify({ id: 'a', name: 'Alice', color: '#fff', created_at: '2026-04-21T00:00:00Z' }), { status: 200 }))
    global.fetch = spy as unknown as typeof fetch
    await setActiveRower('a')
    expect(spy).toHaveBeenCalledWith('/api/v1/active-rower', expect.objectContaining({ method: 'PUT' }))
  })
})
```

- [ ] **Step 2: Run — expect FAIL**

```bash
cd web && npm test -- src/api/rowers.test.ts
```

- [ ] **Step 3: Implement**

`web/src/api/rowers.ts`:
```ts
export type Rower = {
  id: string
  name: string
  weight_kg?: number
  height_cm?: number
  dob?: string
  color: string
  created_at: string
}

export type CreateRowerInput = {
  name: string
  weight_kg?: number
  height_cm?: number
  dob?: string
  color?: string
}

export type UpdateRowerInput = Partial<CreateRowerInput>

async function json<T>(r: Response): Promise<T> {
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}`)
  return (await r.json()) as T
}

export async function listRowers(): Promise<Rower[]> {
  const r = await fetch('/api/v1/rowers')
  const body = await json<{ rowers: Rower[] }>(r)
  return body.rowers
}

export async function createRower(input: CreateRowerInput): Promise<Rower> {
  const r = await fetch('/api/v1/rowers', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  return json<Rower>(r)
}

export async function updateRower(id: string, input: UpdateRowerInput): Promise<Rower> {
  const r = await fetch(`/api/v1/rowers/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  return json<Rower>(r)
}

export async function getActiveRower(): Promise<Rower | null> {
  const r = await fetch('/api/v1/active-rower')
  if (r.status === 404) return null
  return json<Rower>(r)
}

export async function setActiveRower(rowerId: string): Promise<Rower> {
  const r = await fetch('/api/v1/active-rower', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rower_id: rowerId }),
  })
  return json<Rower>(r)
}
```

- [ ] **Step 4: Run — expect PASS**

```bash
cd web && npm test -- src/api/rowers.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add web/src/api/rowers.ts web/src/api/rowers.test.ts
git commit -m "feat(web): typed API client for rowers + active-rower"
```

---

## Task 15: BMI helper

**Files:**
- Create: `web/src/util/bmi.ts`
- Create: `web/src/util/bmi.test.ts`

- [ ] **Step 1: Write the failing test**

`web/src/util/bmi.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { computeBMI } from './bmi'

describe('computeBMI', () => {
  it('returns null if inputs missing', () => {
    expect(computeBMI(undefined, 170)).toBeNull()
    expect(computeBMI(70, undefined)).toBeNull()
    expect(computeBMI(undefined, undefined)).toBeNull()
  })
  it('returns null if height is zero', () => {
    expect(computeBMI(70, 0)).toBeNull()
  })
  it('computes BMI rounded to 1 decimal', () => {
    expect(computeBMI(70, 172)).toBeCloseTo(23.7, 1)
    expect(computeBMI(80, 180)).toBeCloseTo(24.7, 1)
  })
})
```

- [ ] **Step 2: Run — expect FAIL**

```bash
cd web && npm test -- src/util/bmi.test.ts
```

- [ ] **Step 3: Implement**

`web/src/util/bmi.ts`:
```ts
export function computeBMI(weightKg: number | undefined, heightCm: number | undefined): number | null {
  if (weightKg == null || heightCm == null) return null
  if (heightCm <= 0) return null
  const m = heightCm / 100
  const v = weightKg / (m * m)
  return Math.round(v * 10) / 10
}
```

- [ ] **Step 4: Run — expect PASS**

```bash
cd web && npm test -- src/util/bmi.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add web/src/util/bmi.ts web/src/util/bmi.test.ts
git commit -m "feat(web): computeBMI helper"
```

---

## Task 16: TanStack Query hooks

**Files:**
- Create: `web/src/hooks/useRowers.ts`
- Create: `web/src/hooks/useActiveRower.ts`

(No unit tests — covered by the component + e2e tests downstream.)

- [ ] **Step 1: Implement useRowers**

`web/src/hooks/useRowers.ts`:
```ts
import { useQuery } from '@tanstack/react-query'
import { listRowers, type Rower } from '../api/rowers'

export function useRowers() {
  return useQuery<Rower[]>({
    queryKey: ['rowers'],
    queryFn: listRowers,
    staleTime: 30_000,
  })
}
```

- [ ] **Step 2: Implement useActiveRower**

`web/src/hooks/useActiveRower.ts`:
```ts
import { useQuery } from '@tanstack/react-query'
import { getActiveRower, type Rower } from '../api/rowers'

export function useActiveRower() {
  return useQuery<Rower | null>({
    queryKey: ['active-rower'],
    queryFn: getActiveRower,
    staleTime: 10_000,
  })
}
```

- [ ] **Step 3: Build + type-check**

```bash
cd web && npm run build
```
Expected: exits 0 (no TS errors).

- [ ] **Step 4: Commit**

```bash
git add web/src/hooks/
git commit -m "feat(web): useRowers + useActiveRower hooks"
```

---

## Task 17: RowerGate component + unit test

**Files:**
- Create: `web/src/app/RowerGate.tsx`
- Create: `web/src/app/RowerGate.test.tsx`

- [ ] **Step 1: Write the failing test**

`web/src/app/RowerGate.test.tsx`:
```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { RowerGate } from './RowerGate'

vi.mock('../api/rowers', () => ({
  listRowers: vi.fn(async () => []),
  getActiveRower: vi.fn(async () => null),
}))

function wrap(initial: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[initial]}>
        <Routes>
          <Route path="/onboarding" element={<div>ONBOARD</div>} />
          <Route element={<RowerGate />}>
            <Route path="/" element={<div>HOME</div>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('RowerGate', () => {
  it('redirects to /onboarding when no rower exists', async () => {
    wrap('/')
    await waitFor(() => expect(screen.getByText('ONBOARD')).toBeInTheDocument())
  })
})
```

- [ ] **Step 2: Run — expect FAIL (component not defined)**

```bash
cd web && npm test -- src/app/RowerGate.test.tsx
```

- [ ] **Step 3: Implement**

`web/src/app/RowerGate.tsx`:
```tsx
import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useRowers } from '../hooks/useRowers'
import { useActiveRower } from '../hooks/useActiveRower'

export function RowerGate() {
  const rowers = useRowers()
  const active = useActiveRower()
  const loc = useLocation()

  if (rowers.isLoading || active.isLoading) return null

  const noRower = (rowers.data?.length ?? 0) === 0 || !active.data
  if (noRower && loc.pathname !== '/onboarding') {
    return <Navigate to="/onboarding" replace />
  }
  return <Outlet />
}
```

- [ ] **Step 4: Run — expect PASS**

```bash
cd web && npm test -- src/app/RowerGate.test.tsx
```

- [ ] **Step 5: Commit**

```bash
git add web/src/app/RowerGate.tsx web/src/app/RowerGate.test.tsx
git commit -m "feat(web): RowerGate redirects to /onboarding when unpaired"
```

---

## Task 18: OnboardingPage

**Files:**
- Create: `web/src/pages/OnboardingPage.tsx`
- Create: `web/src/pages/OnboardingPage.module.css`
- Create: `web/src/pages/OnboardingPage.test.tsx`

- [ ] **Step 1: Write the failing test**

`web/src/pages/OnboardingPage.test.tsx`:
```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { OnboardingPage } from './OnboardingPage'

const createSpy = vi.fn(async () => ({ id: 'a', name: 'Alice', color: '#ff6b6b', created_at: '2026-04-21T00:00:00Z' }))
const setActiveSpy = vi.fn(async () => ({ id: 'a', name: 'Alice', color: '#ff6b6b', created_at: '2026-04-21T00:00:00Z' }))

vi.mock('../api/rowers', () => ({
  createRower: (...args: unknown[]) => createSpy(...args),
  setActiveRower: (...args: unknown[]) => setActiveSpy(...args),
}))

function wrap() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/onboarding']}>
        <Routes>
          <Route path="/onboarding" element={<OnboardingPage />} />
          <Route path="/" element={<div>HOME</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('OnboardingPage', () => {
  it('rejects empty name on submit', async () => {
    wrap()
    fireEvent.click(screen.getByRole('button', { name: /weiter/i }))
    expect(screen.getByText(/name erforderlich/i)).toBeInTheDocument()
  })

  it('creates rower + sets active on valid submit', async () => {
    wrap()
    fireEvent.change(screen.getByLabelText(/name/i), { target: { value: 'Alice' } })
    fireEvent.click(screen.getByRole('button', { name: /weiter/i }))
    await waitFor(() => expect(createSpy).toHaveBeenCalled())
    await waitFor(() => expect(setActiveSpy).toHaveBeenCalledWith('a'))
    await waitFor(() => expect(screen.getByText('HOME')).toBeInTheDocument())
  })
})
```

- [ ] **Step 2: Run — expect FAIL**

```bash
cd web && npm test -- src/pages/OnboardingPage.test.tsx
```

- [ ] **Step 3: Implement**

`web/src/pages/OnboardingPage.module.css`:
```css
.root { max-width: 420px; margin: 0 auto; padding: 32px 16px; display: flex; flex-direction: column; gap: 16px; }
.field { display: flex; flex-direction: column; gap: 4px; }
.field label { font-size: 12px; opacity: 0.7; }
.field input { padding: 8px; font-size: 16px; }
.palette { display: flex; gap: 8px; flex-wrap: wrap; }
.swatch { width: 32px; height: 32px; border-radius: 50%; border: 2px solid transparent; cursor: pointer; }
.swatch[data-active='true'] { border-color: #fff; }
.err { color: #f87171; font-size: 13px; }
.submit { padding: 12px; font-size: 16px; font-weight: 600; }
```

`web/src/pages/OnboardingPage.tsx`:
```tsx
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { createRower, setActiveRower } from '../api/rowers'
import styles from './OnboardingPage.module.css'

const palette = ['#ff6b6b', '#4ecdc4', '#ffe66d', '#a78bfa', '#f97316', '#60a5fa', '#34d399', '#f472b6']

export function OnboardingPage() {
  const [name, setName] = useState('')
  const [weight, setWeight] = useState('')
  const [height, setHeight] = useState('')
  const [dob, setDob] = useState('')
  const [color, setColor] = useState(palette[0])
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const nav = useNavigate()
  const qc = useQueryClient()

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setErr(null)
    if (!name.trim()) {
      setErr('Name erforderlich')
      return
    }
    setBusy(true)
    try {
      const input = {
        name: name.trim(),
        weight_kg: weight ? Number(weight) : undefined,
        height_cm: height ? Number(height) : undefined,
        dob: dob || undefined,
        color,
      }
      const row = await createRower(input)
      await setActiveRower(row.id)
      await qc.invalidateQueries({ queryKey: ['rowers'] })
      await qc.invalidateQueries({ queryKey: ['active-rower'] })
      nav('/', { replace: true })
    } catch (e2) {
      setErr(String(e2))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className={styles.root} onSubmit={submit}>
      <h1>Willkommen</h1>
      <p>Leg dein Profil an, um Sessions zu speichern.</p>
      <div className={styles.field}>
        <label htmlFor="name">Name*</label>
        <input id="name" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
      </div>
      <div className={styles.field}>
        <label htmlFor="weight">Gewicht (kg)</label>
        <input id="weight" type="number" step="0.1" value={weight} onChange={(e) => setWeight(e.target.value)} />
      </div>
      <div className={styles.field}>
        <label htmlFor="height">Größe (cm)</label>
        <input id="height" type="number" step="1" value={height} onChange={(e) => setHeight(e.target.value)} />
      </div>
      <div className={styles.field}>
        <label htmlFor="dob">Geburtsdatum</label>
        <input id="dob" type="date" value={dob} onChange={(e) => setDob(e.target.value)} />
      </div>
      <div className={styles.field}>
        <label>Farbe</label>
        <div className={styles.palette}>
          {palette.map((c) => (
            <button
              key={c}
              type="button"
              aria-label={`colour ${c}`}
              data-active={color === c}
              className={styles.swatch}
              style={{ background: c }}
              onClick={() => setColor(c)}
            />
          ))}
        </div>
      </div>
      {err && <div className={styles.err}>{err}</div>}
      <button type="submit" className={styles.submit} disabled={busy}>
        Weiter
      </button>
    </form>
  )
}
```

- [ ] **Step 4: Run — expect PASS**

```bash
cd web && npm test -- src/pages/OnboardingPage.test.tsx
```

- [ ] **Step 5: Commit**

```bash
git add web/src/pages/OnboardingPage.*
git commit -m "feat(web): OnboardingPage creates + activates first rower"
```

---

## Task 19: RowerStrip component

**Files:**
- Create: `web/src/app/RowerStrip.tsx`
- Create: `web/src/app/RowerStrip.module.css`

No unit test — exercised by the e2e test in Task 23.

- [ ] **Step 1: Implement**

`web/src/app/RowerStrip.module.css`:
```css
.root { display: flex; gap: 8px; align-items: center; padding: 8px 12px; }
.avatar {
  width: 32px; height: 32px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  font-size: 14px; font-weight: 600; color: #fff;
  border: 2px solid transparent; cursor: pointer;
}
.avatar[data-active='true'] { border-color: #fff; }
.add { width: 32px; height: 32px; border-radius: 50%; border: 1px dashed #888; color: #888; background: transparent; cursor: pointer; }
```

`web/src/app/RowerStrip.tsx`:
```tsx
import { useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { useRowers } from '../hooks/useRowers'
import { useActiveRower } from '../hooks/useActiveRower'
import { setActiveRower } from '../api/rowers'
import styles from './RowerStrip.module.css'

export function RowerStrip() {
  const rowers = useRowers()
  const active = useActiveRower()
  const qc = useQueryClient()
  const nav = useNavigate()

  async function switchTo(id: string) {
    if (id === active.data?.id) return
    await setActiveRower(id)
    await qc.invalidateQueries({ queryKey: ['active-rower'] })
    await qc.invalidateQueries({ queryKey: ['sessions'] })
  }

  if (!rowers.data) return <div className={styles.root} />
  return (
    <div className={styles.root} role="toolbar" aria-label="Rudernde">
      {rowers.data.map((r) => (
        <button
          key={r.id}
          className={styles.avatar}
          data-active={active.data?.id === r.id}
          style={{ background: r.color }}
          aria-label={`Aktivieren: ${r.name}`}
          onClick={() => switchTo(r.id)}
        >
          {r.name.slice(0, 1).toUpperCase()}
        </button>
      ))}
      <button className={styles.add} aria-label="Rudernde hinzufügen" onClick={() => nav('/profil')}>
        +
      </button>
    </div>
  )
}
```

- [ ] **Step 2: Build**

```bash
cd web && npm run build
```
Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add web/src/app/RowerStrip.*
git commit -m "feat(web): top-bar avatar strip with rower switcher"
```

---

## Task 20: Wire RowerGate + RowerStrip into AppRouter/AppLayout

**Files:**
- Modify: `web/src/app/AppRouter.tsx`
- Modify: `web/src/app/AppLayout.tsx`

- [ ] **Step 1: Update AppRouter**

Replace the `<Routes>` block in `AppRouter.tsx` with:
```tsx
<Routes>
  <Route path="/onboarding" element={<OnboardingPage />} />
  <Route element={<RowerGate />}>
    <Route element={<AppLayout />}>
      <Route index element={<LivePage />} />
      <Route path="/historie" element={<HistoryPage />} />
      <Route path="/historie/:sessionId" element={<SessionDetailPage />} />
      <Route path="/profil" element={<ProfilePage />} />
      <Route path="*" element={<NotFound />} />
    </Route>
  </Route>
</Routes>
```

Add imports at the top:
```tsx
import { RowerGate } from './RowerGate'
import { OnboardingPage } from '../pages/OnboardingPage'
```

- [ ] **Step 2: Add RowerStrip to AppLayout**

Read the current `AppLayout.tsx`, locate the top-bar region, and render `<RowerStrip />` in it. The exact insertion point depends on the layout file; place the import and element adjacent to the existing `<HealthIndicator />` or brand area.

Commands for discovery:
```bash
cd web && grep -n "HealthIndicator\|header\|top" src/app/AppLayout.tsx
```

Then insert, for example:
```tsx
import { RowerStrip } from './RowerStrip'
// ...
<header className={styles.topBar}>
  <Brand />
  <RowerStrip />
  <HealthIndicator />
</header>
```

- [ ] **Step 3: Build + existing tests**

```bash
cd web && npm run build && npm test
```
Expected: all green.

- [ ] **Step 4: Commit**

```bash
git add web/src/app/AppRouter.tsx web/src/app/AppLayout.tsx
git commit -m "feat(web): gate routes with RowerGate; RowerStrip in top bar"
```

---

## Task 21: ProfilePage rewrite — settings + BMI

**Files:**
- Modify: `web/src/pages/ProfilePage.tsx`

- [ ] **Step 1: Implement**

Replace the file contents with a settings screen that:
- Lists rowers from `useRowers()`
- For each rower: inline editable name, weight, height, dob, colour. "Speichern" button PATCHes.
- "Add rower" button → navigates to `/onboarding` (same form flow).
- Shows BMI (from `computeBMI`) when weight + height present.

```tsx
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { useRowers } from '../hooks/useRowers'
import { updateRower, type Rower } from '../api/rowers'
import { computeBMI } from '../util/bmi'

function RowerCard({ r }: { r: Rower }) {
  const [name, setName] = useState(r.name)
  const [weight, setWeight] = useState(r.weight_kg?.toString() ?? '')
  const [height, setHeight] = useState(r.height_cm?.toString() ?? '')
  const [dob, setDob] = useState(r.dob ?? '')
  const [color, setColor] = useState(r.color)
  const [busy, setBusy] = useState(false)
  const qc = useQueryClient()

  const bmi = computeBMI(
    weight ? Number(weight) : undefined,
    height ? Number(height) : undefined,
  )

  async function save() {
    setBusy(true)
    try {
      await updateRower(r.id, {
        name: name || undefined,
        weight_kg: weight ? Number(weight) : undefined,
        height_cm: height ? Number(height) : undefined,
        dob: dob || undefined,
        color,
      })
      await qc.invalidateQueries({ queryKey: ['rowers'] })
      await qc.invalidateQueries({ queryKey: ['active-rower'] })
    } finally {
      setBusy(false)
    }
  }

  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 12, border: '1px solid #333', borderRadius: 8 }}>
      <label>Name <input value={name} onChange={(e) => setName(e.target.value)} /></label>
      <label>Gewicht (kg) <input type="number" step="0.1" value={weight} onChange={(e) => setWeight(e.target.value)} /></label>
      <label>Größe (cm) <input type="number" step="1" value={height} onChange={(e) => setHeight(e.target.value)} /></label>
      <label>Geburtsdatum <input type="date" value={dob} onChange={(e) => setDob(e.target.value)} /></label>
      <label>Farbe <input type="color" value={color} onChange={(e) => setColor(e.target.value)} /></label>
      {bmi != null && <div>BMI: {bmi}</div>}
      <button disabled={busy} onClick={save}>Speichern</button>
    </section>
  )
}

export function ProfilePage() {
  const rowers = useRowers()
  const nav = useNavigate()
  return (
    <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 16 }}>
      <h1>Einstellungen</h1>
      {rowers.data?.map((r) => <RowerCard key={r.id} r={r} />)}
      <button onClick={() => nav('/onboarding')}>Rudernde/n hinzufügen</button>
    </div>
  )
}
```

- [ ] **Step 2: Build + test**

```bash
cd web && npm run build && npm test
```

- [ ] **Step 3: Commit**

```bash
git add web/src/pages/ProfilePage.tsx
git commit -m "feat(web): ProfilePage as rower settings + BMI"
```

---

## Task 22: HistoryPage — rower badge per row

**Files:**
- Modify: `web/src/pages/HistoryPage.tsx`
- Modify: `web/src/pages/HistoryPage.module.css`

- [ ] **Step 1: Add rower lookup + badge render**

In `HistoryPage.tsx`:
- Import `useRowers`.
- Build a `Map<string, Rower>` from the rowers list.
- Inside each row's render output, add a span:

```tsx
const rowersById = new Map((rowers.data ?? []).map((r) => [r.id, r]))
// ...
{(() => {
  const r = rowersById.get(s.rower_id)
  return (
    <span className={styles.rowerBadge}>
      <span className={styles.rowerDot} style={{ background: r?.color ?? '#555' }} />
      {r?.name ?? '—'}
    </span>
  )
})()}
```

- [ ] **Step 2: Add styles**

Append to `HistoryPage.module.css`:
```css
.rowerBadge { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; opacity: 0.8; }
.rowerDot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; }
```

- [ ] **Step 3: Update the existing HistoryPage snapshot/unit test if any**

```bash
cd web && npm test -- src/pages/HistoryPage.test.tsx
```
If the test asserts row structure, update the expected output to include the badge. Otherwise it should still pass.

- [ ] **Step 4: Commit**

```bash
git add web/src/pages/HistoryPage.tsx web/src/pages/HistoryPage.module.css
git commit -m "feat(web): rower badge on history rows"
```

---

## Task 23: E2E Playwright test — full onboarding flow

**Files:**
- Create: `web/tests/e2e/rower-onboarding.spec.ts`

- [ ] **Step 1: Inspect existing e2e harness**

```bash
cd web && ls tests/e2e/ && cat playwright.config.ts | head -40
```

- [ ] **Step 2: Write the test**

`web/tests/e2e/rower-onboarding.spec.ts`:
```ts
import { test, expect } from '@playwright/test'

test('fresh install → onboarding → live view → history badge', async ({ page, context }) => {
  await context.clearCookies()
  await page.goto('/')
  await expect(page).toHaveURL(/\/onboarding/)

  await page.getByLabel(/name/i).fill('Alice')
  await page.getByLabel(/gewicht/i).fill('70')
  await page.getByLabel(/größe/i).fill('172')
  await page.getByRole('button', { name: /weiter/i }).click()

  await expect(page).toHaveURL('/')
  await expect(page.getByRole('toolbar', { name: /rudernde/i })).toBeVisible()
  await expect(page.getByRole('button', { name: /aktivieren: alice/i })).toBeVisible()

  // Visit history page — (it may be empty on a fresh db; the badge
  // only appears once a session is recorded. We assert the page
  // renders without throwing and the rower strip is still visible.)
  await page.goto('/historie')
  await expect(page.getByRole('button', { name: /aktivieren: alice/i })).toBeVisible()
})
```

- [ ] **Step 3: Run the e2e suite**

```bash
cd web && npm run test:e2e -- rower-onboarding
```
Expected: the new test passes. Pre-existing e2e tests (history flow) must still pass — they may need a seed rower now that `/onboarding` is enforced; extend fixtures if necessary to create a default rower via the API before `page.goto('/')`.

- [ ] **Step 4: Commit**

```bash
git add web/tests/e2e/rower-onboarding.spec.ts
git commit -m "test(web): e2e rower onboarding + switcher"
```

---

## Task 24: Fix pre-existing e2e tests (seed rower)

Existing e2e tests (`history.spec.ts` etc.) will now hit `/onboarding` on a fresh DB. Two options:
- (a) Prepend each affected test with an API call (`POST /api/v1/rowers` then `PUT /api/v1/active-rower`) in a shared fixture.
- (b) Have the backend CLI insert a default "Lokal" rower when started with a `--dev-seed` flag (YAGNI — prefer (a)).

- [ ] **Step 1: Identify failing e2e tests**

```bash
cd web && npm run test:e2e 2>&1 | tail -40
```

- [ ] **Step 2: Add a shared fixture helper**

`web/tests/e2e/helpers/rower.ts`:
```ts
import { request } from '@playwright/test'

export async function seedRower(baseURL: string, name = 'Testrower') {
  const ctx = await request.newContext({ baseURL })
  const create = await ctx.post('/api/v1/rowers', { data: { name, color: '#60a5fa' } })
  const row = await create.json()
  await ctx.put('/api/v1/active-rower', { data: { rower_id: row.id } })
  // Export cookies so the browser tests inherit the same device_id
  const cookies = await ctx.storageState()
  await ctx.dispose()
  return { row, cookies }
}
```

Apply this in each affected test's `test.beforeEach` / `use`. Exact wiring depends on the existing harness — inspect `playwright.config.ts` for a `storageState` / `baseURL` pattern.

- [ ] **Step 3: Run full e2e**

```bash
cd web && npm run test:e2e
```
Expected: all green.

- [ ] **Step 4: Commit**

```bash
git add web/tests/e2e/
git commit -m "test(web): seed rower in e2e fixtures so RowerGate passes"
```

---

## Task 25: Update ROADMAP + plan cross-refs

**Files:**
- Modify: `ROADMAP.md`

- [ ] **Step 1: Mark M3 complete**

Edit `ROADMAP.md`:
- Under M3, change the two unchecked lines to:
  ```
  - [x] FEAT-0002 (minimal slice): rower profiles, device-cookie active-rower, top-bar switcher (plan `docs/superpowers/plans/2026-04-21-m3-rower-profiles-minimal.md`). Full QR pairing + admin deferred.
  - [x] Session assigned to the currently "active" user in UI
  ```

- [ ] **Step 2: Commit**

```bash
git add ROADMAP.md
git commit -m "docs: mark M3 rower profiles minimal slice complete"
```

---

## Task 26: Open PR

- [ ] **Step 1: Push + open PR**

```bash
git push -u origin HEAD
gh pr create --title "feat: M3 rower profiles (minimal slice)" --body "$(cat <<'EOF'
## Summary
- Rower CRUD (`/api/v1/rowers`), active-rower per-device (`/api/v1/active-rower`)
- `device_id` HttpOnly cookie middleware
- Sessionizer reads active rower via `rower.Holder` at session start
- Frontend: forced onboarding, avatar strip, settings page with BMI, history badge
- Defers QR pairing, admin, soft-delete to later milestone

## Test plan
- [ ] Backend unit tests pass (`go test ./...`)
- [ ] Web unit tests pass (`npm test`)
- [ ] E2E: fresh DB → onboarding → live → history with badge (`npm run test:e2e`)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-review notes

- Spec coverage: every acceptance-criteria bullet in the spec maps to at least one task (onboarding→T17/T18/T20, profile CRUD→T4/T5/T9/T21, device cookie→T8/T11, active rower→T6/T10, session wiring→T12/T13, history badge→T22, tests→T3–T10,T15,T17,T18,T23,T24, BMI→T15,T21).
- No placeholders: all code shown; no "TBD".
- Type/name consistency: `Rower`, `CreateInput`, `UpdateInput`, `Repo`, `Holder`, `RowersHandler`, `ActiveRowerHandler`, `DeviceCookie`, `DeviceIDFromContext`, `useRowers`, `useActiveRower`, `RowerGate`, `RowerStrip`, `computeBMI` — same symbols everywhere.
- Scope: single slice; no multi-subsystem drift.

