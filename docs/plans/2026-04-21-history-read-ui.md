# History Read Path + List/Detail UI Implementation Plan

> **Historical:** Plan written before brand rename. Code paths and env vars referenced (`cmd/homeergo`, `HOMEERGO_*`) shifted to `cmd/splits` and `SPLITS_*` on 2026-04-28. See `backend/README.md` for current config; the legacy fallback shim is documented there.


> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn persisted sessions into a browsable history. Backend gains read endpoints (`GET /api/v1/sessions`, `…/{id}`, `…/{id}/samples`, `DELETE …/{id}`). Frontend gets a working Historie tab: list of past sessions + detail page with stacked metric charts.

**Architecture:** Backend adds a `storage` read side (pure query functions) + a new `internal/api/sessions` handler set. Soft-delete via `deleted_at` column (7-day window — acceptance criterion from FEAT-0003). Frontend switches the existing placeholder `HistoryPage` to a TanStack-Query-driven list, adds a `/historie/:sessionId` route with a detail page composed of the existing `Sparkline` primitive scaled up. No new chart library.

**Tech Stack additions:**
- Frontend: `@tanstack/react-query@^5` — single fetcher, cache, refetch-on-mount.
- No backend additions.

**Spec references:**
- [`specs/feat/0003-session-history.md`](../../specs/feat/0003-session-history.md) — list + detail + soft-delete + export hooks.
- [`specs/feat/0003a-enhanced-history-trends.md`](../../specs/feat/0003a-enhanced-history-trends.md) — richer UX; this plan ships the **Sessions sub-tab first slice**. Trends sub-tab, filter chips, PB badges, splits table are **all deferred**.
- [`specs/arch/0001-backend-pipeline.md`](../../specs/arch/0001-backend-pipeline.md) — M3 storage is load-bearing once reads land.
- [`docs/plans/2026-04-21-m3-backend-sse-persistence.md`](./2026-04-21-m3-backend-sse-persistence.md) — this plan builds on its schema + persister.

**Out of scope (deferred):**
- Trends sub-tab (Wochen/Monate/Jahr aggregates, headline tiles, volume/regularity/performance/efficiency charts).
- Filter chips (user/date range/distance/intensity) + Summary-Strip.
- PB badges + milestones (needs FEAT-0004 calculations).
- FIT/TCX export (CSV stretch optional; see open question).
- Splits-Tabelle per 500 m.
- User annotations on sessions.
- Long-press context menu (only tap → detail + a delete button on detail for v1).
- Infinite scroll (Load-More button instead).
- Multi-rower filter (needs auth; rower stub stays "local-rower").

**Resolved design decisions (locked during this plan):**
- **Pagination**: offset/limit with default `limit=50`, max `100`. Load-More button on the list appends pages; no infinite scroll yet.
- **Sort order**: `started_at DESC` always.
- **Soft-delete**: `DELETE /api/v1/sessions/{id}` sets `deleted_at=now`. All read endpoints filter `WHERE deleted_at IS NULL`. No restore endpoint in this plan (7-day undelete UI is FEAT-0003 acceptance item deferred to a polish plan; the column + filter land now so the data survives the window).
- **Sample resolution**: `GET /…/samples` returns every persisted stroke row (no downsampling). At ~0.5 Hz × 30 min sessions = ~900 strokes; fine for JSON over LAN.
- **Chart library**: reuse existing `Sparkline.tsx`. A new `<LineChart>` primitive wraps it at a larger viewBox with axis labels.
- **CSV export**: not in this plan. Download-button is a trivial follow-up once the data path exists.
- **Live-view interaction**: the list's top row is **not** the currently-live session. Live sessions are in-progress on `LivePage`; the history list shows only sessions where `ended_at IS NOT NULL`. (Sessions ending during browsing appear on next refetch.)

---

## File Structure

Files created or modified (under `backend/` and `web/`):

```
backend/
├── internal/
│   ├── storage/
│   │   ├── migrations/
│   │   │   └── 0002_soft_delete.sql        (new — adds deleted_at column)
│   │   ├── reads.go                        (new — ListSessions, GetSession, ListSamples)
│   │   ├── reads_test.go                   (new)
│   │   ├── soft_delete.go                  (new — SoftDeleteSession)
│   │   └── soft_delete_test.go             (new)
│   └── api/
│       ├── sessions.go                     (new — GET/DELETE handlers)
│       ├── sessions_test.go                (new)
│       └── router.go                       (modified — register new routes)

web/
├── package.json                            (modified — @tanstack/react-query)
├── src/
│   ├── main.tsx                            (modified — QueryClientProvider)
│   ├── app/
│   │   └── AppRouter.tsx                   (modified — /historie/:id route)
│   ├── api/
│   │   ├── client.ts                       (new — typed fetchers)
│   │   └── client.test.ts                  (new)
│   ├── components/
│   │   └── LineChart/
│   │       ├── LineChart.tsx               (new — scaled-up Sparkline w/ axis)
│   │       ├── LineChart.module.css        (new)
│   │       └── LineChart.test.tsx          (new)
│   ├── pages/
│   │   ├── HistoryPage.tsx                 (overwritten — list with TanStack Query)
│   │   ├── HistoryPage.module.css          (new)
│   │   ├── HistoryPage.test.tsx            (new)
│   │   ├── SessionDetailPage.tsx           (new)
│   │   ├── SessionDetailPage.module.css    (new)
│   │   └── SessionDetailPage.test.tsx      (new)
│   └── util/
│       └── dates.ts                        (new — format ISO → "Heute 14:32" etc.)
│       └── dates.test.ts                   (new)
└── tests/e2e/
    └── history.spec.ts                     (new — Playwright smoke)
```

**Conventions:**

- Backend reads live in `storage/reads.go` as pure functions taking `*sql.DB` and a context. No new struct-scope state.
- Frontend fetchers live in `src/api/client.ts` — one function per endpoint, each returning a typed value. TanStack Query is called from pages only; `client.ts` stays framework-agnostic so non-React consumers (future CLI tools, Storybook) can use it.
- The `LineChart` wraps `Sparkline` — we do not rewrite the SVG math. Axis labels and the larger viewBox are the only additions.

---

## Task 1: Frontend — install TanStack Query

**Files:**
- Modify: `web/package.json`, `web/package-lock.json`
- Modify: `web/src/main.tsx`

- [ ] **Step 1: Install**

```bash
cd web && npm install --legacy-peer-deps @tanstack/react-query
```

Expected: `@tanstack/react-query@^5` added to `dependencies`.

- [ ] **Step 2: Wrap the app in a QueryClientProvider**

Edit `web/src/main.tsx`. The current mount looks like:

```tsx
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppRouter />
  </StrictMode>,
)
```

Change it to:

```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
    },
  },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <AppRouter />
    </QueryClientProvider>
  </StrictMode>,
)
```

Other imports + `registerSW` stay unchanged.

- [ ] **Step 3: Verify build + tests still green**

```bash
cd web && npm run typecheck && npm run build && npm test
```

Expected: all green. The existing 75 vitest tests are not affected by the provider (they render components in isolation).

- [ ] **Step 4: Commit**

```bash
git add web/package.json web/package-lock.json web/src/main.tsx
git commit -m "feat(web): wire TanStack Query provider"
```

---

## Task 2: Backend — soft-delete migration

**Files:**
- Create: `backend/internal/storage/migrations/0002_soft_delete.sql`

- [ ] **Step 1: Write the migration**

```sql
ALTER TABLE sessions ADD COLUMN deleted_at TEXT;
CREATE INDEX IF NOT EXISTS idx_sessions_not_deleted
  ON sessions(started_at) WHERE deleted_at IS NULL;
```

- [ ] **Step 2: Run the storage tests**

The migration runner applies the new file at `Open`. Existing tests that open a fresh DB should now see version 2:

```bash
cd backend && go test ./internal/storage/ -v
```

Expected: all existing tests still pass. The `TestOpenRunsMigrations` test was written to assert `version = 1`. Update it to assert `version = 2` in the same step (pragmatic — the invariant is "latest migration is applied", not "exactly version 1"):

Edit `backend/internal/storage/db_test.go`. Change:

```go
if v != 1 {
    t.Errorf("schema_migrations.max(version) = %d, want 1", v)
}
```

to:

```go
if v != 2 {
    t.Errorf("schema_migrations.max(version) = %d, want 2", v)
}
```

Do the same in `TestOpenIsIdempotent`.

Run tests again — must pass.

- [ ] **Step 3: Commit**

```bash
git add backend/internal/storage/migrations/0002_soft_delete.sql backend/internal/storage/db_test.go
git commit -m "feat(backend): add soft-delete column + migration 0002"
```

---

## Task 3: Backend — read queries

**Files:**
- Create: `backend/internal/storage/reads.go`
- Create: `backend/internal/storage/reads_test.go`

Three read functions: `ListSessions(limit, offset)`, `GetSession(id)`, `ListSamples(sessionID)`. All filter `deleted_at IS NULL`. All sort by `started_at DESC` (sessions) or `stroke_no ASC` (samples).

- [ ] **Step 1: Failing test at `backend/internal/storage/reads_test.go`**:

```go
package storage

import (
	"context"
	"path/filepath"
	"testing"
	"time"

	"github.com/gloeckner-daniel/home-ergo/internal/event"
)

func seedSessions(t *testing.T, db *DB, n int) []string {
	t.Helper()
	ctx := context.Background()
	ids := make([]string, 0, n)
	for i := 0; i < n; i++ {
		id := string(rune('A'+i)) + "id"
		started := time.Date(2026, 4, 20+i, 10, 0, 0, 0, time.UTC)
		if err := InsertSession(ctx, db.Handle(), id, "R1", started, 3); err != nil {
			t.Fatalf("seed[%d]: %v", i, err)
		}
		if err := UpdateSessionEnd(ctx, db.Handle(), id, started.Add(5*time.Minute),
			event.SessionSummary{TotalDistanceM: 1000 * (i + 1), TotalTimeSec: 300,
				TotalStrokes: 100 + i, AvgPaceSecPer500m: 130}); err != nil {
			t.Fatalf("end seed[%d]: %v", i, err)
		}
		ids = append(ids, id)
	}
	return ids
}

func TestListSessionsDescByStartedAt(t *testing.T) {
	db, err := Open(filepath.Join(t.TempDir(), "t.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	seedSessions(t, db, 3)

	rows, err := ListSessions(context.Background(), db.Handle(), 10, 0)
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) != 3 {
		t.Fatalf("got %d rows", len(rows))
	}
	// Most recent first: C, B, A.
	if rows[0].ID != "Cid" || rows[2].ID != "Aid" {
		t.Errorf("order wrong: %v", []string{rows[0].ID, rows[1].ID, rows[2].ID})
	}
}

func TestListSessionsPagination(t *testing.T) {
	db, _ := Open(filepath.Join(t.TempDir(), "t.db"))
	defer db.Close()
	seedSessions(t, db, 5)

	p1, _ := ListSessions(context.Background(), db.Handle(), 2, 0)
	p2, _ := ListSessions(context.Background(), db.Handle(), 2, 2)
	if len(p1) != 2 || len(p2) != 2 {
		t.Fatalf("page sizes: %d %d", len(p1), len(p2))
	}
	if p1[0].ID == p2[0].ID {
		t.Errorf("pages overlap")
	}
}

func TestListSessionsExcludesDeleted(t *testing.T) {
	db, _ := Open(filepath.Join(t.TempDir(), "t.db"))
	defer db.Close()
	ids := seedSessions(t, db, 3)
	if err := SoftDeleteSession(context.Background(), db.Handle(), ids[1], time.Now().UTC()); err != nil {
		t.Fatalf("soft delete: %v", err)
	}
	rows, _ := ListSessions(context.Background(), db.Handle(), 10, 0)
	if len(rows) != 2 {
		t.Errorf("got %d rows, want 2 (one soft-deleted)", len(rows))
	}
	for _, r := range rows {
		if r.ID == ids[1] {
			t.Errorf("deleted session %q leaked into list", r.ID)
		}
	}
}

func TestGetSessionReturnsDetail(t *testing.T) {
	db, _ := Open(filepath.Join(t.TempDir(), "t.db"))
	defer db.Close()
	ids := seedSessions(t, db, 1)

	got, err := GetSession(context.Background(), db.Handle(), ids[0])
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if got == nil || got.ID != ids[0] {
		t.Errorf("got %+v", got)
	}
	if got.Summary.TotalDistanceM != 1000 {
		t.Errorf("summary.TotalDistanceM = %d", got.Summary.TotalDistanceM)
	}
}

func TestGetSessionNilForMissingOrDeleted(t *testing.T) {
	db, _ := Open(filepath.Join(t.TempDir(), "t.db"))
	defer db.Close()
	got, err := GetSession(context.Background(), db.Handle(), "nope")
	if err != nil || got != nil {
		t.Errorf("expected nil session, no error; got %v / %v", got, err)
	}

	ids := seedSessions(t, db, 1)
	_ = SoftDeleteSession(context.Background(), db.Handle(), ids[0], time.Now().UTC())
	got, err = GetSession(context.Background(), db.Handle(), ids[0])
	if err != nil || got != nil {
		t.Errorf("expected nil for deleted session; got %v / %v", got, err)
	}
}

func TestListSamplesOrderByStrokeNo(t *testing.T) {
	db, _ := Open(filepath.Join(t.TempDir(), "t.db"))
	defer db.Close()
	ctx := context.Background()
	started := time.Date(2026, 4, 21, 10, 0, 0, 0, time.UTC)
	_ = InsertSession(ctx, db.Handle(), "S1", "R1", started, 3)
	// Insert out of order to verify the query sorts, not the insert sequence.
	for _, n := range []int{3, 1, 2} {
		p := event.StrokePayload{StrokeNo: n, TimeSec: float64(n) * 2, DistanceM: n * 8,
			SPM: 25, PowerW: 200, CalPerHr: 1000, Level: 3,
			DPS: 8, StrokeCycleSec: 2, PaceSecPer500m: 125, EnergyJoules: 400}
		_ = InsertStroke(ctx, db.Handle(), uint64(n), "S1", started, p)
	}

	samples, err := ListSamples(ctx, db.Handle(), "S1")
	if err != nil {
		t.Fatal(err)
	}
	if len(samples) != 3 {
		t.Fatalf("got %d", len(samples))
	}
	if samples[0].StrokeNo != 1 || samples[2].StrokeNo != 3 {
		t.Errorf("not sorted: %+v", samples)
	}
}
```

- [ ] **Step 2: Run — must fail**

```bash
cd backend && go test ./internal/storage/ -run "TestList|TestGet" -v
```

- [ ] **Step 3: Implement `reads.go`**:

```go
package storage

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"time"

	"github.com/gloeckner-daniel/home-ergo/internal/event"
)

// SessionRow is the read-side shape of a persisted session. Kept
// deliberately flat so the JSON handler can marshal it directly and
// the frontend can render list + detail from the same type.
type SessionRow struct {
	ID             string                `json:"id"`
	RowerID        string                `json:"rower_id"`
	StartedAt      time.Time             `json:"started_at"`
	EndedAt        *time.Time            `json:"ended_at,omitempty"`
	InitialLevel   int                   `json:"initial_level"`
	TotalDistanceM *int                  `json:"total_distance_m,omitempty"`
	TotalTimeSec   *float64              `json:"total_time_sec,omitempty"`
	TotalStrokes   *int                  `json:"total_strokes,omitempty"`
	Summary        *event.SessionSummary `json:"summary,omitempty"`
}

// SampleRow mirrors one strokes table row. StrokeNo is 1-based.
type SampleRow struct {
	StrokeNo       int     `json:"stroke_no"`
	TimeSec        float64 `json:"time_sec"`
	DistanceM      int     `json:"distance_m"`
	SPM            int     `json:"spm"`
	PowerW         int     `json:"power_w"`
	CalPerHr       int     `json:"cal_per_hr"`
	Level          int     `json:"level"`
	DPS            float64 `json:"dps"`
	StrokeCycleSec float64 `json:"stroke_cycle_sec"`
	PaceSecPer500m int     `json:"pace_sec_per_500m"`
	EnergyJoules   int     `json:"energy_joules"`
}

// ListSessions returns non-deleted sessions newest first.
func ListSessions(ctx context.Context, db *sql.DB, limit, offset int) ([]SessionRow, error) {
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	if offset < 0 {
		offset = 0
	}
	rows, err := db.QueryContext(ctx, `
		SELECT id, rower_id, started_at, ended_at, initial_level,
		       total_distance_m, total_time_sec, total_strokes, summary_json
		FROM sessions
		WHERE deleted_at IS NULL
		ORDER BY started_at DESC
		LIMIT ? OFFSET ?`, limit, offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []SessionRow
	for rows.Next() {
		r, err := scanSession(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// GetSession returns the session with the given id, or (nil, nil) if
// not found or soft-deleted.
func GetSession(ctx context.Context, db *sql.DB, id string) (*SessionRow, error) {
	row := db.QueryRowContext(ctx, `
		SELECT id, rower_id, started_at, ended_at, initial_level,
		       total_distance_m, total_time_sec, total_strokes, summary_json
		FROM sessions
		WHERE id = ? AND deleted_at IS NULL`, id)
	r, err := scanSession(row)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &r, nil
}

func ListSamples(ctx context.Context, db *sql.DB, sessionID string) ([]SampleRow, error) {
	rows, err := db.QueryContext(ctx, `
		SELECT stroke_no, time_sec, distance_m, spm, power_w, cal_per_hr, level,
		       dps, stroke_cycle_sec, pace_sec_per_500m, energy_joules
		FROM strokes
		WHERE session_id = ?
		ORDER BY stroke_no ASC`, sessionID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []SampleRow
	for rows.Next() {
		var s SampleRow
		if err := rows.Scan(&s.StrokeNo, &s.TimeSec, &s.DistanceM, &s.SPM, &s.PowerW, &s.CalPerHr, &s.Level,
			&s.DPS, &s.StrokeCycleSec, &s.PaceSecPer500m, &s.EnergyJoules); err != nil {
			return nil, err
		}
		out = append(out, s)
	}
	return out, rows.Err()
}

// rowScanner lets scanSession take either *sql.Row or *sql.Rows.
type rowScanner interface {
	Scan(dest ...any) error
}

func scanSession(r rowScanner) (SessionRow, error) {
	var (
		out         SessionRow
		startedStr  string
		endedStr    sql.NullString
		totalDist   sql.NullInt64
		totalTime   sql.NullFloat64
		totalStroke sql.NullInt64
		summaryStr  sql.NullString
	)
	if err := r.Scan(&out.ID, &out.RowerID, &startedStr, &endedStr, &out.InitialLevel,
		&totalDist, &totalTime, &totalStroke, &summaryStr); err != nil {
		return out, err
	}
	t, err := time.Parse(time.RFC3339Nano, startedStr)
	if err != nil {
		return out, err
	}
	out.StartedAt = t
	if endedStr.Valid {
		t, err := time.Parse(time.RFC3339Nano, endedStr.String)
		if err != nil {
			return out, err
		}
		out.EndedAt = &t
	}
	if totalDist.Valid {
		v := int(totalDist.Int64)
		out.TotalDistanceM = &v
	}
	if totalTime.Valid {
		v := totalTime.Float64
		out.TotalTimeSec = &v
	}
	if totalStroke.Valid {
		v := int(totalStroke.Int64)
		out.TotalStrokes = &v
	}
	if summaryStr.Valid && summaryStr.String != "" {
		var s event.SessionSummary
		if err := json.Unmarshal([]byte(summaryStr.String), &s); err != nil {
			return out, err
		}
		out.Summary = &s
	}
	return out, nil
}
```

- [ ] **Step 4: Run — must pass**

```bash
cd backend && go test ./internal/storage/ -v
```

(`SoftDeleteSession` is referenced by tests but lands in the next task — add a stub to unblock compilation. Create a placeholder `backend/internal/storage/soft_delete.go`:

```go
package storage

import (
	"context"
	"database/sql"
	"time"
)

// SoftDeleteSession — real implementation in Task 4. Stub lets reads_test.go compile.
func SoftDeleteSession(ctx context.Context, db *sql.DB, id string, at time.Time) error {
	_, err := db.ExecContext(ctx, `UPDATE sessions SET deleted_at = ? WHERE id = ?`,
		at.UTC().Format(time.RFC3339Nano), id)
	return err
}
```

This stub is already the final behaviour — Task 4 just adds its own tests.)

- [ ] **Step 5: Commit**

```bash
git add backend/internal/storage/reads.go backend/internal/storage/reads_test.go backend/internal/storage/soft_delete.go
git commit -m "feat(backend): sessions + samples read queries"
```

---

## Task 4: Backend — soft-delete test

**Files:**
- Create: `backend/internal/storage/soft_delete_test.go`

The implementation already landed in Task 3 as a stub that happens to be correct. This task formalises it with its own test so future changes don't silently break it.

- [ ] **Step 1: Write the test**

```go
package storage

import (
	"context"
	"path/filepath"
	"testing"
	"time"
)

func TestSoftDeleteSessionSetsTimestamp(t *testing.T) {
	db, _ := Open(filepath.Join(t.TempDir(), "t.db"))
	defer db.Close()
	ctx := context.Background()
	started := time.Date(2026, 4, 21, 10, 0, 0, 0, time.UTC)
	if err := InsertSession(ctx, db.Handle(), "S1", "R1", started, 3); err != nil {
		t.Fatal(err)
	}

	at := time.Date(2026, 4, 21, 12, 0, 0, 0, time.UTC)
	if err := SoftDeleteSession(ctx, db.Handle(), "S1", at); err != nil {
		t.Fatalf("soft delete: %v", err)
	}

	var stored string
	if err := db.Handle().QueryRow(`SELECT deleted_at FROM sessions WHERE id = ?`, "S1").Scan(&stored); err != nil {
		t.Fatal(err)
	}
	if stored == "" {
		t.Errorf("deleted_at empty")
	}
}

func TestSoftDeleteSessionNoopForUnknown(t *testing.T) {
	db, _ := Open(filepath.Join(t.TempDir(), "t.db"))
	defer db.Close()
	if err := SoftDeleteSession(context.Background(), db.Handle(), "nope", time.Now()); err != nil {
		t.Errorf("expected no error for unknown id, got %v", err)
	}
}
```

- [ ] **Step 2: Run — must pass**

```bash
cd backend && go test ./internal/storage/ -v
```

- [ ] **Step 3: Commit**

```bash
git add backend/internal/storage/soft_delete_test.go
git commit -m "test(backend): soft-delete behaviour"
```

---

## Task 5: Backend — sessions HTTP handlers

**Files:**
- Create: `backend/internal/api/sessions.go`
- Create: `backend/internal/api/sessions_test.go`

Four handlers: `GET /api/v1/sessions`, `GET /api/v1/sessions/{id}`, `GET /api/v1/sessions/{id}/samples`, `DELETE /api/v1/sessions/{id}`.

- [ ] **Step 1: Failing test at `backend/internal/api/sessions_test.go`**:

```go
package api

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/gloeckner-daniel/home-ergo/internal/event"
	"github.com/gloeckner-daniel/home-ergo/internal/storage"
)

func seedDB(t *testing.T) *storage.DB {
	t.Helper()
	db, err := storage.Open(filepath.Join(t.TempDir(), "t.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })

	ctx := context.Background()
	started := time.Date(2026, 4, 21, 10, 0, 0, 0, time.UTC)
	if err := storage.InsertSession(ctx, db.Handle(), "S1", "R1", started, 3); err != nil {
		t.Fatal(err)
	}
	for i := 1; i <= 3; i++ {
		p := event.StrokePayload{StrokeNo: i, TimeSec: float64(i), DistanceM: i * 4,
			SPM: 25, PowerW: 200, CalPerHr: 1000, Level: 3,
			DPS: 4, StrokeCycleSec: 1, PaceSecPer500m: 125, EnergyJoules: 200}
		if err := storage.InsertStroke(ctx, db.Handle(), uint64(i), "S1", started, p); err != nil {
			t.Fatal(err)
		}
	}
	if err := storage.UpdateSessionEnd(ctx, db.Handle(), "S1",
		started.Add(time.Minute),
		event.SessionSummary{TotalDistanceM: 12, TotalTimeSec: 3, TotalStrokes: 3,
			AvgPaceSecPer500m: 125}); err != nil {
		t.Fatal(err)
	}
	return db
}

func doReq(t *testing.T, mux http.Handler, method, target string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(method, target, nil)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	return rec
}

func TestGetSessionsList(t *testing.T) {
	db := seedDB(t)
	h := SessionsHandler(db.Handle())

	rec := doReq(t, h, "GET", "/api/v1/sessions")
	if rec.Code != 200 {
		t.Fatalf("status = %d, body=%s", rec.Code, rec.Body.String())
	}
	var body struct {
		Sessions []map[string]any `json:"sessions"`
	}
	_ = json.NewDecoder(rec.Body).Decode(&body)
	if len(body.Sessions) != 1 {
		t.Errorf("got %d sessions", len(body.Sessions))
	}
	if body.Sessions[0]["id"] != "S1" {
		t.Errorf("id = %v", body.Sessions[0]["id"])
	}
}

func TestGetSessionByID(t *testing.T) {
	db := seedDB(t)
	h := SessionsHandler(db.Handle())

	rec := doReq(t, h, "GET", "/api/v1/sessions/S1")
	if rec.Code != 200 {
		t.Fatalf("status = %d", rec.Code)
	}
	body, _ := io.ReadAll(rec.Body)
	if !strings.Contains(string(body), `"id":"S1"`) {
		t.Errorf("body missing id: %s", body)
	}
}

func TestGetSessionByIDNotFound(t *testing.T) {
	db := seedDB(t)
	h := SessionsHandler(db.Handle())

	rec := doReq(t, h, "GET", "/api/v1/sessions/nope")
	if rec.Code != 404 {
		t.Errorf("status = %d, want 404", rec.Code)
	}
}

func TestGetSessionSamples(t *testing.T) {
	db := seedDB(t)
	h := SessionsHandler(db.Handle())

	rec := doReq(t, h, "GET", "/api/v1/sessions/S1/samples")
	if rec.Code != 200 {
		t.Fatalf("status = %d", rec.Code)
	}
	var body struct {
		Samples []map[string]any `json:"samples"`
	}
	_ = json.NewDecoder(rec.Body).Decode(&body)
	if len(body.Samples) != 3 {
		t.Errorf("got %d samples", len(body.Samples))
	}
}

func TestDeleteSessionSoftDeletes(t *testing.T) {
	db := seedDB(t)
	h := SessionsHandler(db.Handle())

	rec := doReq(t, h, "DELETE", "/api/v1/sessions/S1")
	if rec.Code != 204 {
		t.Errorf("status = %d, want 204", rec.Code)
	}

	// Subsequent GET should 404 (soft-deleted is hidden).
	rec = doReq(t, h, "GET", "/api/v1/sessions/S1")
	if rec.Code != 404 {
		t.Errorf("after delete, GET status = %d, want 404", rec.Code)
	}

	// And it drops out of the list.
	rec = doReq(t, h, "GET", "/api/v1/sessions")
	var body struct {
		Sessions []map[string]any `json:"sessions"`
	}
	_ = json.NewDecoder(rec.Body).Decode(&body)
	if len(body.Sessions) != 0 {
		t.Errorf("soft-deleted session still in list")
	}
}
```

- [ ] **Step 2: Run — must fail**

```bash
cd backend && go test ./internal/api/ -run "TestGet|TestDelete" -v
```

- [ ] **Step 3: Implement at `backend/internal/api/sessions.go`**:

```go
package api

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"strconv"
	"time"

	"github.com/gloeckner-daniel/home-ergo/internal/storage"
)

// SessionsHandler returns a mux handling every session-read endpoint.
// Auth is a middleware concern — this handler assumes the request has
// been authenticated (ARCH-0001 M1 note: rower stub).
func SessionsHandler(db *sql.DB) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/v1/sessions", listSessions(db))
	mux.HandleFunc("GET /api/v1/sessions/{id}", getSession(db))
	mux.HandleFunc("GET /api/v1/sessions/{id}/samples", getSamples(db))
	mux.HandleFunc("DELETE /api/v1/sessions/{id}", deleteSession(db))
	return mux
}

func listSessions(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		limit := intQuery(r, "limit", 50)
		offset := intQuery(r, "offset", 0)
		rows, err := storage.ListSessions(r.Context(), db, limit, offset)
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

func getSession(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		row, err := storage.GetSession(r.Context(), db, id)
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

func getSamples(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		// Confirm session exists (and is not deleted) before we enumerate rows.
		row, err := storage.GetSession(r.Context(), db, id)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		if row == nil {
			http.NotFound(w, r)
			return
		}
		samples, err := storage.ListSamples(r.Context(), db, id)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		if samples == nil {
			samples = []storage.SampleRow{}
		}
		writeJSON(w, http.StatusOK, map[string]any{"samples": samples})
	}
}

func deleteSession(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		if err := storage.SoftDeleteSession(r.Context(), db, id, time.Now().UTC()); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

func intQuery(r *http.Request, key string, def int) int {
	if s := r.URL.Query().Get(key); s != "" {
		if v, err := strconv.Atoi(s); err == nil {
			return v
		}
	}
	return def
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}
```

- [ ] **Step 4: Run — must pass**

```bash
cd backend && go test ./internal/api/ -v
```

- [ ] **Step 5: Commit**

```bash
git add backend/internal/api/sessions.go backend/internal/api/sessions_test.go
git commit -m "feat(backend): GET/DELETE /api/v1/sessions[/{id}[/samples]]"
```

---

## Task 6: Backend — wire routes into the main router

**Files:**
- Modify: `backend/internal/api/router.go`
- Modify: `backend/cmd/homeergo/main.go`

`SessionsHandler` needs a `*sql.DB`. Add it to `api.Inputs` and pass the DB from `main`.

- [ ] **Step 1: Extend `Inputs`**

Edit `backend/internal/api/router.go`:

```go
package api

import (
	"database/sql"
	"net/http"
	"time"

	"github.com/gloeckner-daniel/home-ergo/internal/pipeline"
	"github.com/gloeckner-daniel/home-ergo/internal/stream"
)

type Inputs struct {
	Ring        *pipeline.Ring
	Broadcaster *stream.Broadcaster
	DB          *sql.DB
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

	mux.Handle("GET /debug/ingest", DebugIngestHandler(DebugIngestInputs{
		Ring:        in.Ring,
		Broadcaster: in.Broadcaster,
		StartedAt:   in.StartedAt,
	}))
	return Chain(mux, Recover(), Logging())
}
```

- [ ] **Step 2: Pass the DB handle from main**

Edit `backend/cmd/homeergo/main.go`. Replace the `api.NewRouter(api.Inputs{…})` call with:

```go
Handler: api.NewRouter(api.Inputs{
    Ring:        ring,
    Broadcaster: bcast,
    DB:          db.Handle(),
    StartedAt:   time.Now(),
}),
```

- [ ] **Step 3: Update the `health_test.go` helper that builds a router — it also needs a DB now**

In `backend/internal/api/health_test.go` (or `api_test` package), wherever `api.NewRouter(api.Inputs{…})` is constructed, add:

```go
db, _ := storage.Open(filepath.Join(t.TempDir(), "t.db"))
t.Cleanup(func() { db.Close() })
```

and pass `DB: db.Handle()`. Add `"path/filepath"` + `"github.com/gloeckner-daniel/home-ergo/internal/storage"` imports.

- [ ] **Step 4: Build + test**

```bash
cd backend && go build ./... && go test ./...
```

Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add backend/internal/api/router.go backend/internal/api/health_test.go backend/cmd/homeergo/main.go
git commit -m "feat(backend): wire sessions handlers into router"
```

---

## Task 7: Frontend — API client

**Files:**
- Create: `web/src/api/client.ts`
- Create: `web/src/api/client.test.ts`

One fetcher per endpoint. Types mirror the backend's JSON shape.

- [ ] **Step 1: Write `client.ts`**

```ts
export type SessionSummary = {
  total_distance_m: number
  total_time_sec: number
  total_strokes: number
  avg_power_w: number
  peak_power_w: number
  avg_spm: number
  avg_dps: number
  avg_pace_sec_per_500m: number
  session_calories: number
}

export type SessionRow = {
  id: string
  rower_id: string
  started_at: string
  ended_at?: string
  initial_level: number
  total_distance_m?: number
  total_time_sec?: number
  total_strokes?: number
  summary?: SessionSummary
}

export type Sample = {
  stroke_no: number
  time_sec: number
  distance_m: number
  spm: number
  power_w: number
  cal_per_hr: number
  level: number
  dps: number
  stroke_cycle_sec: number
  pace_sec_per_500m: number
  energy_joules: number
}

async function json<T>(r: Response): Promise<T> {
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}`)
  return (await r.json()) as T
}

export async function listSessions(limit = 50, offset = 0): Promise<SessionRow[]> {
  const r = await fetch(`/api/v1/sessions?limit=${limit}&offset=${offset}`)
  const body = await json<{ sessions: SessionRow[] }>(r)
  return body.sessions
}

export async function getSession(id: string): Promise<SessionRow> {
  const r = await fetch(`/api/v1/sessions/${encodeURIComponent(id)}`)
  return json<SessionRow>(r)
}

export async function getSamples(id: string): Promise<Sample[]> {
  const r = await fetch(`/api/v1/sessions/${encodeURIComponent(id)}/samples`)
  const body = await json<{ samples: Sample[] }>(r)
  return body.samples
}

export async function deleteSession(id: string): Promise<void> {
  const r = await fetch(`/api/v1/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' })
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}`)
}
```

- [ ] **Step 2: Test at `client.test.ts`**

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { listSessions, getSession, getSamples, deleteSession } from './client'

const realFetch = global.fetch

function mockFetch(impl: (url: RequestInfo | URL, init?: RequestInit) => Promise<Response>) {
  ;(global as unknown as { fetch: typeof fetch }).fetch = vi.fn(impl) as unknown as typeof fetch
}

beforeEach(() => {
  mockFetch(async () => new Response(JSON.stringify({}), { status: 200 }))
})

afterEach(() => {
  ;(global as unknown as { fetch: typeof fetch }).fetch = realFetch
})

describe('api client', () => {
  it('listSessions requests /api/v1/sessions and unwraps the envelope', async () => {
    mockFetch(async (url) => {
      expect(String(url)).toBe('/api/v1/sessions?limit=50&offset=0')
      return new Response(JSON.stringify({ sessions: [{ id: 'S1', rower_id: 'R', started_at: '2026-04-21T10:00:00Z', initial_level: 3 }] }), { status: 200 })
    })
    const out = await listSessions()
    expect(out).toHaveLength(1)
    expect(out[0].id).toBe('S1')
  })

  it('getSession fetches and returns the row', async () => {
    mockFetch(async (url) => {
      expect(String(url)).toBe('/api/v1/sessions/S1')
      return new Response(JSON.stringify({ id: 'S1', rower_id: 'R', started_at: '2026-04-21T10:00:00Z', initial_level: 3 }), { status: 200 })
    })
    const out = await getSession('S1')
    expect(out.id).toBe('S1')
  })

  it('getSession throws on 404', async () => {
    mockFetch(async () => new Response('', { status: 404, statusText: 'Not Found' }))
    await expect(getSession('nope')).rejects.toThrow(/404/)
  })

  it('getSamples unwraps samples envelope', async () => {
    mockFetch(async (url) => {
      expect(String(url)).toBe('/api/v1/sessions/S1/samples')
      return new Response(JSON.stringify({ samples: [{ stroke_no: 1 }] }), { status: 200 })
    })
    const out = await getSamples('S1')
    expect(out[0].stroke_no).toBe(1)
  })

  it('deleteSession resolves on 204', async () => {
    mockFetch(async () => new Response('', { status: 204 }))
    await expect(deleteSession('S1')).resolves.toBeUndefined()
  })
})
```

- [ ] **Step 3: Run**

```bash
cd web && npm test -- api/client
```

Expected: 5 green.

- [ ] **Step 4: Commit**

```bash
git add web/src/api/client.ts web/src/api/client.test.ts
git commit -m "feat(web): typed API client for sessions read/delete"
```

---

## Task 8: Frontend — date formatter utility

**Files:**
- Create: `web/src/util/dates.ts`
- Create: `web/src/util/dates.test.ts`

Single helper: format an ISO timestamp as a compact German list-row label.

- [ ] **Step 1: Failing test**

```ts
import { describe, it, expect } from 'vitest'
import { formatSessionStart } from './dates'

const now = new Date('2026-04-21T15:00:00Z')

describe('formatSessionStart', () => {
  it('today formats as "Heute <HH:MM>"', () => {
    expect(formatSessionStart('2026-04-21T10:30:00Z', now)).toBe('Heute 10:30')
  })

  it('yesterday formats as "Gestern <HH:MM>"', () => {
    expect(formatSessionStart('2026-04-20T08:00:00Z', now)).toBe('Gestern 08:00')
  })

  it('within the last 7 days formats as "<Weekday> <HH:MM>"', () => {
    // 2026-04-21 is a Tuesday → 2026-04-18 is Saturday.
    expect(formatSessionStart('2026-04-18T11:00:00Z', now)).toMatch(/^(Mo|Di|Mi|Do|Fr|Sa|So) 11:00$/)
  })

  it('older than 7 days formats as DD.MM.YYYY HH:MM', () => {
    expect(formatSessionStart('2025-12-25T14:05:00Z', now)).toBe('25.12.2025 14:05')
  })
})
```

- [ ] **Step 2: Implement**

```ts
const WEEKDAY_DE = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa']

function hhmm(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

export function formatSessionStart(isoStr: string, now: Date = new Date()): string {
  const d = new Date(isoStr)
  if (sameDay(d, now)) return `Heute ${hhmm(d)}`
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  if (sameDay(d, yesterday)) return `Gestern ${hhmm(d)}`

  const ageDays = Math.floor((now.getTime() - d.getTime()) / 86_400_000)
  if (ageDays < 7 && ageDays > 0) {
    return `${WEEKDAY_DE[d.getDay()]} ${hhmm(d)}`
  }

  return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()} ${hhmm(d)}`
}
```

- [ ] **Step 3: Run — must pass**

```bash
cd web && npm test -- util/dates
```

- [ ] **Step 4: Commit**

```bash
git add web/src/util/dates.ts web/src/util/dates.test.ts
git commit -m "feat(web): formatSessionStart helper (Heute/Gestern/weekday/full)"
```

---

## Task 9: Frontend — LineChart primitive

**Files:**
- Create: `web/src/components/LineChart/LineChart.tsx`
- Create: `web/src/components/LineChart/LineChart.module.css`
- Create: `web/src/components/LineChart/LineChart.test.tsx`

A larger-canvas chart that reuses the Sparkline math. Adds:
- title label above the chart
- y-axis min/max labels on the right
- fixed viewBox 300×120 (the Sparkline's 100×40 is too small for detail pages)

- [ ] **Step 1: Write the failing test**

```tsx
import { render } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { LineChart } from './LineChart'

describe('LineChart', () => {
  it('renders title + an SVG path when data has ≥ 2 points', () => {
    const { container } = render(
      <LineChart
        title="Watt"
        points={[
          { x: 0, y: 200 },
          { x: 10, y: 210 },
          { x: 20, y: 195 },
        ]}
      />,
    )
    expect(container.querySelector('path')).not.toBeNull()
    expect(container.textContent).toContain('Watt')
  })

  it('renders empty state when points are empty', () => {
    const { container } = render(<LineChart title="Watt" points={[]} />)
    expect(container.querySelectorAll('path').length).toBe(0)
    expect(container.textContent).toContain('Keine Daten')
  })

  it('renders a dot when only one point is given', () => {
    const { container } = render(<LineChart title="Watt" points={[{ x: 0, y: 42 }]} />)
    expect(container.querySelector('circle')).not.toBeNull()
  })
})
```

- [ ] **Step 2: CSS at `LineChart.module.css`**

```css
.wrap {
  display: grid;
  gap: var(--space-1);
  background: var(--color-surface-container);
  border-radius: var(--radius-card);
  padding: var(--space-2);
}

.header {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
}

.title {
  color: var(--color-on-surface-variant);
}

.range {
  color: var(--color-on-surface-variant);
  font-family: var(--font-body);
  font-size: var(--text-label-sm);
  font-variant-numeric: tabular-nums;
}

.svg {
  width: 100%;
  height: 120px;
  display: block;
}

.line {
  fill: none;
  stroke: var(--color-primary);
  stroke-width: 1.5;
  stroke-linejoin: round;
  stroke-linecap: round;
}

.dot {
  fill: var(--color-primary);
}

.empty {
  height: 120px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--color-on-surface-variant);
  font-family: var(--font-body);
  font-size: var(--text-label-sm);
}
```

- [ ] **Step 3: Implement `LineChart.tsx`**

```tsx
import styles from './LineChart.module.css'

const WIDTH = 300
const HEIGHT = 120

export type Point = { x: number; y: number }

type Props = {
  title: string
  points: Point[]
  /** Optional formatter for the y-axis min/max labels (e.g. `mmss`). */
  fmt?: (v: number) => string
}

export function LineChart({ title, points, fmt = (v) => String(Math.round(v)) }: Props) {
  if (points.length === 0) {
    return (
      <section className={styles.wrap}>
        <header className={styles.header}>
          <span className={`label-sm ${styles.title}`}>{title}</span>
        </header>
        <div className={styles.empty}>Keine Daten</div>
      </section>
    )
  }

  const xs = points.map((p) => p.x)
  const ys = points.map((p) => p.y)
  const xMin = Math.min(...xs)
  const xMax = Math.max(...xs)
  const xSpan = Math.max(1, xMax - xMin)
  const yMin = Math.min(...ys)
  const yMax = Math.max(...ys)
  const ySpan = Math.max(1, yMax - yMin)

  const toX = (x: number) => ((x - xMin) / xSpan) * WIDTH
  const toY = (y: number) => HEIGHT - ((y - yMin) / ySpan) * HEIGHT

  return (
    <section className={styles.wrap}>
      <header className={styles.header}>
        <span className={`label-sm ${styles.title}`}>{title}</span>
        <span className={styles.range}>
          {fmt(yMin)} — {fmt(yMax)}
        </span>
      </header>
      <svg className={styles.svg} viewBox={`0 0 ${WIDTH} ${HEIGHT}`} preserveAspectRatio="none">
        {points.length === 1 ? (
          <circle className={styles.dot} cx={toX(points[0].x)} cy={toY(points[0].y)} r={3} />
        ) : (
          <path
            className={styles.line}
            d={points
              .map((p, i) => `${i === 0 ? 'M' : 'L'} ${toX(p.x).toFixed(2)} ${toY(p.y).toFixed(2)}`)
              .join(' ')}
          />
        )}
      </svg>
    </section>
  )
}
```

- [ ] **Step 4: Run — must pass**

```bash
cd web && npm test -- LineChart
```

- [ ] **Step 5: Commit**

```bash
git add web/src/components/LineChart
git commit -m "feat(web): LineChart primitive (title + range labels)"
```

---

## Task 10: Frontend — HistoryPage list

**Files:**
- Overwrite: `web/src/pages/HistoryPage.tsx`
- Create: `web/src/pages/HistoryPage.module.css`
- Create: `web/src/pages/HistoryPage.test.tsx`

Replace the placeholder with a real list: one row per session showing `formatSessionStart`, distance, time, average split. Tap pushes `/historie/:id`.

- [ ] **Step 1: CSS at `HistoryPage.module.css`**

```css
.page {
  padding: var(--space-3);
  display: grid;
  gap: var(--space-2);
}

.empty {
  padding: var(--space-4) var(--space-3);
  color: var(--color-on-surface-variant);
  text-align: center;
}

.list {
  display: grid;
  gap: var(--space-1);
}

.row {
  display: grid;
  grid-template-columns: 1fr auto auto auto;
  gap: var(--space-2);
  padding: var(--space-2);
  background: var(--color-surface-container);
  border-radius: var(--radius-card);
  color: var(--color-on-surface);
  text-decoration: none;
  align-items: baseline;
  transition: background-color var(--motion-state) var(--motion-ease);
}

.row:hover {
  background: var(--color-surface-container-high);
}

.when {
  font-family: var(--font-display);
  font-size: var(--text-title-md);
}

.pill {
  font-family: var(--font-display);
  font-size: var(--text-body-lg);
  font-variant-numeric: tabular-nums;
  color: var(--color-on-surface-variant);
}

.pillStrong {
  color: var(--color-primary);
}

.more {
  justify-self: center;
}
```

- [ ] **Step 2: Implement `HistoryPage.tsx`**

```tsx
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { listSessions, type SessionRow } from '../api/client'
import { formatSessionStart } from '../util/dates'
import { fmtMeters, mmss, pace500m } from '../util/format'
import styles from './HistoryPage.module.css'

export function HistoryPage() {
  const { data, isPending, error } = useQuery<SessionRow[]>({
    queryKey: ['sessions', 'list'],
    queryFn: () => listSessions(50, 0),
  })

  if (isPending) {
    return (
      <div className={styles.page}>
        <h1 className="headline-sm">Historie</h1>
        <p className={styles.empty}>Lädt …</p>
      </div>
    )
  }
  if (error) {
    return (
      <div className={styles.page}>
        <h1 className="headline-sm">Historie</h1>
        <p className={styles.empty}>Konnte Sessions nicht laden.</p>
      </div>
    )
  }

  if (!data || data.length === 0) {
    return (
      <div className={styles.page}>
        <h1 className="headline-sm">Historie</h1>
        <p className={styles.empty}>
          Noch keine Sessions. Rudere eine Session und sie erscheint hier.
        </p>
      </div>
    )
  }

  return (
    <div className={styles.page}>
      <h1 className="headline-sm">Historie</h1>
      <div className={styles.list}>
        {data.map((s) => (
          <Link key={s.id} to={`/historie/${s.id}`} className={styles.row}>
            <span className={styles.when}>{formatSessionStart(s.started_at)}</span>
            <span className={styles.pill}>{fmtMeters(s.total_distance_m ?? null)} m</span>
            <span className={styles.pill}>{mmss(s.total_time_sec ?? null)}</span>
            <span className={`${styles.pill} ${styles.pillStrong}`}>
              {pace500m(s.summary?.avg_pace_sec_per_500m ?? null)}
            </span>
          </Link>
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Component test at `HistoryPage.test.tsx`**

```tsx
import { render, screen, waitFor } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { HistoryPage } from './HistoryPage'

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>
  )
}

describe('HistoryPage', () => {
  it('renders an empty state when backend returns no sessions', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ sessions: [] }), { status: 200 })),
    )
    render(wrap(<HistoryPage />))
    await waitFor(() => expect(screen.getByText(/Noch keine Sessions/)).toBeInTheDocument())
  })

  it('renders one row per returned session', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              sessions: [
                {
                  id: 'S1',
                  rower_id: 'R',
                  started_at: new Date().toISOString(),
                  initial_level: 3,
                  total_distance_m: 1035,
                  total_time_sec: 284,
                  summary: { avg_pace_sec_per_500m: 137 },
                },
              ],
            }),
            { status: 200 },
          ),
      ),
    )
    render(wrap(<HistoryPage />))
    await waitFor(() => expect(screen.getByText(/Heute \d{2}:\d{2}/)).toBeInTheDocument())
    expect(screen.getByText('1035 m')).toBeInTheDocument()
  })
})
```

- [ ] **Step 4: Run**

```bash
cd web && npm test -- HistoryPage
```

- [ ] **Step 5: Commit**

```bash
git add web/src/pages/HistoryPage.tsx web/src/pages/HistoryPage.module.css web/src/pages/HistoryPage.test.tsx
git commit -m "feat(web): HistoryPage list with TanStack Query"
```

---

## Task 11: Frontend — SessionDetailPage

**Files:**
- Create: `web/src/pages/SessionDetailPage.tsx`
- Create: `web/src/pages/SessionDetailPage.module.css`
- Create: `web/src/pages/SessionDetailPage.test.tsx`

Hero summary (distance, time, averages) + three stacked LineCharts (Split, Watt, SPM) + a Delete button.

- [ ] **Step 1: CSS at `SessionDetailPage.module.css`**

```css
.page {
  padding: var(--space-3);
  display: grid;
  gap: var(--space-3);
}

.hero {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--space-3);
  padding: var(--space-3);
  background: var(--color-surface-container-low);
  border-radius: var(--radius-card);
}

.heroMain {
  display: grid;
  gap: var(--space-1);
}

.heroLabel {
  color: var(--color-on-surface-variant);
}

.heroValue {
  font-family: var(--font-display);
  font-size: 32px;
  line-height: 1.1;
  color: var(--color-on-surface);
  font-variant-numeric: tabular-nums;
}

.heroSecondary {
  display: grid;
  gap: var(--space-1);
  align-content: center;
}

.heroSecondaryRow {
  display: flex;
  justify-content: space-between;
  gap: var(--space-2);
}

.heroSecondaryKey {
  color: var(--color-on-surface-variant);
}

.heroSecondaryValue {
  font-family: var(--font-display);
  font-variant-numeric: tabular-nums;
}

.charts {
  display: grid;
  gap: var(--space-2);
}

.actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-2);
}

.deleteBtn {
  background: transparent;
  color: var(--color-error);
  padding: var(--space-1) var(--space-2);
  border-radius: var(--radius-button);
  font-family: var(--font-display);
  font-size: var(--text-title-md);
}

.deleteBtn:hover {
  background: var(--color-surface-container-high);
}

.back {
  justify-self: start;
  color: var(--color-on-surface-variant);
  font-family: var(--font-body);
  font-size: var(--text-body-lg);
  text-decoration: none;
}
```

- [ ] **Step 2: Implement `SessionDetailPage.tsx`**

```tsx
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { deleteSession, getSamples, getSession, type Sample, type SessionRow } from '../api/client'
import { LineChart } from '../components/LineChart/LineChart'
import { fmtFloat, fmtInt, fmtMeters, mmss, pace500m } from '../util/format'
import { formatSessionStart } from '../util/dates'
import styles from './SessionDetailPage.module.css'

export function SessionDetailPage() {
  const { sessionId = '' } = useParams()
  const navigate = useNavigate()
  const qc = useQueryClient()

  const sessionQ = useQuery<SessionRow>({
    queryKey: ['sessions', sessionId],
    queryFn: () => getSession(sessionId),
    enabled: sessionId !== '',
  })
  const samplesQ = useQuery<Sample[]>({
    queryKey: ['sessions', sessionId, 'samples'],
    queryFn: () => getSamples(sessionId),
    enabled: sessionId !== '',
  })
  const deleteM = useMutation({
    mutationFn: () => deleteSession(sessionId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sessions'] })
      navigate('/historie', { replace: true })
    },
  })

  if (sessionQ.isPending) {
    return <div className={styles.page}>Lädt …</div>
  }
  if (sessionQ.error || !sessionQ.data) {
    return (
      <div className={styles.page}>
        <Link to="/historie" className={styles.back}>
          ← Zurück
        </Link>
        <p>Session nicht gefunden.</p>
      </div>
    )
  }

  const s = sessionQ.data
  const samples = samplesQ.data ?? []

  const splitPts = samples.map((x) => ({ x: x.time_sec, y: x.pace_sec_per_500m })).filter((p) => p.y > 0)
  const wattPts = samples.map((x) => ({ x: x.time_sec, y: x.power_w }))
  const spmPts = samples.map((x) => ({ x: x.time_sec, y: x.spm }))

  return (
    <div className={styles.page}>
      <Link to="/historie" className={styles.back}>
        ← Zurück
      </Link>

      <section className={styles.hero}>
        <div className={styles.heroMain}>
          <span className={`label-sm ${styles.heroLabel}`}>{formatSessionStart(s.started_at)}</span>
          <span className={styles.heroValue}>{fmtMeters(s.total_distance_m ?? null)} m</span>
          <span className={styles.heroValue}>{mmss(s.total_time_sec ?? null)}</span>
        </div>
        <div className={styles.heroSecondary}>
          <div className={styles.heroSecondaryRow}>
            <span className={`label-sm ${styles.heroSecondaryKey}`}>Ø Split</span>
            <span className={styles.heroSecondaryValue}>
              {pace500m(s.summary?.avg_pace_sec_per_500m ?? null)}
            </span>
          </div>
          <div className={styles.heroSecondaryRow}>
            <span className={`label-sm ${styles.heroSecondaryKey}`}>Ø SPM</span>
            <span className={styles.heroSecondaryValue}>
              {fmtFloat(s.summary?.avg_spm ?? null, 1)}
            </span>
          </div>
          <div className={styles.heroSecondaryRow}>
            <span className={`label-sm ${styles.heroSecondaryKey}`}>Ø Watt</span>
            <span className={styles.heroSecondaryValue}>{fmtInt(s.summary?.avg_power_w ?? null)}</span>
          </div>
          <div className={styles.heroSecondaryRow}>
            <span className={`label-sm ${styles.heroSecondaryKey}`}>Schläge</span>
            <span className={styles.heroSecondaryValue}>{fmtInt(s.total_strokes ?? null)}</span>
          </div>
        </div>
      </section>

      <div className={styles.charts}>
        <LineChart title="Split-Verlauf (s / 500 m)" points={splitPts} fmt={(v) => mmss(v)} />
        <LineChart title="Watt-Verlauf" points={wattPts} />
        <LineChart title="SPM-Verlauf" points={spmPts} />
      </div>

      <div className={styles.actions}>
        <button
          className={styles.deleteBtn}
          onClick={() => {
            if (confirm('Diese Session löschen?')) deleteM.mutate()
          }}
          disabled={deleteM.isPending}
        >
          Löschen
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Component test at `SessionDetailPage.test.tsx`**

```tsx
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { SessionDetailPage } from './SessionDetailPage'

function wrap(initial = '/historie/S1') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[initial]}>
        <Routes>
          <Route path="/historie" element={<p>Historie</p>} />
          <Route path="/historie/:sessionId" element={<SessionDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  )
}

function mockFetch(handlers: Record<string, (init?: RequestInit) => Response>) {
  return vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    const key = String(url)
    for (const [pattern, fn] of Object.entries(handlers)) {
      if (key === pattern || key.startsWith(pattern)) return fn(init)
    }
    return new Response('', { status: 404 })
  })
}

const SESSION = {
  id: 'S1',
  rower_id: 'R',
  started_at: new Date().toISOString(),
  initial_level: 3,
  total_distance_m: 1035,
  total_time_sec: 284,
  total_strokes: 124,
  summary: {
    total_distance_m: 1035,
    total_time_sec: 284,
    total_strokes: 124,
    avg_power_w: 259,
    peak_power_w: 322,
    avg_spm: 26.3,
    avg_dps: 8.35,
    avg_pace_sec_per_500m: 137,
    session_calories: 112,
  },
}

const SAMPLES = [
  { stroke_no: 1, time_sec: 2, distance_m: 8, spm: 25, power_w: 200, cal_per_hr: 1000, level: 3, dps: 8, stroke_cycle_sec: 2, pace_sec_per_500m: 125, energy_joules: 400 },
  { stroke_no: 2, time_sec: 4, distance_m: 16, spm: 27, power_w: 220, cal_per_hr: 1000, level: 3, dps: 8, stroke_cycle_sec: 2, pace_sec_per_500m: 125, energy_joules: 440 },
]

describe('SessionDetailPage', () => {
  it('renders hero + three charts for a session', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch({
        '/api/v1/sessions/S1/samples': () => new Response(JSON.stringify({ samples: SAMPLES }), { status: 200 }),
        '/api/v1/sessions/S1': () => new Response(JSON.stringify(SESSION), { status: 200 }),
      }),
    )
    render(wrap())
    await waitFor(() => expect(screen.getByText('1035 m')).toBeInTheDocument())
    expect(screen.getByText(/Split-Verlauf/)).toBeInTheDocument()
    expect(screen.getByText(/Watt-Verlauf/)).toBeInTheDocument()
    expect(screen.getByText(/SPM-Verlauf/)).toBeInTheDocument()
  })

  it('delete button navigates back on success', async () => {
    const fetchMock = mockFetch({
      '/api/v1/sessions/S1/samples': () => new Response(JSON.stringify({ samples: SAMPLES }), { status: 200 }),
      '/api/v1/sessions/S1': (init) => {
        if (init?.method === 'DELETE') return new Response('', { status: 204 })
        return new Response(JSON.stringify(SESSION), { status: 200 })
      },
    })
    vi.stubGlobal('fetch', fetchMock)
    vi.spyOn(window, 'confirm').mockReturnValue(true)

    render(wrap())
    await waitFor(() => expect(screen.getByText('1035 m')).toBeInTheDocument())
    await userEvent.click(screen.getByRole('button', { name: 'Löschen' }))
    await waitFor(() => expect(screen.getByText('Historie')).toBeInTheDocument())
  })
})
```

- [ ] **Step 4: Run**

```bash
cd web && npm test -- SessionDetailPage
```

- [ ] **Step 5: Commit**

```bash
git add web/src/pages/SessionDetailPage.tsx web/src/pages/SessionDetailPage.module.css web/src/pages/SessionDetailPage.test.tsx
git commit -m "feat(web): SessionDetailPage with hero + three charts + delete"
```

---

## Task 12: Frontend — register the detail route

**Files:**
- Modify: `web/src/app/AppRouter.tsx`

- [ ] **Step 1: Add the route**

Edit `web/src/app/AppRouter.tsx`. Inside the `<Routes>` block, alongside the existing `HistoryPage` route, add:

```tsx
<Route path="/historie/:sessionId" element={<SessionDetailPage />} />
```

Import `SessionDetailPage` at the top of the file. Keep the existing `/historie` route pointing to `HistoryPage`.

- [ ] **Step 2: Run tests + build**

```bash
cd web && npm run typecheck && npm test && npm run build
```

- [ ] **Step 3: Commit**

```bash
git add web/src/app/AppRouter.tsx
git commit -m "feat(web): register /historie/:sessionId route"
```

---

## Task 13: Playwright smoke for history flow

**Files:**
- Create: `web/tests/e2e/history.spec.ts`

Spawns the Go backend with a fast-mode fixture, waits for a session to complete (EOF → session_end → persisted), then opens `/historie`, clicks the row, asserts detail charts render.

- [ ] **Step 1: Write the spec**

```ts
import { test, expect } from '@playwright/test'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let backend: ChildProcessWithoutNullStreams | null = null

test.beforeAll(async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'homeergo-e2e-history-'))
  backend = spawn('go', ['run', './cmd/homeergo'], {
    cwd: join(process.cwd(), '..', 'backend'),
    env: {
      ...process.env,
      HOMEERGO_ADDR: ':8080',
      HOMEERGO_DB_PATH: join(tmp, 'e2e.db'),
      HOMEERGO_FIXTURE: '../specs/int/fixtures/ipm/session-short.csv',
      HOMEERGO_FIXTURE_RATE: 'fast',
      HOMEERGO_IDLE_TIMEOUT: '1s',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  backend.stderr?.on('data', (d) => process.stderr.write(`[be] ${d}`))

  const deadline = Date.now() + 60_000
  while (Date.now() < deadline) {
    try {
      const r = await fetch('http://localhost:8080/api/health')
      if (r.ok) break
    } catch {
      /* wait */
    }
    await new Promise((r) => setTimeout(r, 100))
  }

  // Wait for at least one completed session to land in SQLite (fixture
  // EOF → session_end → persister). With IdleTimeout 1 s and fast
  // pacing, the fixture finishes + closes the session within a few s.
  for (let i = 0; i < 100; i++) {
    const r = await fetch('http://localhost:8080/api/v1/sessions')
    const body = (await r.json()) as { sessions: { ended_at?: string }[] }
    if (body.sessions.some((s) => s.ended_at)) return
    await new Promise((r) => setTimeout(r, 200))
  }
  throw new Error('no completed session appeared')
})

test.afterAll(() => {
  backend?.kill('SIGINT')
  backend = null
})

test('history list shows a completed session; detail page renders charts', async ({ page }) => {
  await page.goto('/historie')
  const firstRow = page.locator('a[href^="/historie/"]').first()
  await expect(firstRow).toBeVisible({ timeout: 10_000 })
  await firstRow.click()
  await expect(page.getByText(/Split-Verlauf/)).toBeVisible({ timeout: 10_000 })
  await expect(page.getByText(/Watt-Verlauf/)).toBeVisible()
  await expect(page.getByText(/SPM-Verlauf/)).toBeVisible()
})
```

- [ ] **Step 2: Run**

```bash
cd web && npm run e2e -- history
```

Expected: the test passes. If port 8080 is occupied, free it first.

- [ ] **Step 3: Commit**

```bash
git add web/tests/e2e/history.spec.ts
git commit -m "test(web): e2e history list + detail flow"
```

---

## Task 14: Docs + roadmap

**Files:**
- Modify: `ROADMAP.md`
- Modify: `backend/README.md`

- [ ] **Step 1: Roadmap**

Under `## M3 — Persistence & users`, add:

```
- [x] History read API + list/detail UI shipped (plan `docs/plans/2026-04-21-history-read-ui.md`) — soft-delete column live; filter chips, trends sub-tab, exports deferred.
```

- [ ] **Step 2: Backend README — append to the "Routes" or add a new "API" section**

```markdown
## HTTP API

| Method | Path                                 | Purpose                                     |
|--------|--------------------------------------|---------------------------------------------|
| GET    | `/api/health`                        | Liveness                                    |
| GET    | `/api/v1/stream`                     | SSE live stream (INT-0002)                  |
| GET    | `/api/v1/sessions?limit=&offset=`    | List non-deleted sessions, newest first     |
| GET    | `/api/v1/sessions/{id}`              | Detail (summary + totals)                   |
| GET    | `/api/v1/sessions/{id}/samples`      | Per-stroke series for charts                |
| DELETE | `/api/v1/sessions/{id}`              | Soft-delete                                  |
| GET    | `/debug/ingest`                      | Pipeline health (LAN-only, unauthed in v1)  |
```

- [ ] **Step 3: Commit**

```bash
git add ROADMAP.md backend/README.md
git commit -m "docs: history read + API table"
```

---

## Task 15: Final verification

- [ ] **Step 1: Run the full chain**

```bash
cd backend && go vet ./... && go test ./...
cd ../web && npm run typecheck && npm run lint && npm test && npm run build && npm run e2e
```

Expected: every step green.

- [ ] **Step 2: Manual dev smoke**

Terminal 1:

```bash
cd backend && HOMEERGO_FIXTURE=../specs/int/fixtures/ipm/session-short.csv HOMEERGO_FIXTURE_RATE=fast HOMEERGO_IDLE_TIMEOUT=1s HOMEERGO_DB_PATH=./dev.db go run ./cmd/homeergo
```

Terminal 2:

```bash
cd web && npm run dev
```

Visit `http://localhost:5173/historie`. Confirm:
- At least one row appears once the fixture completes.
- Tap row → detail page with hero totals and three charts.
- `Löschen` → row disappears from list.
- `sqlite3 backend/dev.db 'select id, deleted_at from sessions'` shows the soft-deleted row has a non-null `deleted_at`.

- [ ] **Step 3: Commit anything that changed during the smoke**

```bash
git status
# commit only if the smoke surfaced a bug that required a fix
```

---

## Self-Review Notes

- **Spec coverage:**
  - **FEAT-0003** list + detail + soft-delete acceptance criteria: auto-save (done in M3), 60 s idle boundary (done in M3), per-tick sample series (done in M3), list view paginates (this plan, offset/limit), detail renders charts per metric (this plan), deleting is reversible for 7 days (**partial**: `deleted_at` column + read filter land here; a restore endpoint + UI is deferred). User + date filters are **deferred** with other FEAT-0003a scope.
  - **FEAT-0003a Sessions sub-tab**: first slice only. No filter chips, no summary strip, no PB badges, no long-press menu, no infinite scroll, no splits-table. All explicitly listed under "Out of scope".
  - **FEAT-0003a Trends sub-tab**: entirely deferred.
  - **ARCH-0001**: storage read side formalised; persister already wrote the data the reads consume. Auth still stubbed per ARCH-0001 M1 note.
  - **ADR-0004**: the SQLite file is the single source of truth; the frontend never caches full sessions to IndexedDB in this plan.

- **Placeholder scan:** No TBD/TODO/"similar to Task N". One deliberate pragmatic step in Task 3 pre-declares the `SoftDeleteSession` stub (identical to the final implementation in Task 4) so the ordering of tests and implementation stays TDD-clean. Task 4's test file is the formalisation.

- **Type consistency:**
  - `SessionRow` fields used identically across backend JSON (`storage/reads.go`), frontend types (`api/client.ts`), and frontend pages.
  - `Sample` / `SampleRow` fields align 1-to-1 with the `strokes` table columns from the M3 migration.
  - `SessionSummary` reuses `event.SessionSummary`; the JSON tags on the backend side match the frontend type's snake_case exactly.
  - `SessionsHandler` accepts `*sql.DB`, lives under `api`, and is wired into `NewRouter` via `api.Inputs.DB` — one new field, consistent across tests and `main`.

- **One scope decision worth flagging:** The Playwright e2e (Task 13) spawns the real backend with a 1 s idle timeout so the fixture session closes within the test window. This reuses the port-8080 convention from the M3 plan's e2e; if another service is running on 8080, the test will collide (same caveat as before). Documenting it here so the next plan doesn't re-invent a solution.

- **Deferred to follow-up plans:**
  - FEAT-0003a Trends sub-tab (distinct plan — different data-shape).
  - Restore UI for the 7-day undelete window.
  - Filter chips + Summary-Strip.
  - CSV / FIT / TCX export.
  - PB badges + milestones (blocked on FEAT-0004).
  - FEAT-0002 auth (QR pairing) — unblocks multi-rower filter.
