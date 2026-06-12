# 2026-06-11 Session Bugfixes & Data-Integrity Preconditions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the four defects surfaced by the 2026-06-11 rowing session — phantom empty sessions persisting, discard popping a save-overlay and leaving a dead deep-link, and the warmup countdown freezing at 0:00 — and remove the existing phantom rows, so the Historie redesign builds on clean session data.

**Architecture:** Two backend changes (an empty-session prune at the `FinaliseSession`/persister seam, plus a one-shot cleanup migration) stop new phantom sessions and remove old ones. Two frontend changes (a single shared discard action that suppresses the session-end latch, and a warmup-aware segment locator) fix the live-surface UX without redesigning it. Each fix is independent and ships on its own.

**Tech Stack:** Go 1.x + modernc SQLite (backend); React 18 + TypeScript + Vitest + Playwright (frontend).

**Source spec:** `docs/superpowers/specs/2026-06-11-historie-optimization-design.md` → §Implementation architecture → "Data-integrity preconditions", and §Out of scope (warmup regression).

---

## Background (root causes, journal- and DB-verified)

- **Empty session persists:** `FinaliseSession` deliberately permits a zero-stroke `FinaliseEnded` (finalise.go:87-89) because the sessionizer summary "may be authoritative." A `POST /session/start` that never receives an IPM frame therefore persists a zero-totals ghost (`01KTW3SBV4`, plus two more from one evening). Fix: prune when there are no strokes **and** the summary itself is empty (`TotalStrokes == 0`); keep the authoritative-summary escape (`TotalStrokes > 0`).
- **Discard pops save-overlay + dead link:** the backend `DELETE /sessions/{id}` ends-then-deletes correctly. The `EndSession()` it calls emits `session_end` over SSE; LivePage latches it and shows the generic "Session beendet / Bestleistungen werden berechnet…" overlay, and "Details ansehen" deep-links to the now-deleted id → "Session nicht gefunden." Fix: mark the session discarded **before** awaiting the delete so the latch is suppressed; collapse the two duplicated `onDiscard` closures into one action.
- **Warmup freezes at 0:00:** `locateSegment` counts the warmup segment against `work_time_sec`, which ADR-0017 pins at 0 throughout warmup (regression from `47725f8`); each stroke snaps the locally-ticking display back to full. Fix: count the leading warmup against `phase_time_sec`.
- **Foreign keys:** already enforced via the DSN — no work (spec corrected).

## File Structure

**Backend (Go):**
- Modify `backend/internal/storage/persister.go` — `applySessionEnd`: load strokes, prune empty sessions, pass strokes through.
- Modify `backend/internal/storage/queries.go` — add `DeleteEmptySession` helper.
- Create `backend/internal/storage/migrations/0017_prune_empty_sessions.sql` — remove existing phantom rows.
- Modify `backend/internal/storage/persister_test.go` (create if absent) — prune behavior test.
- Modify `backend/internal/storage/migrations_prune_test.go` (create) — migration-SQL test.

**Frontend (TS):**
- Modify `web/src/pages/live/WorkoutOverlayContext.tsx` — add `markDiscarded`/`wasDiscarded`.
- Create `web/src/pages/live/useDiscardSession.ts` — single shared discard action.
- Modify `web/src/pages/live/WorkoutProgressStrip.tsx` — use the shared hook.
- Modify `web/src/pages/live/PauseDialog.tsx` — use the shared hook.
- Modify `web/src/pages/LivePage.tsx` — suppress the latch for discarded sessions.
- Modify `web/src/live/segments.ts` — warmup-aware `locateSegment`.
- Modify `web/src/live/useWorkoutProgress.ts` — pass `phase_time_sec`.
- Modify `web/src/live/segments.test.ts` — rewrite locator tests to ADR-0017 semantics.
- Create `web/tests/e2e/discard-session.spec.ts` — discard acceptance test.

---

## Task 1: Backend — prune empty sessions at session-end

**Files:**
- Modify: `backend/internal/storage/persister.go` (`applySessionEnd`, ~line 222)
- Modify: `backend/internal/storage/queries.go` (add `DeleteEmptySession`)
- Test: `backend/internal/storage/persister_test.go`

- [ ] **Step 1: Write the failing test**

Add to `backend/internal/storage/persister_test.go` (create the file with this content if it does not exist; it is a white-box `package storage` test so it can call the unexported `applySessionEnd`):

```go
package storage

import (
	"context"
	"testing"
	"time"

	"github.com/gloeckner-daniel/splits/internal/event"
)

// A session_end with no persisted strokes AND an empty summary is a
// phantom (POST /session/start that never received a frame). It must be
// pruned, not persisted as a zero-totals ghost.
func TestApplySessionEnd_PrunesEmptyPhantom(t *testing.T) {
	db := testDB(t)
	ctx := context.Background()
	started := time.Date(2026, 1, 1, 10, 0, 0, 0, time.UTC)
	if err := InsertSession(ctx, db.Handle(), "ph1", "r1", started, 3, ""); err != nil {
		t.Fatalf("InsertSession: %v", err)
	}

	p := &Persister{DB: db.Handle()}
	e := event.Event{
		ID:        7,
		Kind:      event.KindSessionEnd,
		SessionID: "ph1",
		SessionEnd: &event.SessionEndPayload{
			EndedAt: started.Add(15 * time.Minute),
			Summary: event.SessionSummary{}, // empty: TotalStrokes == 0
		},
	}
	if err := p.applySessionEnd(ctx, e); err != nil {
		t.Fatalf("applySessionEnd: %v", err)
	}

	var n int
	if err := db.Handle().QueryRowContext(ctx,
		`SELECT COUNT(*) FROM sessions WHERE id='ph1'`).Scan(&n); err != nil {
		t.Fatal(err)
	}
	if n != 0 {
		t.Errorf("phantom session not pruned: %d rows remain", n)
	}
}

// A zero-stroke end whose summary carries real totals (strokes were
// broadcast but not yet persisted) is authoritative and must be kept.
func TestApplySessionEnd_KeepsAuthoritativeSummary(t *testing.T) {
	db := testDB(t)
	ctx := context.Background()
	started := time.Date(2026, 1, 1, 10, 0, 0, 0, time.UTC)
	if err := InsertSession(ctx, db.Handle(), "au1", "r1", started, 3, ""); err != nil {
		t.Fatalf("InsertSession: %v", err)
	}

	p := &Persister{DB: db.Handle()}
	e := event.Event{
		ID:        9,
		Kind:      event.KindSessionEnd,
		SessionID: "au1",
		SessionEnd: &event.SessionEndPayload{
			EndedAt: started.Add(5 * time.Minute),
			Summary: event.SessionSummary{TotalStrokes: 120, TotalDistanceM: 1000, TotalTimeSec: 300},
		},
	}
	if err := p.applySessionEnd(ctx, e); err != nil {
		t.Fatalf("applySessionEnd: %v", err)
	}

	var ended string
	if err := db.Handle().QueryRowContext(ctx,
		`SELECT COALESCE(ended_at,'') FROM sessions WHERE id='au1'`).Scan(&ended); err != nil {
		t.Fatalf("session missing (wrongly pruned): %v", err)
	}
	if ended == "" {
		t.Error("authoritative session not finalised (ended_at empty)")
	}
}
```

> Note: confirm the `event.SessionEndPayload` field names (`EndedAt`, `Summary`) match `backend/internal/event/event.go`. If the struct differs, adjust the literal — do not change the assertions.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && go test ./internal/storage/ -run TestApplySessionEnd_Prunes -v`
Expected: FAIL — the phantom row is still present (count 1), because `applySessionEnd` currently finalises zero-stroke ended sessions.

- [ ] **Step 3: Add the `DeleteEmptySession` helper**

In `backend/internal/storage/queries.go`, add (mirrors the boot janitor's zero-stroke delete at janitor.go:147):

```go
// DeleteEmptySession removes a session row that finalised with no
// strokes and no real totals — a phantom from a POST /session/start
// that never received a frame. Runs in its own transaction. FK
// enforcement (DSN _pragma=foreign_keys(on)) guarantees no orphan
// strokes can survive; for a truly empty session there are none.
func DeleteEmptySession(ctx context.Context, db *sql.DB, id string) error {
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	if _, err := tx.ExecContext(ctx, `DELETE FROM sessions WHERE id = ?`, id); err != nil {
		return err
	}
	return tx.Commit()
}
```

- [ ] **Step 4: Prune in `applySessionEnd`**

In `backend/internal/storage/persister.go`, replace the body of `applySessionEnd` (keep the Falschstart re-tag block unchanged at the top) so it loads strokes once, prunes the empty case, and passes the strokes through to `FinaliseSession`:

```go
func (p *Persister) applySessionEnd(ctx context.Context, e event.Event) error {
	// §Falschstart: re-tag pre-GO strokes as warmup so every downstream
	// consumer sees only post-GO strokes as work-phase. Must run before
	// strokes are loaded so the in-DB phase tags are correct.
	if e.SessionEnd != nil && e.SessionEnd.Summary.RaceGoStrokeNo > 1 {
		if _, err := p.DB.ExecContext(ctx,
			`UPDATE strokes SET phase = 'warmup' WHERE session_id = ? AND stroke_no < ?`,
			e.SessionID, e.SessionEnd.Summary.RaceGoStrokeNo); err != nil {
			return err
		}
	}

	// Empty-session prune: a session_end with no persisted strokes AND an
	// empty authoritative summary is a phantom (a POST /session/start that
	// never received a frame). Delete the row rather than persist a
	// zero-totals ghost that pollutes Verlauf, the trends totals, and the
	// Rekorde grid. A zero-stroke end with a non-empty summary (strokes
	// broadcast but not yet persisted) is still finalised — the sessionizer
	// summary is authoritative (see finalise.go:87-89).
	strokes, err := LoadSessionStrokes(ctx, p.DB, e.SessionID)
	if err != nil {
		return err
	}
	if len(strokes) == 0 && e.SessionEnd.Summary.TotalStrokes == 0 {
		if err := DeleteEmptySession(ctx, p.DB, e.SessionID); err != nil {
			return err
		}
		slog.Info("storage.persister.prune_empty_session", "session_id", e.SessionID)
		return nil
	}

	summary, err := FinaliseSession(ctx, p.DB, e.SessionID, e.SessionEnd.EndedAt,
		e.SessionEnd.Summary, strokes, e.ID, FinaliseEnded, p.Scheduler)
	if err != nil {
		return err
	}
	p.emitSessionFinalized(ctx, e.SessionID, summary)
	return nil
}
```

> `slog` is already imported in persister.go. `LoadSessionStrokes` is the same loader `FinaliseSession` uses; passing the result through avoids a double load.

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd backend && go test ./internal/storage/ -run TestApplySessionEnd -v`
Expected: PASS for both `TestApplySessionEnd_PrunesEmptyPhantom` and `TestApplySessionEnd_KeepsAuthoritativeSummary`.

- [ ] **Step 6: Run the full storage package to catch regressions**

Run: `cd backend && go test ./internal/storage/ -v`
Expected: PASS. In particular `TestFinaliseSession_Ended` and `TestFinaliseSession_ZeroStrokes` still pass (the prune lives in the persister, not in `FinaliseSession`, so its contract is unchanged).

- [ ] **Step 7: Commit**

```bash
cd backend
git add internal/storage/persister.go internal/storage/queries.go internal/storage/persister_test.go
git commit -m "fix(storage): prune empty phantom sessions at session-end

A POST /session/start that never receives an IPM frame persisted a
zero-totals ghost session. Prune at applySessionEnd when there are no
strokes and the summary is empty; keep the authoritative-summary escape.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 2: Backend — migration to remove existing phantom rows

**Files:**
- Create: `backend/internal/storage/migrations/0017_prune_empty_sessions.sql`
- Test: `backend/internal/storage/migrations_prune_test.go`

- [ ] **Step 1: Write the failing test**

Create `backend/internal/storage/migrations_prune_test.go`. It seeds one phantom (ended, zero totals, no strokes) and one real ended session, runs the prune DELETE, and asserts only the phantom is removed. The DELETE string is duplicated here intentionally so the test pins the exact predicate (the engineer may read this task out of order):

```go
package storage

import (
	"context"
	"testing"
	"time"
)

const pruneEmptySessionsSQL = `
DELETE FROM sessions
WHERE ended_at IS NOT NULL
  AND total_strokes = 0
  AND total_distance_m = 0
  AND id NOT IN (SELECT DISTINCT session_id FROM strokes);`

func TestPruneEmptySessionsMigration(t *testing.T) {
	db := testDB(t)
	ctx := context.Background()
	started := time.Date(2026, 1, 1, 10, 0, 0, 0, time.UTC)
	ended := started.Add(15 * time.Minute).UTC().Format(time.RFC3339Nano)

	// Phantom: ended, zero totals, no strokes.
	if err := InsertSession(ctx, db.Handle(), "ph1", "r1", started, 3, ""); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Handle().ExecContext(ctx,
		`UPDATE sessions SET ended_at=?, total_strokes=0, total_distance_m=0 WHERE id='ph1'`,
		ended); err != nil {
		t.Fatal(err)
	}

	// Real: ended with strokes + totals (use the shared seed helper).
	seedSession(t, db, "ok1", "r1", 5)
	if _, err := db.Handle().ExecContext(ctx,
		`UPDATE sessions SET ended_at=?, total_strokes=5, total_distance_m=200 WHERE id='ok1'`,
		ended); err != nil {
		t.Fatal(err)
	}

	if _, err := db.Handle().ExecContext(ctx, pruneEmptySessionsSQL); err != nil {
		t.Fatalf("prune SQL: %v", err)
	}

	var phantom, real int
	db.Handle().QueryRowContext(ctx, `SELECT COUNT(*) FROM sessions WHERE id='ph1'`).Scan(&phantom)
	db.Handle().QueryRowContext(ctx, `SELECT COUNT(*) FROM sessions WHERE id='ok1'`).Scan(&real)
	if phantom != 0 {
		t.Errorf("phantom not pruned: %d", phantom)
	}
	if real != 1 {
		t.Errorf("real session wrongly pruned: %d", real)
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && go test ./internal/storage/ -run TestPruneEmptySessionsMigration -v`
Expected: FAIL — the migration file does not exist yet, but this test execs the SQL literal directly, so it should actually PASS on the predicate. If it PASSES here, that is expected (the test validates the predicate); proceed to Step 3 to add the migration file the runtime applies. (The test's job is to pin the predicate; the migration file in Step 3 carries the same SQL.)

- [ ] **Step 3: Create the migration**

Create `backend/internal/storage/migrations/0017_prune_empty_sessions.sql`:

```sql
-- 0017: remove phantom sessions persisted before the empty-session
-- prune (storage/persister.go applySessionEnd). A phantom is an ended
-- session that recorded no strokes and no distance — produced by a
-- POST /session/start that never received an IPM frame. They pollute
-- the Verlauf list, the trends totals, and the Rekorde grid. Idempotent.
DELETE FROM sessions
WHERE ended_at IS NOT NULL
  AND total_strokes = 0
  AND total_distance_m = 0
  AND id NOT IN (SELECT DISTINCT session_id FROM strokes);
```

- [ ] **Step 4: Verify the migration applies cleanly on Open**

Run: `cd backend && go test ./internal/storage/ -run TestOpen -v`
Expected: PASS — `applyMigrations` parses `0017_` (4-digit version), applies it, and records version 17 in `schema_migrations`. If no `TestOpen*` exists, instead run `go test ./internal/storage/ -v` and confirm no migration-parse error.

- [ ] **Step 5: Run the prune predicate test**

Run: `cd backend && go test ./internal/storage/ -run TestPruneEmptySessionsMigration -v`
Expected: PASS — phantom removed, real session kept.

- [ ] **Step 6: Commit**

```bash
cd backend
git add internal/storage/migrations/0017_prune_empty_sessions.sql internal/storage/migrations_prune_test.go
git commit -m "fix(storage): migration 0017 removes existing phantom sessions

Cleans up zero-stroke, zero-total ended sessions persisted before the
applySessionEnd prune landed. Idempotent.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 3: Frontend — discard-flow integrity

Discard must leave no trace and never show the save-overlay. One shared action marks the session discarded **before** the delete (so LivePage's latch is suppressed), deletes it, refreshes the list, and goes home. The acceptance test is end-to-end (the spec's AC); unit-level changes support it.

**Files:**
- Modify: `web/src/pages/live/WorkoutOverlayContext.tsx`
- Create: `web/src/pages/live/useDiscardSession.ts`
- Modify: `web/src/pages/live/WorkoutProgressStrip.tsx`
- Modify: `web/src/pages/live/PauseDialog.tsx`
- Modify: `web/src/pages/LivePage.tsx`
- Test: `web/tests/e2e/discard-session.spec.ts`

- [ ] **Step 1: Write the failing e2e acceptance test**

Create `web/tests/e2e/discard-session.spec.ts`. Follow the existing harness in `web/tests/e2e/fixtures.ts` (worker-scoped Vite + backend; `home`, `live`, `workoutFlow`, `history` page objects; backend CSV fixture playback). Confirm the page-object method names against `fixtures.ts` and the `pages/` directory before running; adjust calls to match, but keep the assertions.

```ts
import { test, expect } from './fixtures'

// Spec AC (data-integrity preconditions): tap Verwerfen → no "Session
// beendet" overlay appears, the app returns home, and the session is
// absent from the list. Covers the overlay-race, the latch leak, and
// the dead deep-link in one pass.
test('discarding a session leaves no trace and shows no save-overlay', async ({
  page,
  startBackend,
  seedActiveRower,
  home,
  workoutFlow,
}) => {
  await startBackend({ fixture: '../specs/int/fixtures/ipm/session-m1.csv', fixtureRate: 'fast', idleTimeout: '60s' })
  await seedActiveRower()

  // Start a short distance workout and let a few strokes land.
  await home.goto()
  await workoutFlow.startDistance({ meters: 500 })
  await expect(page.getByTestId('progress-strip')).toBeVisible({ timeout: 15_000 })

  // Open the abort dialog and discard.
  await page.getByTestId('progress-strip-abort').click()
  await expect(page.getByTestId('abort-dialog')).toBeVisible()
  await page.getByTestId('abort-dialog-discard').click()

  // The generic save-overlay must NEVER appear after a discard.
  await expect(page.getByTestId('session-ended-overlay')).toHaveCount(0)

  // App returns home.
  await expect(page).toHaveURL(/\/$|\/home/, { timeout: 10_000 })

  // The session is absent from history.
  await home.openHistorie?.()
  await expect(page.getByText('Session nicht gefunden')).toHaveCount(0)
})
```

> If `workoutFlow.startDistance` / `home.openHistorie` do not exist with these names, use the closest existing methods (the earlier review noted `HistoryPage.openSessions()` and a `workoutFlow` fixture). The assertions — no `session-ended-overlay`, return home, no "Session nicht gefunden" — must stay.

- [ ] **Step 2: Run the e2e test to verify it fails**

Run: `cd web && npx playwright test discard-session.spec.ts`
Expected: FAIL — after discard, `session-ended-overlay` appears (count 1), because LivePage latches the `session_end` that the delete's `EndSession()` emits.

- [ ] **Step 3: Add discard tracking to `WorkoutOverlayContext`**

In `web/src/pages/live/WorkoutOverlayContext.tsx`, extend the context type and provider. Replace the `Ctx` type, the provider body's callbacks/value, and the fallback hook:

```tsx
type Ctx = {
  aborted: boolean
  abort: () => void
  reset: () => void
  /** Record that this session is being discarded, BEFORE the delete is
   *  awaited, so LivePage suppresses the session-end latch (no
   *  save-overlay for a discard). */
  markDiscarded: (sessionId: string) => void
  /** True if the given session id was marked discarded. */
  wasDiscarded: (sessionId: string | null) => boolean
}
```

Inside `WorkoutOverlayProvider`, add a ref and the two callbacks, and include them in the memoised value:

```tsx
  const discardedSessionId = useRef<string | null>(null)

  const markDiscarded = useCallback((sessionId: string) => {
    discardedSessionId.current = sessionId
  }, [])

  const wasDiscarded = useCallback(
    (sessionId: string | null) => sessionId !== null && discardedSessionId.current === sessionId,
    [],
  )

  const value = useMemo<Ctx>(
    () => ({ aborted, abort, reset, markDiscarded, wasDiscarded }),
    [aborted, abort, reset, markDiscarded, wasDiscarded],
  )
```

Update the fallback returned by `useWorkoutOverlay` when there is no provider:

```tsx
export function useWorkoutOverlay(): Ctx {
  const ctx = useContext(WorkoutOverlayContext)
  if (!ctx)
    return {
      aborted: false,
      abort: () => {},
      reset: () => {},
      markDiscarded: () => {},
      wasDiscarded: () => false,
    }
  return ctx
}
```

> `useRef` and `useCallback` are already imported in this file.

- [ ] **Step 4: Create the shared discard action**

Create `web/src/pages/live/useDiscardSession.ts`:

```tsx
import { useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { deleteSession } from '../../api/client'
import { showToast } from '../../app/Toast'
import { useWorkoutOverlay } from './WorkoutOverlayContext'

/**
 * Single source of truth for discarding the open session. Both the ✕
 * abort dialog (WorkoutProgressStrip) and the pause dialog (PauseDialog)
 * use this so the rule lives in exactly one place.
 *
 * Order matters: markDiscarded runs BEFORE the delete is awaited, so the
 * `session_end` that the backend's EndSession() emits during delete is
 * recognised as a discard and LivePage suppresses the save-overlay.
 *
 * Returns true on success (caller closes its dialog), false on failure
 * (caller leaves the dialog open; a toast has been shown).
 */
export function useDiscardSession(): (sessionId: string | null) => Promise<boolean> {
  const { abort, markDiscarded } = useWorkoutOverlay()
  const qc = useQueryClient()
  const nav = useNavigate()
  return useCallback(
    async (sessionId: string | null): Promise<boolean> => {
      if (sessionId) {
        markDiscarded(sessionId)
        try {
          await deleteSession(sessionId)
          qc.invalidateQueries({ queryKey: ['sessions'] })
        } catch {
          showToast('Verwerfen fehlgeschlagen — bitte erneut versuchen.', 'warn')
          return false
        }
      }
      abort()
      nav('/')
      return true
    },
    [abort, markDiscarded, qc, nav],
  )
}
```

- [ ] **Step 5: Wire `WorkoutProgressStrip` to the shared action**

In `web/src/pages/live/WorkoutProgressStrip.tsx`, import the hook and replace the inline `onDiscard`. Remove the now-unused `deleteSession`, `showToast`, and `useQueryClient` imports if nothing else in the file uses them (the `onSave` handler still uses `enqueueEndSession`/`processPendingEndSessions` and `abort` — keep those).

```tsx
import { useDiscardSession } from './useDiscardSession'
// ...
export function WorkoutProgressStrip() {
  // ...existing hooks...
  const discard = useDiscardSession()
  // ...
      <AbortWorkoutDialog
        open={open}
        onSave={() => {
          if (sessionId) enqueueEndSession(sessionId)
          void processPendingEndSessions()
          abort()
          setOpen(false)
          nav('/')
        }}
        onContinue={() => setOpen(false)}
        onDiscard={async () => {
          const ok = await discard(sessionId)
          if (ok) setOpen(false)
        }}
      />
}
```

> If, after this edit, `deleteSession` / `showToast` / `useQueryClient` (`qc`) are no longer referenced in the file, delete their imports/decls to keep the lint clean.

- [ ] **Step 6: Wire `PauseDialog` to the shared action**

In `web/src/pages/live/PauseDialog.tsx`, the same swap. The `onSave` handler keeps `enqueueEndSession`/`processPendingEndSessions`/`abort`; replace `onDiscard`:

```tsx
import { useDiscardSession } from './useDiscardSession'
// ...
  const discard = useDiscardSession()
  // ...
      onContinue={() => setDismissed(true)}
      onDiscard={async () => {
        const ok = await discard(sessionId)
        if (ok) setDismissed(false)
      }}
```

> Remove the now-unused `deleteSession` / `showToast` / `useQueryClient` imports if nothing else uses them.

- [ ] **Step 7: Suppress the latch in `LivePage`**

In `web/src/pages/LivePage.tsx` `LivePageContent`, read `wasDiscarded` from the overlay context and guard the latch effect. Add near the other hooks:

```tsx
  const { wasDiscarded } = useWorkoutOverlay()
```

> `useWorkoutOverlay` is already imported (used by `useWorkoutProgress`); add the named import if not already present in LivePage.

Then change the latch effect (the `useEffect` on `incomingSummary` at ~line 238) so a discarded session never latches:

```tsx
  useEffect(() => {
    const prev = prevSummaryRef.current
    if (!prev && incomingSummary) {
      if (wasDiscarded(incomingSessionId)) {
        // Discarded session: never latch, never show the save-overlay.
        // Clear any stale latch and refresh the list so the row is gone.
        try {
          window.sessionStorage.removeItem(STORAGE_KEY)
        } catch {}
        qc.invalidateQueries({ queryKey: ['sessions'] })
        prevSummaryRef.current = incomingSummary
        return
      }
      const next: Latched = {
        summary: incomingSummary,
        sessionId: incomingSessionId,
        workoutId: incomingWorkoutId,
        workoutMode: activeWorkoutMode,
      }
      setLatched(next)
      try {
        window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(next))
      } catch {}
      qc.invalidateQueries({ queryKey: ['sessions'] })
      qc.invalidateQueries({ queryKey: ['rower-pbs'] })
      qc.invalidateQueries({ queryKey: ['rower-lifetime'] })
      qc.invalidateQueries({ queryKey: ['rower-achievements'] })
      qc.invalidateQueries({ queryKey: ['rower-trends'] })
    }
    prevSummaryRef.current = incomingSummary
  }, [incomingSummary, incomingSessionId, incomingWorkoutId, activeWorkoutMode, qc, wasDiscarded])
```

- [ ] **Step 8: Run the e2e test to verify it passes**

Run: `cd web && npx playwright test discard-session.spec.ts`
Expected: PASS — no `session-ended-overlay` after discard, app returns home, no "Session nicht gefunden".

- [ ] **Step 9: Run the frontend unit suite for regressions**

Run: `cd web && npm run test -- --run src/pages/live`
Expected: PASS — existing `WorkoutProgressStrip`, `PauseDialog`, and overlay-context tests still green. Update any test that imported the removed symbols.

- [ ] **Step 10: Commit**

```bash
cd web
git add src/pages/live/WorkoutOverlayContext.tsx src/pages/live/useDiscardSession.ts \
  src/pages/live/WorkoutProgressStrip.tsx src/pages/live/PauseDialog.tsx \
  src/pages/LivePage.tsx tests/e2e/discard-session.spec.ts
git commit -m "fix(live): discard leaves no trace and shows no save-overlay

Mark the session discarded before the delete so LivePage suppresses the
session-end latch; collapse the two duplicated onDiscard closures into
one shared useDiscardSession action.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 4: Frontend — warmup countdown counts phase time

The leading warmup segment must count down against `phase_time_sec` (which advances during warmup), not `work_time_sec` (pinned at 0 until work begins, ADR-0017).

**Files:**
- Modify: `web/src/live/segments.ts` (`locateSegment`)
- Modify: `web/src/live/useWorkoutProgress.ts` (caller)
- Test: `web/src/live/segments.test.ts`

- [ ] **Step 1: Rewrite the locator tests to ADR-0017 semantics**

In `web/src/live/segments.test.ts`, replace the `describe('locateSegment', …)` block's tests with the four-argument signature `locateSegment(segments, workDistanceM, workTimeSec, phaseTimeSec)`. The fixture (warmup 120s, 2×500m, rest 60s) is unchanged:

```ts
describe('locateSegment', () => {
  const segs = expandWorkout({
    id: 'W', mode: 'intervals',
    params: { reps: 2, length: { unit: 'm', value: 500 }, rest_sec: 60 },
    warmup_sec: 120, cooldown_sec: 0,
    created_at: '',
  } as Workout)
  // segments: warmup(0-120s), work(0-500m), rest(120-180s), work(500-1000m)

  it('warmup active at zero metrics, full remaining', () => {
    const a = locateSegment(segs, 0, 0, 0)
    expect(a?.segment.kind).toBe('warmup')
    expect(a?.remainingSec).toBe(120)
    expect(a?.progressRatio).toBe(0)
  })

  // REGRESSION (2026-06-11): during warmup work_time_sec is pinned at 0;
  // the countdown must advance against phase_time_sec, not freeze.
  it('warmup counts down against phase time while work time is 0', () => {
    const a = locateSegment(segs, 0, 0, 60)
    expect(a?.segment.kind).toBe('warmup')
    expect(a?.remainingSec).toBe(60)
    expect(a?.progressRatio).toBeCloseTo(0.5)
  })

  it('advances past warmup once the work phase begins', () => {
    // First work strokes: work distance advancing, phase time reset to 0.
    const a = locateSegment(segs, 10, 4, 0)
    expect(a?.segment.kind).toBe('work')
    expect(a?.segment.distanceM).toBe(500)
  })

  it('advances past warmup when phase time exceeds warmup duration', () => {
    const a = locateSegment(segs, 0, 0, 125)
    expect(a?.segment.kind).toBe('work')
  })

  it('remainingM decreases inside distance segment', () => {
    const a = locateSegment(segs, 300, 200, 0)
    expect(a?.segment.kind).toBe('work')
    expect(a?.remainingM).toBe(200)
  })

  it('transitions to rest once work distance consumed', () => {
    const a = locateSegment(segs, 500, 200, 0)
    expect(a?.segment.kind).toBe('rest')
  })

  it('returns null after all segments consumed', () => {
    const a = locateSegment(segs, 1000, 400, 0)
    expect(a).toBeNull()
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd web && npm run test -- --run src/live/segments.test.ts`
Expected: FAIL — `locateSegment` takes three args; the new `phaseTimeSec` is ignored, so "warmup counts down against phase time" gets `remainingSec` 120 (not 60), and the TS signature mismatch may also error.

- [ ] **Step 3: Make `locateSegment` warmup-aware**

In `web/src/live/segments.ts`, change the signature and add the warmup branch as the first check inside the loop. Update the JSDoc and add the `phaseTimeSec` param:

```ts
export function locateSegment(
  segments: Segment[],
  /** Backend-stamped `work_distance_m`: metres since the work phase started. */
  workDistanceM: number,
  /** Backend-stamped `work_time_sec`: seconds since the work phase started.
   *  Pinned at 0 throughout warmup (ADR-0017). */
  workTimeSec: number,
  /** Backend-stamped `phase_time_sec`: seconds since the current phase
   *  started. Used for the leading warmup countdown, which precedes work. */
  phaseTimeSec: number,
): ActiveSegment | null {
  if (segments.length === 0) return null
  let timeAnchor = 0
  let workCompletedAt: number | null = null

  for (let idx = 0; idx < segments.length; idx++) {
    const seg = segments[idx]

    // Leading warmup: precedes the work phase, so work_time_sec is pinned
    // at 0 throughout it (ADR-0017). Counting against workTimeSec would
    // freeze the countdown — the 2026-06-11 regression. Count against
    // phase_time_sec instead. Once the work phase begins (work distance
    // or time advances) the warmup is complete and is skipped.
    if (seg.kind === 'warmup' && seg.durationSec != null) {
      const workStarted = workDistanceM > 0 || workTimeSec > 0
      if (!workStarted) {
        const consumed = Math.max(0, phaseTimeSec)
        if (consumed < seg.durationSec) {
          return {
            segment: seg,
            remainingSec: Math.max(0, seg.durationSec - consumed),
            progressRatio: consumed / seg.durationSec,
            totalSegments: segments.length,
            activeIndexOneBased: seg.index + 1,
          }
        }
      }
      timeAnchor += seg.durationSec
      continue
    }

    if (seg.durationSec != null) {
      // ...existing rest/cooldown branch, unchanged...
```

Leave the rest of the function (the `seg.durationSec != null` rest/cooldown branch and the `seg.distanceM != null` branch) exactly as-is.

- [ ] **Step 4: Update the caller to pass phase time**

In `web/src/live/useWorkoutProgress.ts`, the `active` memo (~line 37) passes the new fourth argument:

```ts
  const active = useMemo(() => {
    if (!state.stroke || segments.length === 0) return null
    return locateSegment(
      segments,
      state.stroke.work_distance_m,
      state.stroke.work_time_sec,
      state.stroke.phase_time_sec,
    )
  }, [state.stroke, segments])
```

> `phase_time_sec` already exists on the stroke type (`web/src/live/events.ts:36`), so no type change is needed.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd web && npm run test -- --run src/live/segments.test.ts`
Expected: PASS — all locator tests green, including the warmup-counts-down regression.

- [ ] **Step 6: Typecheck and run the live unit suite**

Run: `cd web && npx tsc -p tsconfig.app.json --noEmit && npm run test -- --run src/live`
Expected: PASS — no type errors from the new fourth argument; `useWorkoutProgress` and related tests green.

- [ ] **Step 7: Commit**

```bash
cd web
git add src/live/segments.ts src/live/useWorkoutProgress.ts src/live/segments.test.ts
git commit -m "fix(live): warmup countdown counts phase time, not work time

locateSegment counted the leading warmup against work_time_sec, which
ADR-0017 pins at 0 during warmup, so the countdown froze and reset to
full on every stroke. Count the warmup against phase_time_sec.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage** (against §Data-integrity preconditions + §Out of scope warmup):
- Empty-session prune → Task 1 (runtime) + Task 2 (existing rows). ✓
- Discard leaves no trace, no save-overlay, no dead deep-link, single shared action → Task 3. ✓
- Foreign keys → already enforced; spec corrected; no task (correctly omitted). ✓
- Warmup-countdown regression → Task 4. ✓
- Tests requested by spec (empty-session integration test; discard e2e AC; warmup test class) → Tasks 1, 3, 4. ✓

**Placeholder scan:** no TBD/TODO/"handle edge cases"/"similar to Task N"; every code step shows complete code. ✓

**Type/name consistency:**
- `markDiscarded(sessionId)` / `wasDiscarded(sessionId)` — defined in Task 3 Step 3, used identically in Steps 4 and 7. ✓
- `useDiscardSession()` returns `Promise<boolean>` — callers in Steps 5/6 use `const ok = await discard(...)`. ✓
- `DeleteEmptySession(ctx, db, id)` — defined Task 1 Step 3, called Step 4. ✓
- `locateSegment(segments, workDistanceM, workTimeSec, phaseTimeSec)` — signature in Task 4 Step 3 matches the four-arg calls in the tests (Step 1) and the caller (Step 4). ✓
- `pruneEmptySessionsSQL` (test const) mirrors the migration body (Task 2 Steps 1 and 3) exactly. ✓

**Assumptions to verify during execution** (flagged inline, do not block):
- `event.SessionEndPayload` field names (`EndedAt`, `Summary`) — confirm against `event.go`.
- e2e page-object method names (`workoutFlow.startDistance`, `home.openHistorie`) — confirm against `fixtures.ts`/`pages/`; assertions are fixed.

---

## Execution Handoff

Tasks 1–2 (backend) are independent of Tasks 3–4 (frontend) and can be done in either order or in parallel. Within the frontend, Task 3 and Task 4 are independent.
