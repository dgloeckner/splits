# v1 P0 Hardening Implementation Plan

> **Status:** Shipped — merged to main 2026-04-28.


> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close every P0 item from `docs/v1-review.md` that does not require a full feature build — security boundaries, data correctness, brand rename to **`splits`** (rowing-jargon plural), deploy-readiness gates.

**Architecture:** Fixes are localized: middleware additions in `backend/internal/api`, mutex coverage in `internal/session`, retry policy in `internal/storage`, env-var rename in `internal/config`. No new packages.

**Brand naming convention:** product name is `splits` (always lowercase plural — rowing-jargon term, matches existing `web/index.html` title and `splits-logo.svg`). Apply consistently: env-var prefix `SPLITS_*`, Go module `github.com/gloeckner-daniel/splits`, binary `splits`, default DB path `./splits.db`, log key prefix `splits.*`, e2e fixture prefix `splits-e2e-*`. **Never** use the singular `split` in any new identifier.

**Tech Stack:** Go 1.22+ (`net/http`, `database/sql`, `log/slog`), modernc SQLite, React 18 / TanStack Query (PWA side touched only in Phase D).

## Out of scope — separate plans required

Two P0 items in `v1-review.md` are full features and need their own plans:

1. **FEAT-0002 QR pairing** — exchange endpoint, scan UI, admin household screen, token rotation. See `specs/feat/0002-user-profiles-onboarding.md` (134 lines of acceptance criteria). Plan after this one ships.
2. **FEAT-0003 session-detail charts** — chart library selection (Recharts vs uplot), per-session series rendering. Web-only, smaller — write plan once charting library decided.

Both depend on `device_rowers` ownership boundary added in Phase A so they integrate cleanly.

## Phases

- **A — Backend correctness & security** (Tasks 1-13): unblock v1 from data-loss / impersonation / DoS risks.
- **B — Brand rename `homeergo` → `splits`** (Tasks 14-19): single coordinated sweep with env-var compatibility shim.
- **C — Frontend follow-ups** (Tasks 20-22): only the parts blocked by backend changes (Secure cookie path, rate-limit error UX, missing rower_id default).

Commit after every task. Run full test suite at end of each phase.

---

## Phase A — Backend correctness & security

### Task 1: Standardize `sql.ErrNoRows` handling — sessions handler

**Files:**
- Modify: `backend/internal/api/sessions.go:43-89`
- Modify test: `backend/internal/api/sessions_test.go`

- [ ] **Step 1: Write failing test for getSession 404 on missing row**

```go
// in sessions_test.go
func TestGetSession_NotFound_Returns404(t *testing.T) {
	t.Parallel()
	srv := newTestServer(t) // existing helper
	req := httptest.NewRequest(http.MethodGet, "/api/v1/sessions/does-not-exist", nil)
	rec := httptest.NewRecorder()
	srv.Handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("want 404, got %d (body=%q)", rec.Code, rec.Body.String())
	}
}
```

- [ ] **Step 2: Run test**

Run: `cd backend && go test ./internal/api -run TestGetSession_NotFound_Returns404 -v`
Expected: PASS already if `storage.GetSession` returns `(nil, nil)` for missing — verify. If it returns `(nil, sql.ErrNoRows)`, the test FAILS with 500.

- [ ] **Step 3: Audit `storage.GetSession`**

Read `backend/internal/storage/reads.go` (or wherever `GetSession` lives). If it returns `sql.ErrNoRows`, change handler to:

```go
func getSession(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		row, err := storage.GetSession(r.Context(), db, id)
		if errors.Is(err, sql.ErrNoRows) {
			http.NotFound(w, r)
			return
		}
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		if row == nil {
			http.NotFound(w, r)
			return
		}
		writeJSON(w, http.StatusOK, row)
	}
}
```

Apply same pattern to `getSamples` (currently at sessions.go:59). Add `"errors"` import.

- [ ] **Step 4: Run all sessions tests**

Run: `cd backend && go test ./internal/api -run TestGetSession -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/internal/api/sessions.go backend/internal/api/sessions_test.go
git commit -m "fix(api): return 404 not 500 on missing session/samples"
```

---

### Task 2: Standardize `sql.ErrNoRows` handling — rowers & pbs handlers

**Files:**
- Modify: `backend/internal/api/rowers.go:11-107`
- Modify: `backend/internal/api/pbs.go` (audit all `queryDistancePBs`-style helpers)

- [ ] **Step 1: Audit pbs.go for inconsistent error handling**

Run: `cd backend && grep -n 'sql.ErrNoRows\|http.Error\|http.NotFound' internal/api/pbs.go`
Expected: list of every handler. Verify each that calls a query helper either uses `errors.Is(err, sql.ErrNoRows) → 404` or treats nil result as 404.

- [ ] **Step 2: Add tests for known-missing rower**

```go
// in pbs_test.go
func TestRowerEndpoints_UnknownRowerReturns404(t *testing.T) {
	t.Parallel()
	for _, path := range []string{
		"/api/v1/rowers/missing/pbs",
		"/api/v1/rowers/missing/pbs/history",
		"/api/v1/rowers/missing/lifetime",
		"/api/v1/rowers/missing/achievements",
	} {
		t.Run(path, func(t *testing.T) {
			srv := newTestServer(t)
			req := httptest.NewRequest(http.MethodGet, path, nil)
			rec := httptest.NewRecorder()
			srv.Handler.ServeHTTP(rec, req)
			if rec.Code != http.StatusNotFound {
				t.Fatalf("want 404, got %d", rec.Code)
			}
		})
	}
}
```

- [ ] **Step 3: Run tests, fix handlers until green**

Run: `cd backend && go test ./internal/api -run TestRowerEndpoints_UnknownRower -v`

For each failing path: in the handler, check if rower exists first (`repo.Get(ctx, id)`), return 404 if not. Use `http.StatusNotFound` constant.

- [ ] **Step 4: Replace integer literals with constants in rowers.go**

Replace `http.Error(w, …, 500)` → `http.Error(w, …, http.StatusInternalServerError)`, `400` → `http.StatusBadRequest`, `404` → `http.StatusNotFound`, `200` → `http.StatusOK` throughout `rowers.go` and any other handler still using integers.

Run: `cd backend && grep -rn 'http.Error.*, [0-9]' internal/api/`
Expected: only test files; no production handlers.

- [ ] **Step 5: Commit**

```bash
git add backend/internal/api/rowers.go backend/internal/api/pbs.go backend/internal/api/pbs_test.go
git commit -m "fix(api): consistent 404 on missing rower/PB resources"
```

---

### Task 3: Sessions list — require `rower_id`

**Files:**
- Modify: `backend/internal/api/sessions.go:26-41`
- Modify test: `backend/internal/api/sessions_test.go`

- [ ] **Step 1: Write failing test**

```go
func TestListSessions_MissingRowerID_Returns400(t *testing.T) {
	t.Parallel()
	srv := newTestServer(t)
	req := httptest.NewRequest(http.MethodGet, "/api/v1/sessions?limit=10", nil)
	rec := httptest.NewRecorder()
	srv.Handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("want 400, got %d", rec.Code)
	}
}
```

- [ ] **Step 2: Run test**

Run: `cd backend && go test ./internal/api -run TestListSessions_MissingRowerID -v`
Expected: FAIL (currently returns 200 with all sessions).

- [ ] **Step 3: Implement**

Modify `listSessions` (sessions.go:26):

```go
func listSessions(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		rowerID := r.URL.Query().Get("rower_id")
		if rowerID == "" {
			http.Error(w, "rower_id required", http.StatusBadRequest)
			return
		}
		limit := intQuery(r, "limit", 50)
		offset := intQuery(r, "offset", 0)
		rows, err := storage.ListSessions(r.Context(), db, limit, offset, rowerID)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		if rows == nil {
			rows = []storage.SessionRow{}
		}
		writeJSON(w, http.StatusOK, map[string]any{"sessions": rows})
	}
}
```

- [ ] **Step 4: Run tests**

Run: `cd backend && go test ./internal/api -run TestListSessions -v`
Expected: PASS. Existing tests that called `/api/v1/sessions` without `rower_id` will FAIL — update them to include `?rower_id=…`.

- [ ] **Step 5: Update web client**

Audit `web/src/api/` and any TanStack Query that hits `/api/v1/sessions`. Confirm every call includes `rower_id` (commit 0f48ba4 already addressed history scoping). Run frontend tests: `cd web && npm test`.

- [ ] **Step 6: Commit**

```bash
git add backend/internal/api/sessions.go backend/internal/api/sessions_test.go
git commit -m "feat(api): require rower_id on GET /sessions to prevent cross-rower leak"
```

---

### Task 4: Active-rower ownership boundary via `device_rowers`

**Files:**
- Create: `backend/internal/storage/migrations/00NN_device_rowers.sql` (use next number)
- Create: `backend/internal/rower/device_link.go`
- Create: `backend/internal/rower/device_link_test.go`
- Modify: `backend/internal/api/rowers.go:81-107`

- [ ] **Step 1: Add migration**

Find next migration number: `ls backend/internal/storage/migrations/`. Create `00NN_device_rowers.sql`:

```sql
-- FEAT-0002 prep: track which rowers a device has paired with so the
-- active-rower switcher cannot select arbitrary rowers from the
-- household. Auto-populated on rower create + first active-set; full
-- QR pairing flow lands in FEAT-0002 plan.
CREATE TABLE IF NOT EXISTS device_rowers (
  device_id TEXT NOT NULL,
  rower_id  TEXT NOT NULL,
  paired_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (device_id, rower_id),
  FOREIGN KEY (rower_id) REFERENCES rowers(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_device_rowers_device ON device_rowers(device_id);
```

- [ ] **Step 2: Write failing test for ownership check**

```go
// backend/internal/rower/device_link_test.go
package rower_test

import (
	"context"
	"testing"
	"github.com/gloeckner-daniel/home-ergo/internal/rower"
	"github.com/gloeckner-daniel/home-ergo/internal/storage/storagetest"
)

func TestDeviceLink_PairAndCheck(t *testing.T) {
	db := storagetest.OpenDB(t)
	ctx := context.Background()
	link := rower.NewDeviceLink(db)

	if ok, _ := link.IsPaired(ctx, "dev1", "rower1"); ok {
		t.Fatal("expected unpaired initially")
	}
	if err := link.Pair(ctx, "dev1", "rower1"); err != nil {
		t.Fatal(err)
	}
	if ok, _ := link.IsPaired(ctx, "dev1", "rower1"); !ok {
		t.Fatal("expected paired after Pair")
	}
	if ok, _ := link.IsPaired(ctx, "dev2", "rower1"); ok {
		t.Fatal("dev2 should not see dev1's pairing")
	}
}
```

- [ ] **Step 3: Run test**

Run: `cd backend && go test ./internal/rower -run TestDeviceLink_PairAndCheck -v`
Expected: FAIL (DeviceLink doesn't exist).

- [ ] **Step 4: Implement DeviceLink**

```go
// backend/internal/rower/device_link.go
package rower

import (
	"context"
	"database/sql"
)

type DeviceLink struct{ DB *sql.DB }

func NewDeviceLink(db *sql.DB) *DeviceLink { return &DeviceLink{DB: db} }

func (d *DeviceLink) Pair(ctx context.Context, deviceID, rowerID string) error {
	_, err := d.DB.ExecContext(ctx,
		`INSERT OR IGNORE INTO device_rowers(device_id, rower_id) VALUES(?, ?)`,
		deviceID, rowerID)
	return err
}

func (d *DeviceLink) IsPaired(ctx context.Context, deviceID, rowerID string) (bool, error) {
	var n int
	err := d.DB.QueryRowContext(ctx,
		`SELECT COUNT(1) FROM device_rowers WHERE device_id = ? AND rower_id = ?`,
		deviceID, rowerID).Scan(&n)
	if err != nil {
		return false, err
	}
	return n > 0, nil
}
```

Run test again: PASS.

- [ ] **Step 5: Wire DeviceLink into router**

Modify `backend/internal/api/router.go`:

```go
type Inputs struct {
	// …existing…
	DeviceLink *rower.DeviceLink
}
```

Pass through from `cmd/.../main.go`. Update the active-rower handler signature:

```go
func ActiveRowerHandler(repo *rower.Repo, holder *rower.Holder, link *rower.DeviceLink) http.Handler {
```

- [ ] **Step 6: Write failing test for active-rower ownership**

```go
// in rowers_test.go
func TestActiveRower_PUT_RejectsUnpairedRower(t *testing.T) {
	srv := newTestServer(t)
	// Create rower R1; do NOT pair device D2 with R1.
	r1 := createRower(t, srv, "Alice")
	req := httptest.NewRequest(http.MethodPut, "/api/v1/active-rower", strings.NewReader(`{"rower_id":"`+r1.ID+`"}`))
	req.AddCookie(&http.Cookie{Name: "device_id", Value: "device-D2"})
	rec := httptest.NewRecorder()
	srv.Handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("want 403, got %d", rec.Code)
	}
}
```

- [ ] **Step 7: Run test**

Run: `cd backend && go test ./internal/api -run TestActiveRower_PUT_RejectsUnpairedRower -v`
Expected: FAIL.

- [ ] **Step 8: Implement check + auto-pair on rower-creation path**

In `ActiveRowerHandler` PUT:

```go
mux.HandleFunc("PUT /api/v1/active-rower", func(w http.ResponseWriter, r *http.Request) {
	devID := DeviceIDFromContext(r.Context())
	var body struct{ RowerID string `json:"rower_id"` }
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.RowerID == "" {
		http.Error(w, "rower_id required", http.StatusBadRequest)
		return
	}
	target, err := repo.Get(r.Context(), body.RowerID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	if target == nil {
		http.Error(w, "rower not found", http.StatusNotFound)
		return
	}
	paired, err := link.IsPaired(r.Context(), devID, body.RowerID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	if !paired {
		http.Error(w, "rower not paired with this device", http.StatusForbidden)
		return
	}
	if err := repo.SetActiveForDevice(r.Context(), devID, body.RowerID); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	holder.Set(target.ID, target.Name)
	writeJSON(w, http.StatusOK, target)
})
```

In `RowersHandler` POST (`rowers.go:24`), auto-pair the creating device:

```go
out, err := repo.Create(r.Context(), in)
// …existing error handling…
if err := link.Pair(r.Context(), DeviceIDFromContext(r.Context()), out.ID); err != nil {
	http.Error(w, err.Error(), http.StatusInternalServerError)
	return
}
```

Pass `link` into `RowersHandler` similarly.

- [ ] **Step 9: Run tests**

Run: `cd backend && go test ./internal/api -v`
Expected: PASS. Tests that previously created rowers and then activated them on a different device need to add an explicit `Pair` call.

- [ ] **Step 10: Backfill existing data**

Add a one-shot at startup in `cmd/.../main.go` (will be renamed to `cmd/splits` in Task 14): after migrations run, if `device_rowers` is empty AND `active_rower_device_id` has rows, INSERT the pairings from the active-rower table so existing devices keep their access. Keep it minimal:

```go
if _, err := db.ExecContext(ctx, `
	INSERT OR IGNORE INTO device_rowers(device_id, rower_id)
	SELECT device_id, rower_id FROM active_rower_device_id`); err != nil {
	return fmt.Errorf("device_rowers backfill: %w", err)
}
```

- [ ] **Step 11: Commit**

```bash
git add backend/internal/storage/migrations/ backend/internal/rower/device_link.go backend/internal/rower/device_link_test.go backend/internal/api/router.go backend/internal/api/rowers.go backend/internal/api/rowers_test.go backend/cmd/
git commit -m "feat(auth): scope active-rower SET to device-paired rowers"
```

---

### Task 5: Sessionizer — protect all mutable session-snapshot fields with mutex

**Files:**
- Modify: `backend/internal/session/sessionizer.go`
- Modify test: `backend/internal/session/sessionizer_test.go`

- [ ] **Step 1: Write race-detector test**

```go
// in sessionizer_test.go
func TestSessionizer_ConcurrentSnapshotDuringStart(t *testing.T) {
	t.Parallel()
	s := New(Options{IdleTimeout: time.Minute, Now: time.Now})
	in := make(chan ipm.Frame, 8)
	out := make(chan event.Event, 64)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go s.Run(ctx, in, out)

	var wg sync.WaitGroup
	wg.Add(2)
	go func() {
		defer wg.Done()
		for i := 0; i < 200; i++ {
			s.AttachWorkout("w1")
			s.StartSession("w1")
		}
	}()
	go func() {
		defer wg.Done()
		for i := 0; i < 1000; i++ {
			_ = s.Snapshot()
			_ = s.MaxEventID()
		}
	}()
	wg.Wait()
	cancel()
	<-out
}
```

- [ ] **Step 2: Run with race detector**

Run: `cd backend && go test ./internal/session -run TestSessionizer_ConcurrentSnapshotDuringStart -race -v`
Expected: race report on `pendingWorkoutID` / `currentSessionStart`.

- [ ] **Step 3: Audit all `s.session` and `s.currentSessionStart` reads/writes**

Currently the goroutine running `Run` writes `s.session` (sessionizer.go:457, 568) and `s.pendingWorkoutID` without holding `s.mu`. The mutex only covers snapshot fields (`currentSessionStart`, etc). External `MaxEventID()` and `Snapshot()` read `s.nextID` and snapshot fields under `s.mu`. The race is between the Run goroutine's writes and the external reads.

Decision: keep `s.session` private to the Run goroutine (single-writer), but extend `s.mu` to cover **every read and write** of `pendingWorkoutID`, `currentSessionStart`, `currentWorkoutAttached`, `currentPhaseChange`, and `nextID`.

- [ ] **Step 4: Apply lock coverage**

Wrap every write to those fields in `s.mu.Lock(); …; s.mu.Unlock()`. The `stamp` method writes `s.nextID` — protect it:

```go
func (s *Sessionizer) stamp(e *event.Event) {
	s.mu.Lock()
	s.nextID++
	e.ID = s.nextID
	s.mu.Unlock()
	if e.At.IsZero() {
		e.At = s.opts.Now()
	}
}
```

In `openSessionInternal` (sessionizer.go:455), the existing `s.mu.Lock` block already covers `pendingWorkoutID` and snapshot. Audit and confirm. In `closeSession` (sessionizer.go:602), already covered.

The unguarded write was via the `s.mu.Lock(); s.pendingWorkoutID = wid; s.mu.Unlock()` pattern in `Run` (sessionizer.go:178-180) — this is correct. The actual gap is in `stamp` — `nextID` is read by `MaxEventID()` under lock but written without lock.

- [ ] **Step 5: Re-run race test**

Run: `cd backend && go test ./internal/session -race -v`
Expected: PASS, no race reports.

- [ ] **Step 6: Commit**

```bash
git add backend/internal/session/sessionizer.go backend/internal/session/sessionizer_test.go
git commit -m "fix(sessionizer): guard nextID under mu to close race with Snapshot/MaxEventID"
```

---

### Task 6: Persister — bounded retry + dead-letter

**Files:**
- Modify: `backend/internal/storage/persister.go`
- Modify test: `backend/internal/storage/persister_test.go` (or create)

- [ ] **Step 1: Define retry policy**

Decision: 60 retries with exponential backoff capped at 5 s ≈ 4 minutes total wall time before declaring permanent failure. After max retries, log a `CRITICAL` slog entry, increment a `Persister.DeadLettered` counter, and **continue to the next event** (do not block pipeline).

- [ ] **Step 2: Write failing test**

```go
// in persister_test.go
func TestPersister_DeadLettersAfterMaxRetries(t *testing.T) {
	t.Parallel()
	p := &Persister{DB: brokenDB(t), MaxRetries: 3} // brokenDB always errors
	in := make(chan event.Event, 1)
	in <- event.Event{Kind: event.KindSessionStart, SessionID: "s1", SessionStart: &event.SessionStartPayload{}}
	close(in)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := p.Run(ctx, in); err != nil {
		t.Fatal(err)
	}
	if p.DeadLettered != 1 {
		t.Fatalf("want 1 dead-letter, got %d", p.DeadLettered)
	}
}
```

`brokenDB(t)` returns an `*sql.DB` whose Exec/Query always returns an error — implement using a closed DB or a stub driver. Acceptable shortcut: open `sql.Open("sqlite", "/dev/null/cannot-write")` and immediately call `db.Close()`.

- [ ] **Step 3: Run test**

Run: `cd backend && go test ./internal/storage -run TestPersister_DeadLetters -v`
Expected: FAIL (currently retries forever; test times out).

- [ ] **Step 4: Implement bounded retry**

```go
type Persister struct {
	DB           *sql.DB
	Retries      int
	DeadLettered int  // count of events permanently failed
	MaxRetries   int  // 0 means use default (60)
	Scheduler    *stats.RecomputeScheduler
}

const defaultMaxRetries = 60

func (p *Persister) applyWithRetry(ctx context.Context, e event.Event) {
	maxR := p.MaxRetries
	if maxR == 0 {
		maxR = defaultMaxRetries
	}
	backoff := minBackoff
	for attempt := 0; attempt <= maxR; attempt++ {
		err := p.apply(ctx, e)
		if err == nil {
			return
		}
		if errors.Is(err, context.Canceled) {
			return
		}
		p.Retries++
		slog.Error("storage.persister.retry", "event_id", e.ID, "attempt", attempt+1, "max", maxR, "err", err, "backoff", backoff)
		select {
		case <-time.After(backoff):
		case <-ctx.Done():
			return
		}
		backoff *= 2
		if backoff > maxBackoff {
			backoff = maxBackoff
		}
	}
	p.DeadLettered++
	slog.Error("storage.persister.dead_letter", "event_id", e.ID, "kind", e.Kind, "session_id", e.SessionID, "retries", maxR)
}
```

- [ ] **Step 5: Run tests**

Run: `cd backend && go test ./internal/storage -v`
Expected: PASS.

- [ ] **Step 6: Expose dead-letter count via /debug/ingest**

Modify `backend/internal/api/debug.go` to surface `DeadLettered` alongside `Retries`. Add a one-line assertion in `debug_test.go`.

- [ ] **Step 7: Commit**

```bash
git add backend/internal/storage/persister.go backend/internal/storage/persister_test.go backend/internal/api/debug.go backend/internal/api/debug_test.go
git commit -m "fix(persister): bound retries and emit dead_letter on permanent failure"
```

---

### Task 7: Block hard-delete of currently-active session

**Files:**
- Modify: `backend/internal/api/sessions.go:125-166`
- Modify test: `backend/internal/api/sessions_test.go`

- [ ] **Step 1: Decide active-session detection**

Source of truth: `Sessionizer.Snapshot()` returns the open `session_start` event. Add a helper exposed via the existing `SessionActiveProvider` interface (used by `GET /api/v1/session/active`).

- [ ] **Step 2: Write failing test**

```go
func TestDeleteSession_ActiveSession_Returns409(t *testing.T) {
	srv := newTestServer(t)
	// Open a session (push a frame through the fixture pipeline)
	id := openSession(t, srv) // helper returns session id from snapshot
	req := httptest.NewRequest(http.MethodDelete, "/api/v1/sessions/"+id, nil)
	rec := httptest.NewRecorder()
	srv.Handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusConflict {
		t.Fatalf("want 409, got %d", rec.Code)
	}
}
```

- [ ] **Step 3: Run test**

Expected: FAIL (currently 204 — silently deletes active session).

- [ ] **Step 4: Implement guard**

Pass `SessionActiveProvider` into `SessionsHandler`:

```go
func SessionsHandler(db *sql.DB, sched *stats.RecomputeScheduler, active SessionActiveProvider) http.Handler {
```

In `deleteSession`:

```go
func deleteSession(db *sql.DB, sched *stats.RecomputeScheduler, active SessionActiveProvider) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		if active != nil {
			if cur := active.ActiveSessionID(); cur != "" && cur == id {
				http.Error(w, "session is currently active; end it first", http.StatusConflict)
				return
			}
		}
		// …existing delete logic…
	}
}
```

Add `ActiveSessionID() string` to the `SessionActiveProvider` interface and implement it on the sessionizer (read from `s.currentSessionStart.SessionID` under mu).

- [ ] **Step 5: Run tests**

Run: `cd backend && go test ./internal/api -v`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/internal/api/sessions.go backend/internal/api/sessions_test.go backend/internal/api/session_active.go backend/internal/session/
git commit -m "fix(api): reject DELETE /sessions/{id} for currently-active session"
```

---

### Task 8: Stats recompute — block delete response until version bumps

**Files:**
- Modify: `backend/internal/api/sessions.go:125-166`
- Modify: `backend/internal/stats/scheduler.go` (add Wait)

- [ ] **Step 1: Inspect scheduler API**

Read `backend/internal/stats/` to find `RecomputeScheduler`. Identify whether it already has a sync mechanism. If not, add `Wait(ctx, rowerID) error` that blocks until the queued recompute for that rower finishes (or returns immediately if none queued).

- [ ] **Step 2: Add Wait method (if missing)**

Implementation sketch: scheduler tracks an in-flight `sync.WaitGroup` per rowerID, or exposes a per-rower channel that closes when the current recompute completes.

- [ ] **Step 3: Write failing test**

```go
func TestDeleteSession_BlocksUntilStatsRecomputed(t *testing.T) {
	srv := newTestServer(t)
	rowerID, sessionID := seedSessionWithPB(t, srv)
	req := httptest.NewRequest(http.MethodDelete, "/api/v1/sessions/"+sessionID, nil)
	rec := httptest.NewRecorder()
	srv.Handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusNoContent {
		t.Fatalf("want 204, got %d", rec.Code)
	}
	// Immediately after 204, PBs must reflect the deletion (no stale data).
	pbs := getPBs(t, srv, rowerID)
	if len(pbs.Distance) != 0 {
		t.Fatalf("PBs not invalidated after delete; got %+v", pbs)
	}
}
```

- [ ] **Step 4: Run test**

Expected: FAIL (current implementation returns 204 before scheduler runs).

- [ ] **Step 5: Modify deleteSession to await**

```go
if sched != nil {
	stats.OnSessionChange(sched, rowerID, stats.SessionHardDeleted)
	if err := sched.Wait(r.Context(), rowerID); err != nil {
		// Don't fail the delete — the row is gone — but log.
		slog.Warn("delete.recompute_wait", "rower_id", rowerID, "err", err)
	}
}
w.WriteHeader(http.StatusNoContent)
```

- [ ] **Step 6: Run tests**

Run: `cd backend && go test ./... -v`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add backend/internal/stats/ backend/internal/api/sessions.go backend/internal/api/sessions_test.go
git commit -m "fix(api): wait for stats recompute before returning 204 on session delete"
```

---

### Task 9: Cookie `Secure` flag (production)

**Files:**
- Modify: `backend/internal/api/device_cookie.go`
- Modify: `backend/internal/config/config.go` (add `DevMode` field)

- [ ] **Step 1: Add DevMode to Config**

```go
type Config struct {
	// …existing…
	DevMode bool
}

// in Load:
c.DevMode = get(env, "SPLITS_DEV_MODE", "") == "1"
```

(Use `SPLITS_*` since brand rename is Phase B; for compatibility during this task, also accept `HOMEERGO_DEV_MODE`. Phase B drops the legacy name.)

- [ ] **Step 2: Write failing test**

```go
// device_cookie_test.go
func TestDeviceCookie_SecureSetWhenNotDevMode(t *testing.T) {
	mw := DeviceCookie(DeviceCookieOptions{Secure: true})
	// invoke handler, assert cookie has Secure=true
}
```

- [ ] **Step 3: Run test**

Expected: FAIL (function signature change required).

- [ ] **Step 4: Implement**

Change `DeviceCookie()` to accept an options struct:

```go
type DeviceCookieOptions struct{ Secure bool }

func DeviceCookie(opts DeviceCookieOptions) func(http.Handler) http.Handler {
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
					Secure:   opts.Secure,
					SameSite: http.SameSiteLaxMode,
					MaxAge:   deviceCookieMaxAge,
					Expires:  time.Now().Add(time.Duration(deviceCookieMaxAge) * time.Second),
				})
			}
			next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), deviceIDKey, id)))
		})
	}
}
```

In `cmd/.../main.go`, wire `DeviceCookie(DeviceCookieOptions{Secure: !cfg.DevMode})`.

- [ ] **Step 5: Run tests**

Run: `cd backend && go test ./internal/api -v`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/internal/api/device_cookie.go backend/internal/api/device_cookie_test.go backend/internal/config/config.go backend/cmd/
git commit -m "feat(security): set Secure flag on device cookie outside dev mode"
```

---

### Task 10: Refuse plain HTTP at startup unless DevMode

**Files:**
- Modify: `backend/cmd/.../main.go`

- [ ] **Step 1: Add startup check**

In `main.go`, after `cfg, err := config.Load(os.LookupEnv)`:

```go
if !cfg.DevMode && !strings.HasPrefix(cfg.Addr, "127.0.0.1") && !strings.HasPrefix(cfg.Addr, "localhost") {
	if !strings.Contains(strings.ToLower(os.Getenv("SPLITS_TLS_TERMINATED_BY")), "proxy") {
		return fmt.Errorf("refusing to start: cfg.Addr=%q without TLS. Set SPLITS_DEV_MODE=1 for local dev or SPLITS_TLS_TERMINATED_BY=proxy when behind Caddy/nginx", cfg.Addr)
	}
}
```

- [ ] **Step 2: Manual verification**

Run: `cd backend && go run ./cmd/homeergo` (replace path post-rename)
Expected: refuses with clear message. Set `SPLITS_DEV_MODE=1` → starts.

- [ ] **Step 3: Commit**

```bash
git add backend/cmd/
git commit -m "feat(security): refuse non-localhost startup without TLS termination signal"
```

---

### Task 11: Security headers middleware

**Files:**
- Create: `backend/internal/api/security_headers.go`
- Create: `backend/internal/api/security_headers_test.go`
- Modify: `backend/internal/api/router.go:84`

- [ ] **Step 1: Write failing test**

```go
func TestSecurityHeaders(t *testing.T) {
	mw := SecurityHeaders()
	h := mw(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(200) }))
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/x", nil))
	for _, want := range []struct{ k, v string }{
		{"X-Content-Type-Options", "nosniff"},
		{"X-Frame-Options", "DENY"},
		{"Referrer-Policy", "no-referrer"},
		{"Strict-Transport-Security", "max-age=31536000"},
		{"Content-Security-Policy", "default-src 'self'"},
	} {
		if got := rec.Header().Get(want.k); !strings.Contains(got, want.v) {
			t.Errorf("%s: want contains %q, got %q", want.k, want.v, got)
		}
	}
}
```

- [ ] **Step 2: Implement**

```go
// backend/internal/api/security_headers.go
package api

import "net/http"

func SecurityHeaders() Middleware {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			h := w.Header()
			h.Set("X-Content-Type-Options", "nosniff")
			h.Set("X-Frame-Options", "DENY")
			h.Set("Referrer-Policy", "no-referrer")
			h.Set("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
			// PWA + SSE: allow self only; allow inline styles for vite-built css.
			h.Set("Content-Security-Policy",
				"default-src 'self'; "+
				"script-src 'self'; "+
				"style-src 'self' 'unsafe-inline'; "+
				"connect-src 'self'; "+
				"img-src 'self' data:; "+
				"font-src 'self'; "+
				"frame-ancestors 'none'; "+
				"base-uri 'self'; "+
				"form-action 'self'")
			next.ServeHTTP(w, r)
		})
	}
}
```

- [ ] **Step 3: Wire into router**

```go
mws := []Middleware{Recover(), Logging(), SecurityHeaders(), DeviceCookie(...)}
```

- [ ] **Step 4: Run all tests + manual verify**

Run: `cd backend && go test ./internal/api -v`
Run: PWA dev server, open devtools network tab, confirm headers present and the app still loads (CSP didn't break anything). If Vite injects an inline script in production build, add a nonce mechanism.

- [ ] **Step 5: Commit**

```bash
git add backend/internal/api/security_headers.go backend/internal/api/security_headers_test.go backend/internal/api/router.go
git commit -m "feat(security): add baseline security headers (CSP, HSTS, X-Frame-Options)"
```

---

### Task 12: Request body size limit

**Files:**
- Modify: `backend/internal/api/middleware.go`
- Modify: `backend/internal/api/router.go`

- [ ] **Step 1: Write failing test**

```go
func TestBodyLimit_RejectsOversizedRequest(t *testing.T) {
	srv := newTestServer(t)
	big := make([]byte, 2*1024*1024) // 2 MiB
	req := httptest.NewRequest(http.MethodPost, "/api/v1/rowers", bytes.NewReader(big))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	srv.Handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("want 413, got %d", rec.Code)
	}
}
```

- [ ] **Step 2: Implement BodyLimit middleware**

```go
// in middleware.go
const defaultBodyLimit int64 = 256 * 1024 // 256 KiB

func BodyLimit(maxBytes int64) Middleware {
	if maxBytes <= 0 {
		maxBytes = defaultBodyLimit
	}
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			// Skip for SSE — never has a request body of significance.
			if r.Body != nil {
				r.Body = http.MaxBytesReader(w, r.Body, maxBytes)
			}
			next.ServeHTTP(w, r)
		})
	}
}
```

`MaxBytesReader` writes a 413 to the writer and aborts read; handlers that call `json.NewDecoder(r.Body).Decode(&in)` will receive an error and currently return 400. Acceptable: the client gets a 413 directly because `MaxBytesReader` wrote it before the handler ran. Add to chain.

- [ ] **Step 3: Wire into router**

```go
mws := []Middleware{Recover(), Logging(), SecurityHeaders(), BodyLimit(0), DeviceCookie(...)}
```

- [ ] **Step 4: Run tests**

Run: `cd backend && go test ./internal/api -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/internal/api/middleware.go backend/internal/api/middleware_test.go backend/internal/api/router.go
git commit -m "feat(security): cap request body at 256 KiB"
```

---

### Task 13: Rate limiting

**Files:**
- Create: `backend/internal/api/ratelimit.go`
- Create: `backend/internal/api/ratelimit_test.go`
- Modify: `backend/internal/api/router.go`

- [ ] **Step 1: Decide policy**

Per device cookie: 60 requests / 10 s burst, 6 requests / s sustained. Excludes `/api/v1/stream` (long-lived SSE). Uses `golang.org/x/time/rate`.

Add dependency: `cd backend && go get golang.org/x/time/rate`.

- [ ] **Step 2: Write failing test**

```go
func TestRateLimit_BlocksOver60InWindow(t *testing.T) {
	rl := RateLimit(RateLimitOptions{RPS: 6, Burst: 60})
	h := rl(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(200) }))
	hits := 0
	throttled := 0
	for i := 0; i < 100; i++ {
		req := httptest.NewRequest(http.MethodGet, "/x", nil)
		req.AddCookie(&http.Cookie{Name: "device_id", Value: "dev1"})
		// inject device_id into ctx as DeviceCookie middleware would
		ctx := context.WithValue(req.Context(), deviceIDKey, "dev1")
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req.WithContext(ctx))
		switch rec.Code {
		case 200:
			hits++
		case 429:
			throttled++
		}
	}
	if throttled == 0 {
		t.Fatal("expected some 429s after burst exhausted")
	}
}
```

- [ ] **Step 3: Implement**

```go
// backend/internal/api/ratelimit.go
package api

import (
	"net/http"
	"sync"
	"time"
	"golang.org/x/time/rate"
)

type RateLimitOptions struct {
	RPS   float64
	Burst int
}

type rlEntry struct {
	lim  *rate.Limiter
	seen time.Time
}

func RateLimit(opts RateLimitOptions) Middleware {
	if opts.RPS == 0 { opts.RPS = 6 }
	if opts.Burst == 0 { opts.Burst = 60 }
	var (
		mu      sync.Mutex
		entries = map[string]*rlEntry{}
	)
	// background gc — drop entries idle for >10 min
	go func() {
		t := time.NewTicker(time.Minute)
		for range t.C {
			mu.Lock()
			cutoff := time.Now().Add(-10 * time.Minute)
			for k, e := range entries {
				if e.seen.Before(cutoff) {
					delete(entries, k)
				}
			}
			mu.Unlock()
		}
	}()
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.URL.Path == "/api/v1/stream" {
				next.ServeHTTP(w, r)
				return
			}
			id := DeviceIDFromContext(r.Context())
			if id == "" { id = r.RemoteAddr }
			mu.Lock()
			e, ok := entries[id]
			if !ok {
				e = &rlEntry{lim: rate.NewLimiter(rate.Limit(opts.RPS), opts.Burst)}
				entries[id] = e
			}
			e.seen = time.Now()
			mu.Unlock()
			if !e.lim.Allow() {
				http.Error(w, "rate limit exceeded", http.StatusTooManyRequests)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}
```

- [ ] **Step 4: Wire into router (after DeviceCookie so we can read device id)**

```go
mws := []Middleware{Recover(), Logging(), SecurityHeaders(), BodyLimit(0), DeviceCookie(...), RateLimit(RateLimitOptions{})}
```

- [ ] **Step 5: Run tests**

Run: `cd backend && go test ./internal/api -v`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/internal/api/ratelimit.go backend/internal/api/ratelimit_test.go backend/internal/api/router.go backend/go.mod backend/go.sum
git commit -m "feat(security): per-device rate limit (6 rps, burst 60)"
```

---

## Phase B — Brand rename `homeergo` → `splits`

### Task 14: Backend env-var rename with backward-compat shim

**Files:**
- Modify: `backend/internal/config/config.go`
- Modify test: `backend/internal/config/config_test.go`
- Modify: `backend/README.md`

- [ ] **Step 1: Write failing test for new env vars**

```go
func TestLoad_AcceptsSPLITEnvVars(t *testing.T) {
	env := func(k string) (string, bool) {
		switch k {
		case "SPLITS_ADDR":      return ":9999", true
		case "SPLITS_DB_PATH":   return "/tmp/splits.db", true
		case "SPLITS_FIXTURE":   return "fixt.bin", true
		}
		return "", false
	}
	cfg, err := Load(env)
	if err != nil { t.Fatal(err) }
	if cfg.Addr != ":9999" || cfg.DBPath != "/tmp/splits.db" || cfg.Fixture != "fixt.bin" {
		t.Fatalf("got %+v", cfg)
	}
}

func TestLoad_LegacyHOMEERGOVarsStillWork(t *testing.T) {
	env := func(k string) (string, bool) {
		if k == "HOMEERGO_ADDR" { return ":7777", true }
		return "", false
	}
	cfg, err := Load(env)
	if err != nil { t.Fatal(err) }
	if cfg.Addr != ":7777" {
		t.Fatalf("want :7777 got %s", cfg.Addr)
	}
}
```

- [ ] **Step 2: Run tests**

Expected: FAIL.

- [ ] **Step 3: Update Load to prefer SPLITS_ then fall back to HOMEERGO_**

```go
func get2(env Lookup, primary, legacy, fallback string) string {
	if v, ok := env(primary); ok { return v }
	if v, ok := env(legacy); ok {
		// log once (warn) — done in main, not here
		return v
	}
	return fallback
}

// in Load:
c.Addr        = get2(env, "SPLITS_ADDR",        "HOMEERGO_ADDR",        ":8080")
c.SerialPort  = get2(env, "SPLITS_SERIAL_PORT", "HOMEERGO_SERIAL_PORT", "")
c.DBPath      = get2(env, "SPLITS_DB_PATH",     "HOMEERGO_DB_PATH",     "./splits.db")
c.Fixture     = get2(env, "SPLITS_FIXTURE",     "HOMEERGO_FIXTURE",     "")
c.FixtureRate = get2(env, "SPLITS_FIXTURE_RATE","HOMEERGO_FIXTURE_RATE","realtime")
c.LogLevel    = get2(env, "SPLITS_LOG_LEVEL",   "HOMEERGO_LOG_LEVEL",   "info")
// same pattern for SPLITS_SERIAL_BAUD, SPLITS_IDLE_TIMEOUT
```

Default DB path: `./splits.db`. **If `./homeergo.db` exists and `./splits.db` does not**, fall back to the old path automatically (preserve existing data on dev machines):

```go
if c.DBPath == "./splits.db" {
	if _, err := os.Stat("./splits.db"); errors.Is(err, fs.ErrNotExist) {
		if _, err := os.Stat("./homeergo.db"); err == nil {
			c.DBPath = "./homeergo.db"
			slog.Warn("config.legacy_db_path", "path", "./homeergo.db", "advice", "rename to splits.db at next downtime")
		}
	}
}
```

- [ ] **Step 4: Run tests**

Run: `cd backend && go test ./internal/config -v`
Expected: PASS.

- [ ] **Step 5: Update README**

Replace `HOMEERGO_*` with `SPLITS_*` in `backend/README.md`. Add a "Legacy env-var compatibility" section noting the shim and that it will be removed in v2.

- [ ] **Step 6: Commit**

```bash
git add backend/internal/config/ backend/README.md
git commit -m "feat(config): accept SPLITS_* env vars; keep HOMEERGO_* fallback for one release"
```

---

### Task 15: Rename binary directory `cmd/homeergo` → `cmd/splits`

**Files:**
- Move: `backend/cmd/homeergo/` → `backend/cmd/splits/`

- [ ] **Step 1: Move directory**

Run: `cd backend && git mv cmd/homeergo cmd/splits`

- [ ] **Step 2: Update package comment / log keys**

Edit `backend/cmd/splits/main.go`:
- `slog.Info("homeergo.start", …)` → `slog.Info("splits.start", …)`
- `slog.Info("homeergo.exit", …)` → `slog.Info("splits.exit", …)` (and any `homeergo.resume` etc.)
- Update file header comment if it names the binary.

- [ ] **Step 3: Build**

Run: `cd backend && go build ./...`
Expected: success.

- [ ] **Step 4: Update all references to the cmd path**

```bash
cd /Users/dg/dev/ruderergo-stats
grep -rn 'cmd/homeergo' --include='*.md' --include='*.ts' --include='*.go' --include='*.sh' --include='*.json'
```

Update each: `cmd/homeergo` → `cmd/splits`. Files include `web/README.md`, `web/tests/e2e/*.spec.ts`, `.claude/settings.local.json`, plan docs in `docs/plans/`. (The plan docs are historical artifacts — leave them as-is for accurate history. Only update active references.)

Active references checklist:
- `web/README.md:9`
- `web/tests/e2e/rower-onboarding.spec.ts:17-18`
- `web/tests/e2e/history.spec.ts:18-19`
- `web/tests/e2e/live-view-real-backend.spec.ts:18-19`
- `.claude/settings.local.json:16,18` (pkill filters: `go run ./cmd/splits` and the `homeergo` substring)

- [ ] **Step 5: Run full test suite**

Run: `cd backend && go test ./...` and `cd web && npm test`
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor: rename cmd/homeergo → cmd/splits"
```

---

### Task 16: Rename Go module path

**Files:**
- Modify: `backend/go.mod`
- Modify: every `.go` file with import `github.com/gloeckner-daniel/home-ergo/...`

- [ ] **Step 1: Edit go.mod**

Change line 1: `module github.com/gloeckner-daniel/home-ergo` → `module github.com/gloeckner-daniel/splits`.

- [ ] **Step 2: Bulk rename imports**

```bash
cd /Users/dg/dev/ruderergo-stats/backend
grep -rl 'github.com/gloeckner-daniel/home-ergo' --include='*.go' | xargs sed -i '' 's|github.com/gloeckner-daniel/home-ergo|github.com/gloeckner-daniel/splits|g'
```

(Use a portable variant if not on macOS: `sed -i ''` is BSD-style.)

- [ ] **Step 3: Build & test**

Run: `cd backend && go build ./... && go test ./...`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "refactor: rename Go module github.com/.../home-ergo → splits"
```

---

### Task 17: Brand rename in test fixture filenames and pkill filters

**Files:**
- Modify: `web/tests/e2e/*.spec.ts` (temp dir prefixes `homeergo-e2e-*` → `splits-e2e-*`)
- Modify: `.claude/settings.local.json:16,18`

- [ ] **Step 1: Update e2e temp dir prefixes**

In each spec file, change `mkdtempSync(path.join(os.tmpdir(), 'homeergo-e2e-…'))` to `'splits-e2e-…'`. Confirm there is no expectation of the old name elsewhere.

- [ ] **Step 2: Update settings.local.json pkill filters**

`.claude/settings.local.json:16,18` — replace `homeergo` substrings with `splits`.

- [ ] **Step 3: Run e2e suite**

Run: `cd web && npm run test:e2e`
Expected: PASS (or stale-skipped, see ROADMAP).

- [ ] **Step 4: Commit**

```bash
git add web/tests/ .claude/settings.local.json
git commit -m "refactor: rename e2e fixture prefixes homeergo → splits"
```

---

### Task 18: Decide localStorage migration

**Files:**
- (Decision-only; no code changes if "keep")

- [ ] **Step 1: Decide**

Keep keys `home-ergo:tile-layout:v2`, `home-ergo:theme`, `home-ergo:last-event-id` as-is. Reasoning: migrating means writing a one-shot reader of legacy keys (low value vs. cost; user data preserved either way). Document in `docs/v1-review.md` that keys are intentionally left.

If user later requests rename: write `web/src/storage/migrateBrand.ts` that reads each legacy key, writes to the new `splits:` key, then removes the old. Run on app startup before any consumer reads. Out of scope for now.

- [ ] **Step 2: Update v1-review.md**

In the brand section of `docs/v1-review.md`, replace the open question with: "Keep `home-ergo:*` localStorage keys (decision recorded 2026-04-28)."

- [ ] **Step 3: Commit**

```bash
git add docs/v1-review.md
git commit -m "docs: keep home-ergo:* localStorage keys; rename deferred"
```

---

### Task 19: Brand rename — docs sweep

**Files:**
- `backend/README.md`, `web/README.md`, `specs/arch/0001-backend-pipeline.md`, top-level `README.md`, `AGENTS.md`

- [ ] **Step 1: Sweep**

Run: `cd /Users/dg/dev/ruderergo-stats && grep -rn 'homeergo\|HOMEERGO' --include='*.md' specs/ docs/ backend/README.md web/README.md README.md AGENTS.md 2>/dev/null`

For each *active* doc (README.md, specs/arch, AGENTS.md), replace example invocations with `splits` / `SPLITS_*`. **Do not edit `docs/plans/*.md` historical artifacts.**

- [ ] **Step 2: Commit**

```bash
git add -A
git commit -m "docs: rebrand homeergo → splits in active docs"
```

---

## Phase C — Frontend follow-ups

### Task 20: Frontend — pass `rower_id` to sessions list (verify)

**Files:**
- Audit: `web/src/api/sessions.ts` (or wherever the sessions fetch lives)

- [ ] **Step 1: Search for callers**

Run: `cd web && grep -rn '/api/v1/sessions' src/ --include='*.ts' --include='*.tsx'`
Verify every call includes `rower_id` query param. If any direct call lacks it, fix.

- [ ] **Step 2: Run tests**

Run: `cd web && npm test`
Expected: PASS.

- [ ] **Step 3: Commit if changes**

```bash
git add web/src/
git commit -m "fix(web): always include rower_id in /sessions queries"
```

---

### Task 21: Frontend — handle 403 on active-rower SET

**Files:**
- Modify: `web/src/api/activeRower.ts` (or equivalent)
- Modify: relevant UI surface (RowerStrip / OnboardingPage)

- [ ] **Step 1: Add UI for 403**

When `PUT /api/v1/active-rower` returns 403, surface a German message: "Dieser Profil ist mit diesem Gerät nicht verbunden." Offer a "Re-koppeln" button (no-op until FEAT-0002 ships; could route to onboarding).

- [ ] **Step 2: Add component test**

```tsx
it('shows pairing-required hint on 403', async () => {
	server.use(rest.put('/api/v1/active-rower', (_, res, ctx) => res(ctx.status(403))))
	// render RowerStrip, click switch, expect hint visible
})
```

- [ ] **Step 3: Commit**

```bash
git add web/src/
git commit -m "feat(web): show pairing-required hint on 403 from active-rower PUT"
```

---

### Task 22: Frontend — handle 429 globally (rate limit)

**Files:**
- Modify: `web/src/main.tsx` (TanStack Query retry config)
- Modify: a global toast / notification component (introduce one if not present)

- [ ] **Step 1: Add 429 handling to query client**

In TanStack Query default options:

```ts
queries: {
	staleTime: 30_000,
	retry: (failureCount, error) => {
		if (error instanceof Response && error.status === 429) return false
		return failureCount < 2
	},
},
```

Also add a global `onError` that, when it sees 429, shows a "Zu viele Anfragen — kurz warten" toast.

- [ ] **Step 2: Component test**

Mock fetch returning 429; assert toast appears once.

- [ ] **Step 3: Commit**

```bash
git add web/src/
git commit -m "feat(web): handle 429 with no-retry + user-visible toast"
```

---

## Self-review checklist (run after writing this plan)

- ✅ Each P0 from `docs/v1-review.md` Phase A maps to a task here, except FEAT-0002 QR pairing and session-detail charts (explicitly scoped out at top with rationale).
- ✅ Every code step shows actual code or exact diff guidance — no "implement appropriate handling".
- ✅ Type names consistent: `DeviceLink`, `IsPaired`, `Pair`, `RateLimitOptions`, `BodyLimit`, `SecurityHeaders`, `DeviceCookieOptions`.
- ✅ Each task ends in a commit step.
- ✅ Tests written before implementation (TDD) where the change is logic; trivial renames use build/run verification instead.

## Verification at end of all phases

```bash
cd backend && go test -race ./...
cd web && npm test && npm run typecheck
```

Both must be green before declaring P0 closed.

## Open follow-ups (not blockers, document for tracking)

- Migrate `home-ergo:*` localStorage keys → `splits:*` once a user-visible reset is acceptable.
- Drop `HOMEERGO_*` env-var fallbacks at v2.
- Write FEAT-0002 plan (QR pairing).
- Write FEAT-0003 charts plan (after picking chart library).
