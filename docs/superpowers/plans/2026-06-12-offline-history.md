# Offline History (Unterwegs-Modus) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement `docs/superpowers/specs/2026-06-12-offline-history-design.md` (ADR-0018): persist the react-query cache to IndexedDB, pack a cursor-driven offline snapshot while the Ergo is reachable, and give every history surface plus Home an explicit "Ergo nicht erreichbar · Stand: …" state.

**Architecture:** Pure-frontend feature, zero backend changes. Six additive modules under `web/src/offline/` (allowlist, persister, cursor, status store, pack, notice component) plus a GET-timeout helper in `api/error.ts`, wired once in `main.tsx`; five small page integrations; one Playwright walkthrough as the drift net. No service-worker changes — `/api/*` stays NetworkOnly.

**Tech Stack:** React 19, @tanstack/react-query v5 (+ `@tanstack/react-query-persist-client`), `idb-keyval`, vitest, Playwright.

**Test commands:**
- Unit: `cd /Users/dg/dev/ruderergo-stats/web && npx vitest run <file>`
- Typecheck: `cd /Users/dg/dev/ruderergo-stats/web && npx tsc --noEmit`
- E2E: `cd /Users/dg/dev/ruderergo-stats/web && npx playwright test tests/e2e/offline.spec.ts`

**Domain language:** CONTEXT.md §"Ergo nicht erreichbar" and §"Stand". UI copy never says "Offline".

---

## File structure (decomposition)

**New (all under `web/src/`)**
- `offline/persistKeys.ts` + `.test.ts` — exact-shape persistence allowlist (pure)
- `offline/persister.ts` — IndexedDB persister + `PERSIST_MAX_AGE_MS`
- `offline/cursor.ts` + `.test.ts` — `OfflineCursor` record over idb-keyval
- `offline/ergoStatus.ts` + `.test.ts` — reachability/Stand external store + `useErgoStatus`
- `offline/pack.ts` + `.test.ts` — probe → pack → prune → cursor write; boot/resume triggers
- `offline/ErgoStandNotice.tsx` + `.module.css` + `.test.tsx` — banner + hero variants
- `tests/e2e/offline.spec.ts`, `tests/e2e/helpers/seedTrends.ts` (extracted from `verlauf.spec.ts`)

**Modified**
- `src/api/error.ts` (+ `error.test.ts` new) — `getFetch` with `AbortSignal.timeout`
- `src/api/client.ts`, `src/api/rowers.ts`, `src/api/favorites.ts`, `src/api/workouts.ts` — read fns adopt `getFetch`
- `src/util/dates.ts` + test — `formatStand`
- `src/main.tsx` — `PersistQueryClientProvider`, `gcTime`, `storage.persist()`, trigger registration
- `src/pages/HistoryPage.tsx` — banner
- `src/pages/history/VerlaufTab.tsx` + `.module.css` — data-first error gate, dimmed non-cached rows
- `src/pages/SessionDetailPage.tsx` — data-first error gate, banner
- `src/pages/HomePage.tsx` + `.module.css`, `src/pages/home/FavoritesList.tsx` + `.module.css` — hero card, dimmed start affordances
- `src/pages/ProfilePage.tsx` — Unterwegs-Daten status line
- `tests/e2e/verlauf.spec.ts` — import seeding from the extracted helper

---

### Task 1: Dependencies + exact-shape persistence allowlist

**Files:**
- Modify: `web/package.json` (via npm)
- Create: `web/src/offline/persistKeys.ts`
- Test: `web/src/offline/persistKeys.test.ts`

- [ ] **Step 1: Install the two runtime deps**

```bash
cd /Users/dg/dev/ruderergo-stats/web && npm install @tanstack/react-query-persist-client idb-keyval
```

Expected: both land in `dependencies` (idb-keyval is ~1 kB; the persist client matches the installed @tanstack/react-query v5).

- [ ] **Step 2: Write the failing test**

`web/src/offline/persistKeys.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { isPersistableQuery } from './persistKeys'

describe('isPersistableQuery', () => {
  it.each<[readonly unknown[]]>([
    [['rowers']],
    [['active-rower']],
    [['favorites', 'R1']],
    [['rower-pbs', 'R1']],
    [['rower-achievements', 'R1']],
    [['rower-lifetime', 'R1']],
    [['rower-trends', 'R1', '30d']],
    [['rower-trends', 'R1', '365d']],
    [['rower-trends', 'R1', 'all']],
    [['sessions', 'S1']],
    [['sessions', 'S1', 'samples']],
    [['sessions', 'S1', 'pb-banners']],
    [['workout', 'W1']],
  ])('persists %j', (key) => {
    expect(isPersistableQuery(key)).toBe(true)
  })

  it.each<[readonly unknown[]]>([
    // The volatile resume-card query lives under the sessions prefix —
    // the bug a prefix match would ship.
    [['sessions', 'stale-open', 'R1']],
    [['active-session']],
    [['race-opponents', 'W1', 'R1']],
    [['favorites', '']], // disabled-query placeholder key
    [['workout', null]], // SessionDetail's disabled placeholder
    [['rower-trends', 'R1', 'week']], // legacy window
    [['sessions', 'S1', 'extras']],
    [['pair-token']],
    [[]],
  ])('does not persist %j', (key) => {
    expect(isPersistableQuery(key)).toBe(false)
  })
})
```

- [ ] **Step 3: Run to verify failure**

Run: `cd /Users/dg/dev/ruderergo-stats/web && npx vitest run src/offline/persistKeys.test.ts`
Expected: FAIL — module not found

- [ ] **Step 4: Implement `persistKeys.ts`**

```ts
// isPersistableQuery is the exact-shape allowlist deciding which query
// results survive into IndexedDB (ADR-0018, spec §Persistence layer).
// Exact shapes, never prefixes: `['sessions', 'stale-open', rowerId]`
// lives under the persisted `sessions` prefix but is volatile and must
// fall through structurally.
export function isPersistableQuery(queryKey: readonly unknown[]): boolean {
  const [k0, k1, k2] = queryKey
  switch (queryKey.length) {
    case 1:
      return k0 === 'rowers' || k0 === 'active-rower'
    case 2: {
      if (typeof k1 !== 'string' || k1 === '') return false
      if (k0 === 'sessions') return k1 !== 'stale-open'
      return (
        k0 === 'favorites' ||
        k0 === 'rower-pbs' ||
        k0 === 'rower-achievements' ||
        k0 === 'rower-lifetime' ||
        k0 === 'workout'
      )
    }
    case 3: {
      if (typeof k1 !== 'string' || k1 === '') return false
      if (k0 === 'rower-trends') return k2 === '30d' || k2 === '365d' || k2 === 'all'
      if (k0 === 'sessions' && k1 !== 'stale-open') return k2 === 'samples' || k2 === 'pb-banners'
      return false
    }
    default:
      return false
  }
}
```

- [ ] **Step 5: Run the test**

Run: `cd /Users/dg/dev/ruderergo-stats/web && npx vitest run src/offline/persistKeys.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
cd /Users/dg/dev/ruderergo-stats && git add web/package.json web/package-lock.json web/src/offline/persistKeys.ts web/src/offline/persistKeys.test.ts
git commit -m "feat(offline): exact-shape persistence allowlist + persist-client deps"
```

---

### Task 2: IndexedDB persister + offline cursor record

**Files:**
- Create: `web/src/offline/persister.ts`
- Create: `web/src/offline/cursor.ts`
- Test: `web/src/offline/cursor.test.ts`

- [ ] **Step 1: Write the failing cursor test**

`web/src/offline/cursor.test.ts`. idb-keyval needs IndexedDB, which jsdom lacks — mock it with an in-memory Map (same pattern recurs in `pack.test.ts`):

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest'

const store = new Map<string, unknown>()
vi.mock('idb-keyval', () => ({
  get: vi.fn(async (k: string) => store.get(k)),
  set: vi.fn(async (k: string, v: unknown) => void store.set(k, v)),
  del: vi.fn(async (k: string) => void store.delete(k)),
}))

import { loadCursor, saveCursor, type OfflineCursor } from './cursor'

const valid: OfflineCursor = {
  rowerId: 'R1',
  statsVersion: 7,
  buildSha: 'abc1234',
  packedAt: '2026-06-12T16:42:00.000Z',
  sessionIds: ['S1', 'S2'],
}

describe('offline cursor', () => {
  beforeEach(() => store.clear())

  it('round-trips a valid cursor', async () => {
    await saveCursor(valid)
    expect(await loadCursor()).toEqual(valid)
  })

  it('returns null when nothing is stored', async () => {
    expect(await loadCursor()).toBeNull()
  })

  it('returns null for malformed payloads instead of throwing', async () => {
    store.set('splits:offline-cursor', { rowerId: 'R1' })
    expect(await loadCursor()).toBeNull()
    store.set('splits:offline-cursor', 'garbage')
    expect(await loadCursor()).toBeNull()
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `cd /Users/dg/dev/ruderergo-stats/web && npx vitest run src/offline/cursor.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement `cursor.ts`**

```ts
import { get, set } from 'idb-keyval'

// OfflineCursor records the last fully successful pack (ADR-0018).
// statsVersion is the per-rower recompute counter probed via the
// lifetime endpoint; buildSha guards against the deploy-day desync
// where the persisted query cache is busted but this record survives;
// sessionIds is the prune keep-set and feeds the Profile status line.
export type OfflineCursor = {
  rowerId: string
  statsVersion: number
  buildSha: string
  packedAt: string
  sessionIds: string[]
}

const CURSOR_KEY = 'splits:offline-cursor'

export async function loadCursor(): Promise<OfflineCursor | null> {
  try {
    const v = (await get(CURSOR_KEY)) as OfflineCursor | undefined
    if (
      !v ||
      typeof v !== 'object' ||
      typeof v.rowerId !== 'string' ||
      typeof v.statsVersion !== 'number' ||
      typeof v.buildSha !== 'string' ||
      typeof v.packedAt !== 'string' ||
      !Array.isArray(v.sessionIds)
    ) {
      return null
    }
    return v
  } catch {
    return null
  }
}

export async function saveCursor(c: OfflineCursor): Promise<void> {
  await set(CURSOR_KEY, c)
}
```

- [ ] **Step 4: Implement `persister.ts`** (no own unit test — three one-line delegations; the e2e walkthrough covers the round trip)

```ts
import { del, get, set } from 'idb-keyval'
import type { PersistedClient, Persister } from '@tanstack/react-query-persist-client'

// 30 days: how long the persisted snapshot stays restorable, and the
// floor for gcTime (spec §Persistence layer — default 5-min gcTime
// would empty the bag minutes after packing).
export const PERSIST_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000

const CACHE_KEY = 'splits:rq-cache'

// One IndexedDB value, rewritten per throttled flush — the store
// shrinks when the cache does (prune), no append-only growth.
export const idbPersister: Persister = {
  persistClient: (client: PersistedClient) => set(CACHE_KEY, client),
  restoreClient: () => get<PersistedClient>(CACHE_KEY),
  removeClient: () => del(CACHE_KEY),
}
```

- [ ] **Step 5: Run test + typecheck**

Run: `cd /Users/dg/dev/ruderergo-stats/web && npx vitest run src/offline/cursor.test.ts && npx tsc --noEmit`
Expected: PASS / clean

- [ ] **Step 6: Commit**

```bash
cd /Users/dg/dev/ruderergo-stats && git add web/src/offline/persister.ts web/src/offline/cursor.ts web/src/offline/cursor.test.ts
git commit -m "feat(offline): idb persister and cursor record"
```

---

### Task 3: GET timeout — `getFetch` + adoption in read functions

Away from home the backend hostname resolves to an unreachable private IP; a plain `fetch` hangs for the OS TCP timeout (30–75 s). `getFetch` aborts reads at 6 s so the UI falls back to the persisted cache quickly. Mutations and the SSE stream are deliberately untouched.

**Files:**
- Modify: `web/src/api/error.ts`
- Test: `web/src/api/error.test.ts` (new)
- Modify: `web/src/api/client.ts`, `web/src/api/rowers.ts`, `web/src/api/favorites.ts`, `web/src/api/workouts.ts`

- [ ] **Step 1: Write the failing test**

`web/src/api/error.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from 'vitest'
import { getFetch, GET_TIMEOUT_MS, NetworkError } from './error'

afterEach(() => vi.unstubAllGlobals())

describe('getFetch', () => {
  it('exports a 6 s default timeout', () => {
    expect(GET_TIMEOUT_MS).toBe(6000)
  })

  it('aborts a hanging fetch after the timeout', async () => {
    vi.stubGlobal(
      'fetch',
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(init.signal!.reason))
        }),
    )
    await expect(getFetch('/api/v1/rowers', 20)).rejects.toBeInstanceOf(NetworkError)
  })

  it('passes a successful response through', async () => {
    const resp = new Response('{}', { status: 200 })
    vi.stubGlobal('fetch', async () => resp)
    expect(await getFetch('/api/v1/rowers')).toBe(resp)
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `cd /Users/dg/dev/ruderergo-stats/web && npx vitest run src/api/error.test.ts`
Expected: FAIL — `getFetch` not exported

- [ ] **Step 3: Add `getFetch` to `error.ts`** (below `apiFetch`)

```ts
export const GET_TIMEOUT_MS = 6_000

// getFetch wraps read-only GETs with a hard timeout. Away from home
// the backend hostname resolves to an unreachable private IP, where a
// plain fetch hangs for the OS TCP timeout (30–75 s); aborting at 6 s
// lets the UI fall back to the persisted snapshot (ADR-0018).
// Mutations and the SSE stream deliberately do not use this helper.
export function getFetch(url: string, timeoutMs: number = GET_TIMEOUT_MS): Promise<Response> {
  return apiFetch(url, { signal: AbortSignal.timeout(timeoutMs) })
}
```

- [ ] **Step 4: Run the test**

Run: `cd /Users/dg/dev/ruderergo-stats/web && npx vitest run src/api/error.test.ts`
Expected: PASS

- [ ] **Step 5: Adopt `getFetch` in the offline-relevant read functions**

Each change swaps only the fetch call; URL, unwrapping, and error semantics stay.

1. `web/src/api/client.ts` — add to the existing import from `'./error'`: `getFetch` (the file currently imports `ApiError`). Replace `await fetch(` with `await getFetch(` in exactly these functions: `getSession`, `getSamples`, `getSessionPBBanners`, `getRowerTrends`, `getRowerPBs`, `getRowerLifetime`, `getRowerAchievements`. Example (`getSession`):

```ts
export async function getSession(id: string): Promise<SessionRow> {
  const r = await getFetch(`/api/v1/sessions/${encodeURIComponent(id)}`)
  return json<SessionRow>(r)
}
```

2. `web/src/api/rowers.ts` — extend the import: `import { apiFetch, getFetch, readApiError } from './error'`. In `listRowers` and `getActiveRower` only, replace `await apiFetch(` with `await getFetch(`:

```ts
export async function listRowers(): Promise<Rower[]> {
  const r = await getFetch('/api/v1/rowers')
  const body = await json<{ rowers: Rower[] }>(r)
  return body.rowers
}

export async function getActiveRower(): Promise<Rower | null> {
  const r = await getFetch('/api/v1/active-rower')
  if (r.status === 404) return null
  return json<Rower>(r)
}
```

3. `web/src/api/favorites.ts` — add `import { getFetch } from './error'`; in `listFavorites` replace `await fetch(` with `await getFetch(`:

```ts
export async function listFavorites(rowerID: string): Promise<Favorite[]> {
  const res = await getFetch(`/api/v1/favorites?rower_id=${encodeURIComponent(rowerID)}`)
  if (!res.ok) throw new ApiError(res.status, `listFavorites: ${res.status}`)
  const body = (await res.json()) as { favorites?: Favorite[] }
  return body.favorites ?? []
}
```

4. `web/src/api/workouts.ts` — add `import { getFetch } from './error'` (keep the existing ApiError import); in `getWorkout` replace `await fetch(` with `await getFetch(`:

```ts
export async function getWorkout(id: string): Promise<Workout> {
  const res = await getFetch(`/api/v1/workouts/${encodeURIComponent(id)}`)
  if (!res.ok) throw new ApiError(res.status, `getWorkout: ${res.status}`)
  return res.json()
}
```

- [ ] **Step 6: Full check**

Run: `cd /Users/dg/dev/ruderergo-stats/web && npx tsc --noEmit && npx vitest run src/api src/pages src/app`
Expected: PASS — existing page tests stub `fetch` globally, which `getFetch` still goes through.

- [ ] **Step 7: Commit**

```bash
cd /Users/dg/dev/ruderergo-stats && git add web/src/api
git commit -m "feat(api): 6s timeout on history/bootstrap reads via getFetch"
```

---

### Task 4: `formatStand` date formatter

**Files:**
- Modify: `web/src/util/dates.ts`
- Test: `web/src/util/dates.test.ts` (add cases; create the file with this content if absent)

- [ ] **Step 1: Write the failing test**

Add to `web/src/util/dates.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { formatStand } from './dates'

describe('formatStand', () => {
  // Local-time inputs (no Z) keep the assertion timezone-independent.
  it('renders day, long month, comma, hh:mm', () => {
    expect(formatStand('2026-06-12T18:42:00')).toBe('12. Juni, 18:42')
  })
  it('pads minutes and hours', () => {
    expect(formatStand('2026-01-03T08:05:00')).toBe('3. Januar, 08:05')
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `cd /Users/dg/dev/ruderergo-stats/web && npx vitest run src/util/dates.test.ts`
Expected: FAIL — `formatStand` not exported

- [ ] **Step 3: Implement** (append to `dates.ts`; reuse the file's private `hhmm`)

```ts
// formatStand renders the Stand label of the offline snapshot
// (CONTEXT.md §Stand): "12. Juni, 18:42".
export function formatStand(isoStr: string): string {
  const d = new Date(isoStr)
  const date = d.toLocaleDateString('de-DE', { day: 'numeric', month: 'long' })
  return `${date}, ${hhmm(d)}`
}
```

- [ ] **Step 4: Run the test**

Run: `cd /Users/dg/dev/ruderergo-stats/web && npx vitest run src/util/dates.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd /Users/dg/dev/ruderergo-stats && git add web/src/util/dates.ts web/src/util/dates.test.ts
git commit -m "feat(util): formatStand for the offline Stand label"
```

---

### Task 5: Ergo status store (`useErgoStatus`)

**Files:**
- Create: `web/src/offline/ergoStatus.ts`
- Test: `web/src/offline/ergoStatus.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { QueryClient } from '@tanstack/react-query'
import {
  attachReachabilityListener,
  getErgoStatus,
  setErgoStatus,
  subscribeErgoStatus,
  _resetErgoStatusForTest,
} from './ergoStatus'

describe('ergoStatus store', () => {
  beforeEach(() => _resetErgoStatusForTest())

  it('starts reachable with no Stand', () => {
    expect(getErgoStatus()).toEqual({ reachable: true, packedAt: null, packedSessions: 0 })
  })

  it('patches and notifies subscribers once per change', () => {
    let calls = 0
    subscribeErgoStatus(() => calls++)
    setErgoStatus({ reachable: false })
    setErgoStatus({ reachable: false }) // no-op patch — no notify
    expect(calls).toBe(1)
    expect(getErgoStatus().reachable).toBe(false)
  })

  it('any successful query flips reachable back on', async () => {
    setErgoStatus({ reachable: false })
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    attachReachabilityListener(qc)
    await qc.fetchQuery({ queryKey: ['probe'], queryFn: async () => 42 })
    expect(getErgoStatus().reachable).toBe(true)
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `cd /Users/dg/dev/ruderergo-stats/web && npx vitest run src/offline/ergoStatus.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement `ergoStatus.ts`**

```ts
import { useSyncExternalStore } from 'react'
import type { QueryClient } from '@tanstack/react-query'

// ErgoStatus is the app-level "Ergo nicht erreichbar" signal
// (CONTEXT.md). reachable is probe-driven, deliberately not
// navigator.onLine: at the club the phone IS online — the Ergo isn't.
// packedAt/packedSessions mirror the offline cursor for the Stand
// label and the Profile status line.
export type ErgoStatus = {
  reachable: boolean
  packedAt: string | null
  packedSessions: number
}

const INITIAL: ErgoStatus = { reachable: true, packedAt: null, packedSessions: 0 }

let status: ErgoStatus = INITIAL
const listeners = new Set<() => void>()

export function getErgoStatus(): ErgoStatus {
  return status
}

export function setErgoStatus(patch: Partial<ErgoStatus>): void {
  const next = { ...status, ...patch }
  if (
    next.reachable === status.reachable &&
    next.packedAt === status.packedAt &&
    next.packedSessions === status.packedSessions
  ) {
    return
  }
  status = next
  for (const fn of listeners) fn()
}

export function subscribeErgoStatus(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function useErgoStatus(): ErgoStatus {
  return useSyncExternalStore(subscribeErgoStatus, getErgoStatus, getErgoStatus)
}

// Any successful query response proves the Ergo is reachable again —
// flips the banner off without waiting for the next probe.
export function attachReachabilityListener(qc: QueryClient): void {
  qc.getQueryCache().subscribe((event) => {
    if (event.type === 'updated' && event.action.type === 'success') {
      setErgoStatus({ reachable: true })
    }
  })
}

export function _resetErgoStatusForTest(): void {
  status = INITIAL
  listeners.clear()
}
```

- [ ] **Step 4: Run the test**

Run: `cd /Users/dg/dev/ruderergo-stats/web && npx vitest run src/offline/ergoStatus.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd /Users/dg/dev/ruderergo-stats && git add web/src/offline/ergoStatus.ts web/src/offline/ergoStatus.test.ts
git commit -m "feat(offline): ergo reachability/Stand store with useErgoStatus"
```

---

### Task 6: Pack module — probe, full pack, prune, triggers

The heart of ADR-0018. One `stats_version` probe per trigger; full pack only on cursor miss; prune bounds local storage; cursor written only after full success.

**Files:**
- Create: `web/src/offline/pack.ts`
- Test: `web/src/offline/pack.test.ts`

- [ ] **Step 1: Write the failing tests**

`web/src/offline/pack.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { QueryClient } from '@tanstack/react-query'

const store = new Map<string, unknown>()
vi.mock('idb-keyval', () => ({
  get: vi.fn(async (k: string) => store.get(k)),
  set: vi.fn(async (k: string, v: unknown) => void store.set(k, v)),
  del: vi.fn(async (k: string) => void store.delete(k)),
}))

const trends = (w: string) => ({
  window: w,
  from: '',
  to: '',
  points: [
    { t: '2026-06-01T10:00:00Z', session_id: 'S1' },
    { t: '2026-06-10T10:00:00Z', session_id: 'S2' },
  ],
  series: [],
  totals: { distance_m: 0, active_sec: 0, sessions: 2 },
  stats_version: 5,
})

vi.mock('../api/client', () => ({
  getRowerAchievements: vi.fn(async () => []),
  getRowerLifetime: vi.fn(async () => ({
    total_distance_m: 1, total_active_sec: 1, total_strokes: 1,
    total_sessions: 2, stats_version: 5,
  })),
  getRowerPBs: vi.fn(async () => ({ distance: [], window: [], workout: [] })),
  getRowerTrends: vi.fn(async (_id: string, w: string) => trends(w)),
  getSamples: vi.fn(async () => []),
  getSession: vi.fn(async (id: string) => ({ id, workout_id: `W-${id}` })),
}))
vi.mock('../api/rowers', () => ({
  getActiveRower: vi.fn(async () => ({ id: 'R1', name: 'T', color: '#fff', created_at: '' })),
}))
vi.mock('../api/workouts', () => ({
  getWorkout: vi.fn(async (id: string) => ({ id, mode: 'time' })),
}))

import * as client from '../api/client'
import * as rowers from '../api/rowers'
import { packIfStale, onAppVisible, _resetPackForTest } from './pack'
import { getErgoStatus, _resetErgoStatusForTest } from './ergoStatus'
import type { OfflineCursor } from './cursor'

const CURSOR_KEY = 'splits:offline-cursor'
const qcOpts = { defaultOptions: { queries: { retry: false } } }

describe('packIfStale', () => {
  beforeEach(() => {
    store.clear()
    vi.clearAllMocks()
    vi.useFakeTimers({ now: new Date('2026-06-12T10:00:00Z') })
    _resetPackForTest()
    _resetErgoStatusForTest()
  })
  afterEach(() => vi.useRealTimers())

  it('full pack on empty cursor: trends ×3, records, last sessions, cursor written', async () => {
    const qc = new QueryClient(qcOpts)
    await packIfStale(qc)
    expect(client.getRowerTrends).toHaveBeenCalledTimes(3)
    expect(client.getRowerPBs).toHaveBeenCalledWith('R1')
    expect(client.getRowerAchievements).toHaveBeenCalledWith('R1')
    expect(client.getSession).toHaveBeenCalledTimes(2)
    expect(client.getSamples).toHaveBeenCalledTimes(2)
    const cursor = store.get(CURSOR_KEY) as OfflineCursor
    expect(cursor.statsVersion).toBe(5)
    expect(cursor.rowerId).toBe('R1')
    // newest first
    expect(cursor.sessionIds).toEqual(['S2', 'S1'])
    expect(getErgoStatus()).toMatchObject({ reachable: true, packedSessions: 2 })
    expect(getErgoStatus().packedAt).not.toBeNull()
  })

  it('cursor hit: probe only, no trends fetch', async () => {
    const qc = new QueryClient(qcOpts)
    await packIfStale(qc)
    vi.clearAllMocks()
    _resetPackForTest()
    await packIfStale(qc)
    expect(client.getRowerLifetime).toHaveBeenCalledTimes(1)
    expect(client.getRowerTrends).not.toHaveBeenCalled()
  })

  it('version bump: full pack again, immutable cached sessions not refetched', async () => {
    const qc = new QueryClient(qcOpts)
    await packIfStale(qc)
    vi.clearAllMocks()
    _resetPackForTest()
    vi.mocked(client.getRowerLifetime).mockResolvedValue({
      total_distance_m: 1, total_active_sec: 1, total_strokes: 1,
      total_sessions: 3, stats_version: 6,
    })
    await packIfStale(qc)
    expect(client.getRowerTrends).toHaveBeenCalledTimes(3)
    // S1/S2 already in the cache with staleTime: Infinity
    expect(client.getSession).not.toHaveBeenCalled()
  })

  it('buildSha mismatch forces a full pack despite matching version', async () => {
    const qc = new QueryClient(qcOpts)
    store.set(CURSOR_KEY, {
      rowerId: 'R1', statsVersion: 5, buildSha: 'someone-elses-build',
      packedAt: '2026-06-12T09:00:00.000Z', sessionIds: ['S2', 'S1'],
    } satisfies OfflineCursor)
    await packIfStale(qc)
    expect(client.getRowerTrends).toHaveBeenCalledTimes(3)
  })

  it('pack older than 24h forces a full pack (rolling-window drift)', async () => {
    const qc = new QueryClient(qcOpts)
    await packIfStale(qc)
    vi.clearAllMocks()
    _resetPackForTest()
    vi.setSystemTime(new Date('2026-06-13T11:00:00Z'))
    await packIfStale(qc)
    expect(client.getRowerTrends).toHaveBeenCalledTimes(3)
  })

  it('a failing pack step writes no cursor', async () => {
    const qc = new QueryClient(qcOpts)
    vi.mocked(client.getRowerTrends).mockRejectedValue(new Error('boom'))
    await packIfStale(qc)
    expect(store.get(CURSOR_KEY)).toBeUndefined()
  })

  it('probe failure flips unreachable and stops; Stand survives from the cursor', async () => {
    store.set(CURSOR_KEY, {
      rowerId: 'R1', statsVersion: 5, buildSha: 'x',
      packedAt: '2026-06-11T09:00:00.000Z', sessionIds: ['S2'],
    } satisfies OfflineCursor)
    const qc = new QueryClient(qcOpts)
    vi.mocked(rowers.getActiveRower).mockRejectedValue(new Error('timeout'))
    await packIfStale(qc)
    expect(getErgoStatus()).toMatchObject({
      reachable: false,
      packedAt: '2026-06-11T09:00:00.000Z',
      packedSessions: 1,
    })
    expect(client.getRowerTrends).not.toHaveBeenCalled()
  })

  it('prune removes sessions outside the keep-set and foreign-rower aggregates', async () => {
    const qc = new QueryClient(qcOpts)
    qc.setQueryData(['sessions', 'OLD'], { id: 'OLD' })
    qc.setQueryData(['sessions', 'OLD', 'samples'], [])
    qc.setQueryData(['workout', 'W-OLD'], { id: 'W-OLD' })
    qc.setQueryData(['rower-trends', 'R9', '30d'], { points: [] })
    qc.setQueryData(['rower-pbs', 'R9'], {})
    await packIfStale(qc)
    expect(qc.getQueryData(['sessions', 'OLD'])).toBeUndefined()
    expect(qc.getQueryData(['sessions', 'OLD', 'samples'])).toBeUndefined()
    expect(qc.getQueryData(['workout', 'W-OLD'])).toBeUndefined()
    expect(qc.getQueryData(['rower-trends', 'R9', '30d'])).toBeUndefined()
    expect(qc.getQueryData(['rower-pbs', 'R9'])).toBeUndefined()
    // keep-set intact
    expect(qc.getQueryData(['sessions', 'S2'])).toBeDefined()
    expect(qc.getQueryData(['workout', 'W-S2'])).toBeDefined()
    expect(qc.getQueryData(['rower-trends', 'R1', '30d'])).toBeDefined()
  })

  it('resume guard: a fresh successful probe suppresses onAppVisible for 15 min', async () => {
    const qc = new QueryClient(qcOpts)
    await packIfStale(qc)
    vi.clearAllMocks()
    onAppVisible(qc)
    await vi.runAllTimersAsync()
    expect(client.getRowerLifetime).not.toHaveBeenCalled()
    vi.setSystemTime(new Date('2026-06-12T10:16:00Z'))
    onAppVisible(qc)
    await vi.runAllTimersAsync()
    expect(client.getRowerLifetime).toHaveBeenCalledTimes(1)
  })

  it('failure does not arm the guard: next visible retries immediately', async () => {
    const qc = new QueryClient(qcOpts)
    vi.mocked(rowers.getActiveRower).mockRejectedValueOnce(new Error('down'))
    await packIfStale(qc)
    vi.clearAllMocks()
    onAppVisible(qc)
    await vi.runAllTimersAsync()
    expect(rowers.getActiveRower).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `cd /Users/dg/dev/ruderergo-stats/web && npx vitest run src/offline/pack.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement `pack.ts`**

```ts
import type { QueryClient } from '@tanstack/react-query'
import {
  getRowerAchievements,
  getRowerLifetime,
  getRowerPBs,
  getRowerTrends,
  getSamples,
  getSession,
  type RowerLifetime,
  type SessionRow,
  type TrendsResponse,
} from '../api/client'
import { getActiveRower } from '../api/rowers'
import { getWorkout } from '../api/workouts'
import { loadCursor, saveCursor } from './cursor'
import { setErgoStatus } from './ergoStatus'

// Spec §Data volume & storage bounds: the bag carries the last N
// sessions; everything outside the keep-set is pruned per pack.
export const OFFLINE_SESSION_DEPTH = 10
// Resume guard: foreground-flapping must not hammer the Pi Zero.
export const PACK_GUARD_MS = 15 * 60_000
// Trends windows are rolling — even an unchanged stats_version lets
// chart content drift, so a pack older than a day refreshes anyway.
const FULL_PACK_MAX_AGE_MS = 24 * 60 * 60_000

let inFlight = false
let lastProbeOkAt = 0
let triggersRegistered = false

export function _resetPackForTest(): void {
  inFlight = false
  lastProbeOkAt = 0
}

// packIfStale is ADR-0018's cursor-driven pack: probe stats_version
// (one request), full-pack only when the cursor misses, write the
// cursor only after complete success.
export async function packIfStale(qc: QueryClient): Promise<void> {
  if (inFlight) return
  inFlight = true
  try {
    const cursor = await loadCursor()
    if (cursor) {
      setErgoStatus({ packedAt: cursor.packedAt, packedSessions: cursor.sessionIds.length })
    }

    // Probe phase. retry: false everywhere in this module — a doomed
    // pack must fail in one timeout, not a retry storm.
    let rid: string
    let lifetime: RowerLifetime
    try {
      const rower = await qc.fetchQuery({
        queryKey: ['active-rower'],
        queryFn: getActiveRower,
        staleTime: 10_000,
        retry: false,
      })
      if (!rower) return // reachable, nobody paired — nothing to pack
      rid = rower.id
      lifetime = await qc.fetchQuery({
        queryKey: ['rower-lifetime', rid],
        queryFn: () => getRowerLifetime(rid),
        staleTime: 0,
        retry: false,
      })
    } catch {
      setErgoStatus({ reachable: false })
      return
    }
    lastProbeOkAt = Date.now()
    setErgoStatus({ reachable: true })

    const fresh =
      cursor !== null &&
      cursor.rowerId === rid &&
      cursor.statsVersion === lifetime.stats_version &&
      cursor.buildSha === __BUILD_SHA__ &&
      Date.now() - Date.parse(cursor.packedAt) < FULL_PACK_MAX_AGE_MS
    if (fresh) return

    // Full pack. Any throw lands in the outer catch: no cursor write,
    // the next trigger retries everything (idempotent — immutable
    // session entries short-circuit via staleTime: Infinity).
    const trendsAll = await qc.fetchQuery<TrendsResponse>({
      queryKey: ['rower-trends', rid, 'all'],
      queryFn: () => getRowerTrends(rid, 'all'),
      staleTime: 0,
      retry: false,
    })
    for (const w of ['30d', '365d'] as const) {
      await qc.fetchQuery({
        queryKey: ['rower-trends', rid, w],
        queryFn: () => getRowerTrends(rid, w),
        staleTime: 0,
        retry: false,
      })
    }
    await qc.fetchQuery({
      queryKey: ['rower-pbs', rid],
      queryFn: () => getRowerPBs(rid),
      staleTime: 0,
      retry: false,
    })
    await qc.fetchQuery({
      queryKey: ['rower-achievements', rid],
      queryFn: () => getRowerAchievements(rid),
      staleTime: 0,
      retry: false,
    })

    // Last-N session IDs come from the trends response itself — the
    // Verlauf list is embedded there; no separate listSessions call.
    const ids = [...trendsAll.points]
      .sort((a, b) => (a.t < b.t ? 1 : -1))
      .slice(0, OFFLINE_SESSION_DEPTH)
      .map((p) => p.session_id)

    for (const id of ids) {
      const s = await qc.fetchQuery<SessionRow>({
        queryKey: ['sessions', id],
        queryFn: () => getSession(id),
        staleTime: Infinity,
        retry: false,
      })
      await qc.fetchQuery({
        queryKey: ['sessions', id, 'samples'],
        queryFn: () => getSamples(id),
        staleTime: Infinity,
        retry: false,
      })
      if (s.workout_id) {
        const wid = s.workout_id
        await qc.fetchQuery({
          queryKey: ['workout', wid],
          queryFn: () => getWorkout(wid),
          staleTime: Infinity,
          retry: false,
        })
      }
    }

    pruneOutsideKeepSet(qc, rid, ids)

    const packedAt = new Date().toISOString()
    await saveCursor({
      rowerId: rid,
      statsVersion: lifetime.stats_version,
      buildSha: __BUILD_SHA__,
      packedAt,
      sessionIds: ids,
    })
    setErgoStatus({ packedAt, packedSessions: ids.length })
  } catch {
    // No cursor write on failure — the next trigger retries.
  } finally {
    inFlight = false
  }
}

const ROWER_SCOPED = new Set([
  'rower-trends',
  'rower-pbs',
  'rower-achievements',
  'rower-lifetime',
  'favorites',
])

// Storage bound (spec §Data volume): drop inactive cache entries
// outside the keep-set so the persisted blob cannot grow unbounded
// under the 30-day gcTime.
function pruneOutsideKeepSet(qc: QueryClient, rowerId: string, keepIds: string[]): void {
  const keep = new Set(keepIds)
  const keptWorkouts = new Set<string>()
  for (const id of keepIds) {
    const s = qc.getQueryData<SessionRow>(['sessions', id])
    if (s?.workout_id) keptWorkouts.add(s.workout_id)
  }
  qc.removeQueries({
    type: 'inactive',
    predicate: (q) => {
      const [k0, k1] = q.queryKey
      if (k0 === 'sessions' && typeof k1 === 'string' && k1 !== 'stale-open') return !keep.has(k1)
      if (k0 === 'workout' && typeof k1 === 'string') return !keptWorkouts.has(k1)
      if (typeof k0 === 'string' && ROWER_SCOPED.has(k0)) return k1 !== rowerId
      return false
    },
  })
}

export function onAppVisible(qc: QueryClient): void {
  if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return
  // Guard arms only on a successful probe — failures retry on the
  // next resume immediately.
  if (Date.now() - lastProbeOkAt < PACK_GUARD_MS) return
  void packIfStale(qc)
}

// Boot + resume triggers (spec §Prefetch). Idempotent: StrictMode/dev
// double-invocation must not double the listeners.
export function registerPackTriggers(qc: QueryClient): void {
  if (triggersRegistered) return
  triggersRegistered = true
  const idle = (fn: () => void) =>
    'requestIdleCallback' in window
      ? window.requestIdleCallback(fn)
      : window.setTimeout(fn, 1500)
  idle(() => void packIfStale(qc))
  document.addEventListener('visibilitychange', () => onAppVisible(qc))
}
```

- [ ] **Step 4: Run the tests**

Run: `cd /Users/dg/dev/ruderergo-stats/web && npx vitest run src/offline/pack.test.ts`
Expected: PASS. If the boot-idle test path complains about `requestIdleCallback` in jsdom, that's only inside `registerPackTriggers`, which these tests don't call.

- [ ] **Step 5: Commit**

```bash
cd /Users/dg/dev/ruderergo-stats && git add web/src/offline/pack.ts web/src/offline/pack.test.ts
git commit -m "feat(offline): cursor-driven pack with prune and resume guard"
```

---

### Task 7: Wire `main.tsx` — persistence provider, gcTime, triggers

**Files:**
- Modify: `web/src/main.tsx`

- [ ] **Step 1: Extend imports**

In `web/src/main.tsx`, extend the react-query import and add the offline imports:

```ts
import {
  QueryClient,
  QueryCache,
  MutationCache,
  defaultShouldDehydrateQuery,
} from '@tanstack/react-query'
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client'

import { idbPersister, PERSIST_MAX_AGE_MS } from './offline/persister'
import { isPersistableQuery } from './offline/persistKeys'
import { attachReachabilityListener } from './offline/ergoStatus'
import { registerPackTriggers } from './offline/pack'
```

(`QueryClientProvider` drops out of the import — the persist provider replaces it.)

- [ ] **Step 2: Set `gcTime` in the QueryClient defaults**

In the existing `new QueryClient({ defaultOptions: { queries: { ... } } })` block, add directly under `staleTime: 30_000`:

```ts
      // gcTime must be ≥ the persisted maxAge: the default 5-min GC
      // collects prefetched-but-unmounted queries and the next persist
      // flush would drop them from IndexedDB — the offline bag would
      // silently empty minutes after packing (spec §Persistence layer).
      gcTime: PERSIST_MAX_AGE_MS,
```

- [ ] **Step 3: Attach the reachability listener and storage persistence**

After the `const queryClient = new QueryClient({...})` statement:

```ts
attachReachabilityListener(queryClient)

// Best-effort: ask the browser not to evict IndexedDB (iOS PWA
// eviction). If it evicts anyway, the next at-home pack self-heals.
void navigator.storage?.persist?.()
```

- [ ] **Step 4: Swap the provider**

Replace the render block at the bottom:

```tsx
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{
        persister: idbPersister,
        maxAge: PERSIST_MAX_AGE_MS,
        // A deploy busts the persisted cache; the cursor carries the
        // same sha so the next pack runs in full (spec §Prefetch).
        buster: __BUILD_SHA__,
        dehydrateOptions: {
          shouldDehydrateQuery: (q) =>
            defaultShouldDehydrateQuery(q) && isPersistableQuery(q.queryKey),
        },
      }}
      // Restore finished — packing may now compare against the
      // restored cache instead of racing it.
      onSuccess={() => registerPackTriggers(queryClient)}
    >
      <AppRouter />
      <ToastHost />
    </PersistQueryClientProvider>
  </StrictMode>,
)
```

- [ ] **Step 5: Verify**

Run: `cd /Users/dg/dev/ruderergo-stats/web && npx tsc --noEmit && npx vitest run src`
Expected: clean typecheck; full unit suite PASS (component tests build their own plain QueryClientProvider and are unaffected).

- [ ] **Step 6: Commit**

```bash
cd /Users/dg/dev/ruderergo-stats && git add web/src/main.tsx
git commit -m "feat(offline): persist query cache to IndexedDB, pack on boot/resume"
```

---

### Task 8: `ErgoStandNotice` component (banner + hero)

**Files:**
- Create: `web/src/offline/ErgoStandNotice.tsx`
- Create: `web/src/offline/ErgoStandNotice.module.css`
- Test: `web/src/offline/ErgoStandNotice.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { ErgoStandNotice } from './ErgoStandNotice'
import { setErgoStatus, _resetErgoStatusForTest } from './ergoStatus'

function renderNotice(variant: 'banner' | 'hero') {
  return render(
    <MemoryRouter>
      <ErgoStandNotice variant={variant} />
    </MemoryRouter>,
  )
}

describe('ErgoStandNotice', () => {
  beforeEach(() => _resetErgoStatusForTest())

  it('renders nothing while the Ergo is reachable', () => {
    renderNotice('banner')
    expect(screen.queryByTestId('ergo-stand-banner')).toBeNull()
  })

  it('banner shows the canonical copy with the Stand', () => {
    setErgoStatus({ reachable: false, packedAt: '2026-06-12T18:42:00', packedSessions: 10 })
    renderNotice('banner')
    expect(screen.getByTestId('ergo-stand-banner').textContent).toBe(
      'Ergo nicht erreichbar · Stand: 12. Juni, 18:42',
    )
  })

  it('banner degrades without a Stand (never packed)', () => {
    setErgoStatus({ reachable: false })
    renderNotice('banner')
    expect(screen.getByTestId('ergo-stand-banner').textContent).toBe('Ergo nicht erreichbar')
  })

  it('hero shows title, Stand and the Verlauf CTA', () => {
    setErgoStatus({ reachable: false, packedAt: '2026-06-12T18:42:00', packedSessions: 10 })
    renderNotice('hero')
    expect(screen.getByTestId('ergo-offline-hero')).toBeInTheDocument()
    expect(screen.getByText('Ergo nicht erreichbar')).toBeInTheDocument()
    expect(screen.getByText('Stand: 12. Juni, 18:42')).toBeInTheDocument()
    expect(screen.getByTestId('ergo-offline-cta')).toHaveAttribute('href', '/historie')
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `cd /Users/dg/dev/ruderergo-stats/web && npx vitest run src/offline/ErgoStandNotice.test.tsx`
Expected: FAIL — module not found

- [ ] **Step 3: Implement the component**

`ErgoStandNotice.tsx`:

```tsx
import { Link } from 'react-router-dom'
import { formatStand } from '../util/dates'
import { useErgoStatus } from './ergoStatus'
import styles from './ErgoStandNotice.module.css'

// The one shared source of the "Ergo nicht erreichbar · Stand: …"
// string (CONTEXT.md): Historie/session-detail banner and the Home
// hero card cannot drift apart. Never the word "Offline" — the phone
// is online; the Ergo isn't reachable.
export function ErgoStandNotice({ variant }: { variant: 'banner' | 'hero' }) {
  const { reachable, packedAt } = useErgoStatus()
  if (reachable) return null

  if (variant === 'banner') {
    return (
      <p className={styles.banner} data-testid="ergo-stand-banner" role="status">
        Ergo nicht erreichbar{packedAt ? ` · Stand: ${formatStand(packedAt)}` : ''}
      </p>
    )
  }
  return (
    <section className={styles.hero} data-testid="ergo-offline-hero">
      <p className={styles.heroTitle}>Ergo nicht erreichbar</p>
      {packedAt && <p className={styles.heroStand}>Stand: {formatStand(packedAt)}</p>}
      <Link to="/historie" className={styles.heroCta} data-testid="ergo-offline-cta">
        → Verlauf ansehen
      </Link>
    </section>
  )
}
```

`ErgoStandNotice.module.css` (tokens follow the existing `var(--…)` conventions in `src/styles/tokens.css`; check the names there and adjust if they differ):

```css
.banner {
  margin: 0 0 12px;
  padding: 8px 12px;
  border-radius: 8px;
  background: var(--surface-2, rgba(255, 255, 255, 0.06));
  color: var(--text-secondary, #9aa0a6);
  font-size: 0.85rem;
}

.hero {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-bottom: 16px;
  padding: 16px;
  border-radius: 12px;
  background: var(--surface-2, rgba(255, 255, 255, 0.06));
}

.heroTitle {
  margin: 0;
  font-weight: 600;
}

.heroStand {
  margin: 0;
  color: var(--text-secondary, #9aa0a6);
  font-size: 0.85rem;
}

.heroCta {
  margin-top: 8px;
  font-weight: 600;
  text-decoration: none;
  color: var(--accent, #2dd4bf);
}
```

- [ ] **Step 4: Run the test**

Run: `cd /Users/dg/dev/ruderergo-stats/web && npx vitest run src/offline/ErgoStandNotice.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd /Users/dg/dev/ruderergo-stats && git add web/src/offline/ErgoStandNotice.tsx web/src/offline/ErgoStandNotice.module.css web/src/offline/ErgoStandNotice.test.tsx
git commit -m "feat(offline): ErgoStandNotice — shared banner/hero with Stand label"
```

---

### Task 9: Historie integration — banner, data-first gate, dimmed rows

**Files:**
- Modify: `web/src/pages/HistoryPage.tsx`
- Modify: `web/src/pages/history/VerlaufTab.tsx`
- Modify: `web/src/pages/history/VerlaufTab.module.css`
- Test: `web/src/pages/history/VerlaufTab.test.tsx` (add cases)

- [ ] **Step 1: Banner on HistoryPage** (covers Verlauf + Rekorde via the Outlet)

```tsx
import { NavLink, Outlet } from 'react-router-dom'
import { ErgoStandNotice } from '../offline/ErgoStandNotice'
import styles from './HistoryPage.module.css'

export function HistoryPage() {
  return (
    <div className={styles.page}>
      <h1 className="headline-sm">Historie</h1>
      <ErgoStandNotice variant="banner" />
      <nav className={styles.subnav} aria-label="Historie">
        {/* …existing NavLinks unchanged… */}
```

- [ ] **Step 2: VerlaufTab — data-first error gate**

In `web/src/pages/history/VerlaufTab.tsx`, the unconditional error line currently renders *alongside* restored data. Replace:

```tsx
        {error && <p className={styles.placeholder}>Konnte Verlauf nicht laden.</p>}
```

with:

```tsx
        {error && !data && <p className={styles.placeholder}>Konnte Verlauf nicht laden.</p>}
```

- [ ] **Step 3: VerlaufTab — dim rows whose detail is not in the bag**

Extend the imports at the top of `VerlaufTab.tsx`:

```ts
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useErgoStatus } from '../../offline/ergoStatus'
```

Replace the whole `SessionList` function with:

```tsx
function SessionList({ data, highlightId }: { data: TrendsResponse; highlightId: string | null }) {
  const qc = useQueryClient()
  const { reachable } = useErgoStatus()
  const labelByShape = new Map(data.series.map((s) => [s.key.shape_hash, s.display_name]))
  const rows = [...data.points].sort((a, b) => (a.t < b.t ? 1 : -1))

  const fmtTime = (sec: number) => {
    const m = Math.floor(sec / 60)
    const s = Math.floor(sec % 60)
    return `${m}:${s.toString().padStart(2, '0')}`
  }

  return (
    <section className={styles.list} aria-label="Sessions">
      {rows.map((q) => {
        const body = (
          <>
            <div className={styles.rowMain}>
              <span className={styles.rowDate}>{new Date(q.t).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit' })}</span>
              <span className={styles.rowChip}>{shapeChip(q, labelByShape)}</span>
              {q.distance_pb && (
                <span data-testid={`verlauf-pb-${q.session_id}`} role="img" aria-label="Neue Bestleistung">🏆</span>
              )}
            </div>
            <div className={styles.rowStats}>
              <span>{q.distance_m} m</span>
              <span>{fmtTime(q.time_sec)}</span>
              <span className={styles.rowSplit}>{pace500m(q.avg_pace_sec_per_500m)}</span>
            </div>
          </>
        )
        // Unterwegs, a row whose detail is not in the bag stays
        // readable (inline aggregates) but is not navigable — no
        // dead-end error screens mid-demo (spec §Staleness UI).
        const inBag = reachable || !!qc.getQueryState(['sessions', q.session_id])?.data
        if (!inBag) {
          return (
            <div
              key={q.session_id}
              data-testid={`verlauf-row-${q.session_id}`}
              aria-disabled="true"
              className={`${styles.row} ${styles.rowOffline}`}
            >
              {body}
            </div>
          )
        }
        return (
          <Link key={q.session_id} to={`/historie/${q.session_id}`}
            data-testid={`verlauf-row-${q.session_id}`}
            className={q.session_id === highlightId ? `${styles.row} ${styles.rowActive}` : styles.row}>
            {body}
          </Link>
        )
      })}
    </section>
  )
}
```

Append to `VerlaufTab.module.css`:

```css
.rowOffline {
  opacity: 0.45;
}
```

- [ ] **Step 4: Add the test cases**

Append to `web/src/pages/history/VerlaufTab.test.tsx` (reuse that file's existing render/QueryClient helper for mounting; the cases below show the assertions and setup that matter — adapt the mounting call to the file's helper):

```tsx
import { setErgoStatus, _resetErgoStatusForTest } from '../../offline/ergoStatus'

// inside the describe block:
it('unreachable: rows without cached detail are dimmed, cached rows stay links', async () => {
  _resetErgoStatusForTest()
  setErgoStatus({ reachable: false, packedAt: '2026-06-12T10:00:00' })
  // qc: the test QueryClient used by this file's render helper.
  // Trends data with two points S-cached / S-missing seeded the same
  // way the existing tests seed ['rower-trends', …]; additionally:
  qc.setQueryData(['sessions', 'S-cached'], { id: 'S-cached' })

  // …render via the file's helper…

  const cached = await screen.findByTestId('verlauf-row-S-cached')
  expect(cached.tagName).toBe('A')
  const missing = screen.getByTestId('verlauf-row-S-missing')
  expect(missing.tagName).toBe('DIV')
  expect(missing).toHaveAttribute('aria-disabled', 'true')
})

it('unreachable with restored data: no error placeholder', async () => {
  _resetErgoStatusForTest()
  setErgoStatus({ reachable: false })
  // seed trends data into the cache, then render; the query refetch
  // failing is irrelevant because data is present:
  expect(screen.queryByText('Konnte Verlauf nicht laden.')).toBeNull()
})
```

Also reset the store for the pre-existing tests: add `beforeEach(() => _resetErgoStatusForTest())` to the top-level describe so reachability defaults to `true` for them.

- [ ] **Step 5: Run the tests**

Run: `cd /Users/dg/dev/ruderergo-stats/web && npx vitest run src/pages/history/VerlaufTab.test.tsx src/pages/HistoryPage.test.tsx`
Expected: PASS (HistoryPage test may need a `MemoryRouter`-wrapped render already present; the notice renders `null` while reachable, so existing snapshots hold)

- [ ] **Step 6: Commit**

```bash
cd /Users/dg/dev/ruderergo-stats && git add web/src/pages/HistoryPage.tsx web/src/pages/history
git commit -m "feat(offline): Historie banner, data-first Verlauf gate, dimmed non-cached rows"
```

---

### Task 10: SessionDetailPage — data-first gate + banner

**Files:**
- Modify: `web/src/pages/SessionDetailPage.tsx`
- Test: `web/src/pages/SessionDetailPage.test.tsx` (add case)

- [ ] **Step 1: Fix the error gate**

`SessionDetailPage.tsx` line ~63 currently flips to the error screen even when restored data exists. Replace:

```tsx
  if (sessionQ.error || !sessionQ.data) {
```

with:

```tsx
  // Data-first (spec §Staleness UI): with restored offline data the
  // failing refetch must not evict the page — banner instead.
  if (!sessionQ.data) {
```

- [ ] **Step 2: Add the banner**

Import at the top:

```ts
import { ErgoStandNotice } from '../offline/ErgoStandNotice'
```

In the success render, directly after the `← Zurück` link:

```tsx
      <ErgoStandNotice variant="banner" />
```

- [ ] **Step 3: Add the test case**

Append to `SessionDetailPage.test.tsx` (mount via the file's existing render helper; the decisive setup is seeding data + making the refetch fail):

```tsx
import { _resetErgoStatusForTest } from '../offline/ergoStatus'

it('renders cached session data even when the refetch errors', async () => {
  _resetErgoStatusForTest()
  // Seed the cache the way this file seeds successful queries, but
  // point fetch at a rejecting mock so the mount-refetch fails:
  qc.setQueryData(['sessions', 'S1'], sessionFixture) // the file's fixture
  qc.setQueryData(['sessions', 'S1', 'samples'], [])
  vi.stubGlobal('fetch', () => Promise.reject(new TypeError('unreachable')))

  // …render at route /historie/S1 via the file's helper…

  expect(await screen.findByTestId('detail-total-distance')).toBeInTheDocument()
  expect(screen.queryByText('Session nicht gefunden.')).toBeNull()
})
```

Add `beforeEach(() => _resetErgoStatusForTest())` to the describe block.

- [ ] **Step 4: Run the tests**

Run: `cd /Users/dg/dev/ruderergo-stats/web && npx vitest run src/pages/SessionDetailPage.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd /Users/dg/dev/ruderergo-stats && git add web/src/pages/SessionDetailPage.tsx web/src/pages/SessionDetailPage.test.tsx
git commit -m "fix(offline): session detail is data-first — cached data survives a failing refetch"
```

---

### Task 11: Home offline state — hero card + dimmed start affordances

**Files:**
- Modify: `web/src/pages/HomePage.tsx`, `web/src/pages/HomePage.module.css`
- Modify: `web/src/pages/home/FavoritesList.tsx`, `web/src/pages/home/FavoritesList.module.css`
- Test: `web/src/pages/HomePage.test.tsx`, `web/src/pages/home/FavoritesList.test.tsx` (add cases)

- [ ] **Step 1: HomePage** — imports and unreachable state:

```tsx
import { ErgoStandNotice } from '../offline/ErgoStandNotice'
import { useErgoStatus } from '../offline/ergoStatus'
```

Inside `HomePage()`:

```tsx
  const { reachable } = useErgoStatus()
```

Render changes (top of `<main>`, then the start section):

```tsx
    <main className={styles.page}>
      <h1 className={styles.heading}>Home</h1>

      <ErgoStandNotice variant="hero" />

      <section
        className={reachable ? styles.start : `${styles.start} ${styles.startDimmed}`}
        aria-disabled={!reachable}
      >
```

Add `disabled={!reachable}` to all four mode buttons and the hero button (e.g. the `picker-just-row` button gets `disabled={!reachable}` next to its `onClick`).

Pass the flag to favorites:

```tsx
      <FavoritesList rowerID={active.data?.id} disabled={!reachable} />
```

Append to `HomePage.module.css`:

```css
.startDimmed {
  opacity: 0.45;
  pointer-events: none;
}
```

- [ ] **Step 2: FavoritesList** — accept and apply `disabled`:

```tsx
export type Props = { rowerID?: string; disabled?: boolean }

export function FavoritesList({ rowerID, disabled = false }: Props) {
```

Section element:

```tsx
    <section
      data-testid="favorites-list"
      className={disabled ? `${styles.section} ${styles.sectionDimmed}` : styles.section}
    >
```

Both buttons (`itemBody` start button and the delete button) get `disabled={disabled}`.

Append to `FavoritesList.module.css`:

```css
.sectionDimmed {
  opacity: 0.45;
  pointer-events: none;
}
```

- [ ] **Step 3: Add the test cases**

`HomePage.test.tsx` (mount via the file's existing helper):

```tsx
import { setErgoStatus, _resetErgoStatusForTest } from '../offline/ergoStatus'

beforeEach(() => _resetErgoStatusForTest())

it('unreachable: hero card shown, start buttons disabled', async () => {
  setErgoStatus({ reachable: false, packedAt: '2026-06-12T18:42:00' })
  // …render via the file's helper…
  expect(await screen.findByTestId('ergo-offline-hero')).toBeInTheDocument()
  expect(screen.getByTestId('picker-just-row')).toBeDisabled()
  expect(screen.getByTestId('picker-distance')).toBeDisabled()
})

it('reachable: no hero card', async () => {
  // …render…
  expect(screen.queryByTestId('ergo-offline-hero')).toBeNull()
})
```

`FavoritesList.test.tsx`:

```tsx
it('disabled: start buttons are disabled and the section is dimmed', async () => {
  // …render <FavoritesList rowerID="R1" disabled /> with the file's
  // favorites fixture in the query cache…
  const section = await screen.findByTestId('favorites-list')
  expect(section.className).toMatch(/sectionDimmed/)
  for (const btn of screen.getAllByRole('button')) expect(btn).toBeDisabled()
})
```

- [ ] **Step 4: Run the tests**

Run: `cd /Users/dg/dev/ruderergo-stats/web && npx vitest run src/pages/HomePage.test.tsx src/pages/home/FavoritesList.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd /Users/dg/dev/ruderergo-stats && git add web/src/pages/HomePage.tsx web/src/pages/HomePage.module.css web/src/pages/home
git commit -m "feat(offline): Home offline state — hero card with Verlauf CTA, dimmed start affordances"
```

---

### Task 12: ProfilePage — Unterwegs-Daten status line

**Files:**
- Modify: `web/src/pages/ProfilePage.tsx`
- Test: `web/src/pages/ProfilePage.test.tsx` (add case; create only if absent — check first)

- [ ] **Step 1: Add the status line**

Imports:

```ts
import { useErgoStatus } from '../offline/ergoStatus'
import { formatStand } from '../util/dates'
```

Inside the component: `const ergo = useErgoStatus()`. In the footer, directly above the existing `build-version` line:

```tsx
        {ergo.packedAt && (
          <p className={styles.footerLine} data-testid="offline-stand">
            Unterwegs-Daten: Stand {formatStand(ergo.packedAt)} · {ergo.packedSessions} Sessions
          </p>
        )}
```

- [ ] **Step 2: Add the test case** (in the Profile test file; if `ProfilePage.test.tsx` does not exist, add this as a small new file using the same QueryClient wrapper pattern as `src/app/RowerStrip.test.tsx`):

```tsx
import { setErgoStatus, _resetErgoStatusForTest } from '../offline/ergoStatus'

beforeEach(() => _resetErgoStatusForTest())

it('shows the Unterwegs-Daten line once a pack exists', async () => {
  setErgoStatus({ packedAt: '2026-06-12T18:42:00', packedSessions: 10 })
  // …render ProfilePage via wrapper…
  expect(await screen.findByTestId('offline-stand')).toHaveTextContent(
    'Unterwegs-Daten: Stand 12. Juni, 18:42 · 10 Sessions',
  )
})

it('hides the line before any pack', async () => {
  // …render…
  expect(screen.queryByTestId('offline-stand')).toBeNull()
})
```

- [ ] **Step 3: Run + typecheck**

Run: `cd /Users/dg/dev/ruderergo-stats/web && npx vitest run src/pages && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
cd /Users/dg/dev/ruderergo-stats && git add web/src/pages/ProfilePage.tsx web/src/pages/ProfilePage.test.tsx
git commit -m "feat(offline): Unterwegs-Daten status line on Profile"
```

---

### Task 13: E2E offline walkthrough (the drift net)

The CI gate the spec mandates: a query missing from the allowlist or pack fails here, not at the club. Also extracts the trends seeding helper so two spec files share it.

**Files:**
- Create: `web/tests/e2e/helpers/seedTrends.ts` — move `seedTrendsSessions` out of `verlauf.spec.ts` **verbatim** (the whole exported function including its imports `spawnSync`, `randomUUID`)
- Modify: `web/tests/e2e/verlauf.spec.ts` — delete the moved function, add `import { seedTrendsSessions } from './helpers/seedTrends'`
- Create: `web/tests/e2e/offline.spec.ts`

- [ ] **Step 1: Extract the seeding helper**

Create `tests/e2e/helpers/seedTrends.ts` containing the unchanged `seedTrendsSessions` (and any private helpers it uses) from `verlauf.spec.ts`, with the imports it needs (`spawnSync` from `node:child_process`, `randomUUID` from `node:crypto`). Update `verlauf.spec.ts` to import it. Importing a spec file from another spec would re-register its tests — that is why this moves to `helpers/`.

Run: `cd /Users/dg/dev/ruderergo-stats/web && npx playwright test tests/e2e/verlauf.spec.ts`
Expected: PASS (pure move)

- [ ] **Step 2: Write `offline.spec.ts`**

```ts
import { test, expect } from './fixtures'
import { seedTrendsSessions } from './helpers/seedTrends'

test.describe.configure({ mode: 'serial' })
test.setTimeout(120_000)
// The persisted cache lives in IndexedDB, not the SW — block the SW so
// context.route() reliably intercepts all /api/* traffic (Playwright
// does not intercept SW-mediated fetches by default).
test.use({ serviceWorkers: 'block' })

test('packed at home, history demo works at the club', async ({
  startBackend,
  seedActiveRower,
  page,
  context,
}) => {
  const handle = await startBackend({ idleTimeout: '2s' })
  const rower = await seedActiveRower()
  await seedTrendsSessions(handle.dbPath, rower.id, 500, 3, 15)

  // ── At home: open the app, let the boot pack run (idle-scheduled).
  await page.goto('/')
  await page.goto('/profil')
  await expect(page.getByTestId('offline-stand')).toBeVisible({ timeout: 30_000 })

  // ── At the club: no route to the backend.
  await context.route('**/api/**', (route) => route.abort('connectionrefused'))

  // Home: hero card with CTA; start affordances dimmed.
  await page.goto('/')
  await expect(page.getByTestId('ergo-offline-hero')).toBeVisible({ timeout: 30_000 })
  await expect(page.getByTestId('picker-just-row')).toBeDisabled()

  // CTA → Verlauf renders from the bag, with the banner.
  await page.getByTestId('ergo-offline-cta').click()
  await expect(page.getByTestId('ergo-stand-banner')).toBeVisible()
  await page.waitForSelector('[data-testid^="verlauf-row-"]', { timeout: 15_000 })
  await expect(page.getByTestId('ergo-stand-banner')).toContainText('Stand:')

  // A cached row opens; detail renders from the bag with the banner.
  await page.locator('a[data-testid^="verlauf-row-"]').first().click()
  await expect(page.getByTestId('detail-total-distance')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByTestId('ergo-stand-banner')).toBeVisible()

  // Rekorde renders from the bag (seed includes a distance PB).
  await page.goto('/historie/rekorde')
  await expect(page.getByTestId('ergo-stand-banner')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByTestId('rekorde-empty')).toHaveCount(0)
})

test('reachable session leaves no offline artefacts in the UI', async ({
  startBackend,
  seedActiveRower,
  page,
}) => {
  await startBackend({ idleTimeout: '2s' })
  await seedActiveRower()
  await page.goto('/')
  await expect(page.getByTestId('ergo-offline-hero')).toHaveCount(0)
  await page.goto('/historie')
  await expect(page.getByTestId('ergo-stand-banner')).toHaveCount(0)
})
```

Timing note: the offline `page.goto('/')` triggers a fresh boot probe that must fail before the hero appears — with `retry: false` and the 6 s `getFetch` timeout that is ≤ ~7 s; the 30 s expect timeout has ample slack.

- [ ] **Step 3: Run the suite**

Run: `cd /Users/dg/dev/ruderergo-stats/web && npx playwright test tests/e2e/offline.spec.ts`
Expected: PASS. If the hero never appears, check (in order): the pack ran at home (`offline-stand` was visible), `serviceWorkers: 'block'` is present, and the probe failure actually flips `setErgoStatus({reachable:false})` (boot probe must reject — `connectionrefused` aborts are wrapped as NetworkError by `apiFetch`).

- [ ] **Step 4: Full verification sweep**

```bash
cd /Users/dg/dev/ruderergo-stats/web && npx tsc --noEmit && npx vitest run src && npx playwright test tests/e2e/offline.spec.ts tests/e2e/verlauf.spec.ts
```

Expected: all PASS

- [ ] **Step 5: Commit**

```bash
cd /Users/dg/dev/ruderergo-stats && git add web/tests/e2e
git commit -m "test(e2e): offline walkthrough — packed at home, demo at the club"
```
