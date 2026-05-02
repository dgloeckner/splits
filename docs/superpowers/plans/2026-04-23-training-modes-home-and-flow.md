# Training Modes — Home Screen + Selection Flow (Frontend)

> **Status:** Shipped — merged to main.


> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** New `/` Home screen (tiles, last-training card, favorites) and `/workout/new` guided selection flow (3 steps + confirm). Flow creates a workout via backend, attaches it to the next session, then navigates to Live View. Live View is reachable at `/live` and is session-only.

**Architecture:** React Router v6 routing shift. New page components under `web/src/pages/`. Flow state via a React context (`WorkoutFlowProvider`) so step components stay decoupled. API client extended with `workouts.ts` + `favorites.ts`. No backend changes in this plan.

**Tech stack:** React 18, TypeScript, React Router v6, CSS Modules, Vitest + React Testing Library, Vite.

Follow-up plan:
- `2026-04-23-training-modes-live-view.md` — progress strip, range indicator, segment SSE events.

---

## File structure

**New:**
- `web/src/api/workouts.ts` — `createWorkout`, `attachWorkout`, `getLastWorkout`
- `web/src/api/workouts.test.ts`
- `web/src/api/favorites.ts` — `listFavorites`, `createFavorite`, `deleteFavorite`
- `web/src/api/favorites.test.ts`
- `web/src/pages/HomePage.tsx` + `HomePage.module.css` + `HomePage.test.tsx`
- `web/src/pages/home/LastTrainingCard.tsx` + `.module.css` + `.test.tsx`
- `web/src/pages/home/FavoritesList.tsx` + `.module.css` + `.test.tsx`
- `web/src/pages/workout/WorkoutFlowProvider.tsx` — context + reducer
- `web/src/pages/workout/WorkoutFlowPage.tsx` — router-level shell (renders active step)
- `web/src/pages/workout/Step1Mode.tsx`
- `web/src/pages/workout/Step2Dimension.tsx`
- `web/src/pages/workout/Step3Intensity.tsx`
- `web/src/pages/workout/ConfirmScreen.tsx`
- `web/src/pages/workout/intensityRanges.ts` — static range table
- `web/src/pages/workout/presets.ts` — hardcoded preset lists per mode
- Corresponding `.module.css` + `.test.tsx` files

**Modify:**
- `web/src/app/AppRouter.tsx` — swap `<Route index element={<LivePage />}>` → `<Route index element={<HomePage />}>`, add `/live`, add `/workout/new`
- `web/src/pages/LivePage.tsx` — on session end, navigate back to `/`
- `web/src/api/client.ts` — reuse helpers if needed; otherwise leave
- `web/src/app/BottomNav.tsx` — ensure "Home" nav item points at `/`

---

## Conventions

- TDD: test first, implement to green.
- Commit after each task.
- Prefer CSS Modules over global styles (match existing pattern).
- Keep component files under ~150 lines; split children into `web/src/pages/<page>/…` subfolders.

---

## Task 1 — API client for workouts

**Files:** `web/src/api/workouts.ts`, `web/src/api/workouts.test.ts`

- [ ] **Step 1: Test first**

`web/src/api/workouts.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createWorkout, attachWorkout, getLastWorkout, type WorkoutMode } from './workouts'

const originalFetch = global.fetch

function mockFetch(impl: (url: RequestInfo | URL, init?: RequestInit) => Promise<Response>) {
  ;(global as unknown as { fetch: typeof fetch }).fetch = vi.fn(impl) as unknown as typeof fetch
}

beforeEach(() => {
  mockFetch(async () => new Response('{}', { status: 200 }))
})
afterEach(() => {
  ;(global as unknown as { fetch: typeof fetch }).fetch = originalFetch
})

describe('workouts api', () => {
  it('createWorkout posts the correct body and returns id', async () => {
    mockFetch(async (url, init) => {
      expect(String(url)).toBe('/api/v1/workouts')
      expect(init?.method).toBe('POST')
      expect(JSON.parse(init?.body as string)).toEqual({
        mode: 'distance',
        params: { meters: 5000 },
        intensity: 'moderat',
        warmup_sec: 300,
        cooldown_sec: 300,
      })
      return new Response(JSON.stringify({ id: 'W1', mode: 'distance', params: { meters: 5000 }, intensity: 'moderat', warmup_sec: 300, cooldown_sec: 300, created_at: '2026-04-23T00:00:00Z' }), { status: 201 })
    })
    const out = await createWorkout({ mode: 'distance', params: { meters: 5000 }, intensity: 'moderat', warmup_sec: 300, cooldown_sec: 300 })
    expect(out.id).toBe('W1')
  })

  it('attachWorkout posts to the attach endpoint', async () => {
    mockFetch(async (url, init) => {
      expect(String(url)).toBe('/api/v1/workouts/W1/attach')
      expect(init?.method).toBe('POST')
      return new Response(null, { status: 204 })
    })
    await attachWorkout('W1')
  })

  it('getLastWorkout returns null on 404', async () => {
    mockFetch(async () => new Response('not found', { status: 404 }))
    const out = await getLastWorkout('R1')
    expect(out).toBeNull()
  })

  it('getLastWorkout returns the workout on 200', async () => {
    mockFetch(async (url) => {
      expect(String(url)).toBe('/api/v1/workouts/last?rower_id=R1')
      return new Response(JSON.stringify({ id: 'W2', mode: 'time', params: { seconds: 600 }, warmup_sec: 0, cooldown_sec: 0, created_at: '2026-04-23T00:00:00Z' }), { status: 200 })
    })
    const out = await getLastWorkout('R1')
    expect(out?.id).toBe('W2')
  })

  it('type WorkoutMode includes all four modes', () => {
    const modes: WorkoutMode[] = ['just_row', 'distance', 'time', 'intervals']
    expect(modes).toHaveLength(4)
  })
})
```

- [ ] **Step 2: Run test — should FAIL**

```
cd web && npm run test -- src/api/workouts.test.ts
```

- [ ] **Step 3: Implement**

`web/src/api/workouts.ts`:

```ts
export type WorkoutMode = 'just_row' | 'distance' | 'time' | 'intervals'
export type Intensity = 'locker' | 'moderat' | 'hart' | 'allout'

export type JustRowParams = Record<string, never>
export type DistanceParams = { meters: number }
export type TimeParams = { seconds: number }
export type IntervalLength = { unit: 'm' | 'min'; value: number }
export type IntervalsParams = { reps: number; length: IntervalLength; rest_sec: number }
export type WorkoutParams = JustRowParams | DistanceParams | TimeParams | IntervalsParams

export type Workout = {
  id: string
  mode: WorkoutMode
  params: WorkoutParams
  intensity?: Intensity
  warmup_sec: number
  cooldown_sec: number
  created_at: string
}

export type CreateWorkoutInput = {
  mode: WorkoutMode
  params: WorkoutParams
  intensity?: Intensity
  warmup_sec?: number
  cooldown_sec?: number
}

export async function createWorkout(input: CreateWorkoutInput): Promise<Workout> {
  const res = await fetch('/api/v1/workouts', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      mode: input.mode,
      params: input.params,
      intensity: input.intensity,
      warmup_sec: input.warmup_sec ?? 0,
      cooldown_sec: input.cooldown_sec ?? 0,
    }),
  })
  if (!res.ok) throw new Error(`createWorkout: ${res.status}`)
  return res.json()
}

export async function attachWorkout(id: string): Promise<void> {
  const res = await fetch(`/api/v1/workouts/${encodeURIComponent(id)}/attach`, { method: 'POST' })
  if (!res.ok) throw new Error(`attachWorkout: ${res.status}`)
}

export async function getLastWorkout(rowerID: string): Promise<Workout | null> {
  const res = await fetch(`/api/v1/workouts/last?rower_id=${encodeURIComponent(rowerID)}`)
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`getLastWorkout: ${res.status}`)
  return res.json()
}
```

- [ ] **Step 4: Run test — PASS**

- [ ] **Step 5: Commit**

```
git add web/src/api/workouts.ts web/src/api/workouts.test.ts
git commit -m "feat(web): workouts API client"
```

---

## Task 2 — API client for favorites

**Files:** `web/src/api/favorites.ts`, `web/src/api/favorites.test.ts`

- [ ] **Step 1: Test**

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { listFavorites, createFavorite, deleteFavorite } from './favorites'

const originalFetch = global.fetch
function mockFetch(impl: (url: RequestInfo | URL, init?: RequestInit) => Promise<Response>) {
  ;(global as unknown as { fetch: typeof fetch }).fetch = vi.fn(impl) as unknown as typeof fetch
}
beforeEach(() => mockFetch(async () => new Response('{}', { status: 200 })))
afterEach(() => { ;(global as unknown as { fetch: typeof fetch }).fetch = originalFetch })

describe('favorites api', () => {
  it('listFavorites unwraps envelope', async () => {
    mockFetch(async (url) => {
      expect(String(url)).toBe('/api/v1/favorites?rower_id=R1')
      return new Response(JSON.stringify({ favorites: [{ id: 'F1', rower_id: 'R1', name: 'A', mode: 'time', params: { seconds: 600 }, warmup_sec: 0, cooldown_sec: 0, created_at: '2026-04-23T00:00:00Z' }] }), { status: 200 })
    })
    const out = await listFavorites('R1')
    expect(out).toHaveLength(1)
    expect(out[0].name).toBe('A')
  })

  it('createFavorite posts full body', async () => {
    mockFetch(async (url, init) => {
      expect(String(url)).toBe('/api/v1/favorites')
      expect(JSON.parse(init?.body as string)).toMatchObject({ rower_id: 'R1', name: 'My 5k', mode: 'distance' })
      return new Response(JSON.stringify({ id: 'F2', rower_id: 'R1', name: 'My 5k', mode: 'distance', params: { meters: 5000 }, warmup_sec: 300, cooldown_sec: 0, created_at: '2026-04-23T00:00:00Z' }), { status: 201 })
    })
    const out = await createFavorite({ rower_id: 'R1', name: 'My 5k', mode: 'distance', params: { meters: 5000 }, warmup_sec: 300 })
    expect(out.id).toBe('F2')
  })

  it('deleteFavorite sends DELETE', async () => {
    mockFetch(async (url, init) => {
      expect(String(url)).toBe('/api/v1/favorites/F1')
      expect(init?.method).toBe('DELETE')
      return new Response(null, { status: 204 })
    })
    await deleteFavorite('F1')
  })
})
```

- [ ] **Step 2: Run — FAIL**
- [ ] **Step 3: Implement `web/src/api/favorites.ts`**

```ts
import type { Intensity, WorkoutMode, WorkoutParams } from './workouts'

export type Favorite = {
  id: string
  rower_id: string
  name: string
  mode: WorkoutMode
  params: WorkoutParams
  intensity?: Intensity
  warmup_sec: number
  cooldown_sec: number
  created_at: string
}

export type CreateFavoriteInput = {
  rower_id: string
  name: string
  mode: WorkoutMode
  params: WorkoutParams
  intensity?: Intensity
  warmup_sec?: number
  cooldown_sec?: number
}

export async function listFavorites(rowerID: string): Promise<Favorite[]> {
  const res = await fetch(`/api/v1/favorites?rower_id=${encodeURIComponent(rowerID)}`)
  if (!res.ok) throw new Error(`listFavorites: ${res.status}`)
  const body = (await res.json()) as { favorites?: Favorite[] }
  return body.favorites ?? []
}

export async function createFavorite(input: CreateFavoriteInput): Promise<Favorite> {
  const res = await fetch('/api/v1/favorites', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      ...input,
      warmup_sec: input.warmup_sec ?? 0,
      cooldown_sec: input.cooldown_sec ?? 0,
    }),
  })
  if (!res.ok) throw new Error(`createFavorite: ${res.status}`)
  return res.json()
}

export async function deleteFavorite(id: string): Promise<void> {
  const res = await fetch(`/api/v1/favorites/${encodeURIComponent(id)}`, { method: 'DELETE' })
  if (!res.ok) throw new Error(`deleteFavorite: ${res.status}`)
}
```

- [ ] **Step 4: Run — PASS**
- [ ] **Step 5: Commit**: `git add web/src/api/favorites.* && git commit -m "feat(web): favorites API client"`

---

## Task 3 — Routing shift + stub HomePage

**Files:** `web/src/app/AppRouter.tsx`, `web/src/pages/HomePage.tsx`, `web/src/pages/HomePage.module.css`, `web/src/pages/HomePage.test.tsx`

- [ ] **Step 1: Test for HomePage (stub)**

`HomePage.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { HomePage } from './HomePage'

describe('HomePage', () => {
  it('renders the page heading', () => {
    render(<MemoryRouter><HomePage /></MemoryRouter>)
    expect(screen.getByRole('heading', { name: /home/i })).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Stub implementation**

```tsx
import styles from './HomePage.module.css'

export function HomePage() {
  return (
    <main className={styles.page}>
      <h1 className={styles.heading}>Home</h1>
    </main>
  )
}
```

```css
.page { padding: 16px; }
.heading { font-size: 24px; margin: 0; }
```

- [ ] **Step 3: Rewire `AppRouter.tsx`**

```tsx
import { HomePage } from '../pages/HomePage'
// ... existing imports

<Route index element={<HomePage />} />
<Route path="/live" element={<LivePage />} />
<Route path="/historie" element={<HistoryPage />} />
// ... rest unchanged
```

Keep the workout route added in a later task — for now skip.

- [ ] **Step 4: Verify tests**

```
cd web && npm run test
```

Expected: new HomePage test passes; existing tests continue passing. If BottomNav links to `/` for Live, update to `/live` as needed (check `BottomNav.tsx`).

- [ ] **Step 5: Commit**

```
git add web/src/app/AppRouter.tsx web/src/pages/HomePage.* web/src/app/BottomNav.tsx
git commit -m "feat(web): swap root route to HomePage; LivePage now at /live"
```

---

## Task 4 — HomePage primary tiles

**Files modified:** `HomePage.tsx`, `HomePage.module.css`, `HomePage.test.tsx`

- [ ] **Step 1: Extend test**

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { HomePage } from './HomePage'

function renderHome() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/live" element={<div>LIVE</div>} />
        <Route path="/workout/new" element={<div>NEW WORKOUT</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('HomePage tiles', () => {
  it('Nur rudern tile navigates to /live', async () => {
    renderHome()
    await userEvent.click(screen.getByRole('button', { name: /nur rudern/i }))
    expect(screen.getByText('LIVE')).toBeInTheDocument()
  })

  it('Neues Workout tile navigates to /workout/new', async () => {
    renderHome()
    await userEvent.click(screen.getByRole('button', { name: /neues workout/i }))
    expect(screen.getByText('NEW WORKOUT')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Implement tiles**

```tsx
import { useNavigate } from 'react-router-dom'
import styles from './HomePage.module.css'

export function HomePage() {
  const nav = useNavigate()
  return (
    <main className={styles.page}>
      <h1 className={styles.heading}>Home</h1>
      <section className={styles.tiles}>
        <button type="button" className={styles.tilePrimary} onClick={() => nav('/live')}>
          <span className={styles.tileLabel}>Nur rudern</span>
          <span className={styles.tileHint}>Schnellstart</span>
        </button>
        <button type="button" className={styles.tileSecondary} onClick={() => nav('/workout/new')}>
          <span className={styles.tileLabel}>Neues Workout</span>
          <span className={styles.tileHint}>Distanz · Zeit · Intervalle</span>
        </button>
      </section>
    </main>
  )
}
```

Extend CSS module with `.tiles`, `.tilePrimary`, `.tileSecondary`, `.tileLabel`, `.tileHint` — match the design tokens used elsewhere (see existing pages for color / spacing patterns).

- [ ] **Step 3: Run tests — PASS**
- [ ] **Step 4: Commit**: `feat(web): Home tiles for Nur rudern + Neues Workout`

---

## Task 5 — Last-Training card

**Files:** `web/src/pages/home/LastTrainingCard.tsx`, `.module.css`, `.test.tsx`; integrate into `HomePage.tsx`.

Component responsibilities:
- Fetches the most recent non-deleted session for the active rower (use existing `listSessions` — filter client-side or use an endpoint if one exists).
- Displays: date, mode label, distance, time.
- Sparkline placeholder (static bar) — full sparkline deferred. Render a CSS-drawn bar that's green for completed, gray otherwise.
- "Wiederholen" button: calls `getLastWorkout(rowerID)` → if present, `createWorkout(params)` + `attachWorkout` → navigate `/live`.
- Empty state: hidden entirely when no session exists.

- [ ] **Step 1: Test**

```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { LastTrainingCard } from './LastTrainingCard'

const originalFetch = global.fetch
function mockFetch(routes: Record<string, Response | (() => Response | Promise<Response>)>) {
  global.fetch = vi.fn(async (url) => {
    const key = String(url).split('?')[0]
    const v = routes[String(url)] ?? routes[key]
    if (!v) return new Response('not found', { status: 404 })
    return typeof v === 'function' ? v() : v
  }) as typeof fetch
}

beforeEach(() => {})
afterEach(() => { global.fetch = originalFetch })

describe('LastTrainingCard', () => {
  it('hides when no session exists', async () => {
    mockFetch({ '/api/v1/sessions?limit=1&offset=0&rower_id=R1': new Response(JSON.stringify({ sessions: [] }), { status: 200 }) })
    const { container } = render(<MemoryRouter><LastTrainingCard rowerID="R1" /></MemoryRouter>)
    await waitFor(() => { expect(container.querySelector('[data-testid="last-training-card"]')).toBeNull() })
  })

  it('renders session summary + repeat button', async () => {
    mockFetch({
      '/api/v1/sessions?limit=1&offset=0&rower_id=R1': new Response(JSON.stringify({
        sessions: [{ id: 'S1', rower_id: 'R1', started_at: '2026-04-22T08:00:00Z', ended_at: '2026-04-22T08:30:00Z', initial_level: 3, total_distance_m: 5000, total_time_sec: 1800 }],
      }), { status: 200 }),
    })
    render(<MemoryRouter><LastTrainingCard rowerID="R1" /></MemoryRouter>)
    expect(await screen.findByTestId('last-training-card')).toBeInTheDocument()
    expect(screen.getByText(/5,00 km|5\.00 km|5000/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /wiederholen/i })).toBeInTheDocument()
  })

  it('Wiederholen creates workout + attaches + navigates to /live', async () => {
    let createdBody: any = null
    let attached = false
    mockFetch({
      '/api/v1/sessions?limit=1&offset=0&rower_id=R1': new Response(JSON.stringify({
        sessions: [{ id: 'S1', rower_id: 'R1', started_at: '2026-04-22T08:00:00Z', initial_level: 3, total_distance_m: 2000, total_time_sec: 900 }],
      }), { status: 200 }),
      '/api/v1/workouts/last?rower_id=R1': new Response(JSON.stringify({ id: 'W1', mode: 'distance', params: { meters: 2000 }, intensity: 'moderat', warmup_sec: 0, cooldown_sec: 0, created_at: '2026-04-22T08:00:00Z' }), { status: 200 }),
      '/api/v1/workouts': () => new Response(JSON.stringify({ id: 'W2', mode: 'distance', params: { meters: 2000 }, warmup_sec: 0, cooldown_sec: 0, created_at: '2026-04-23T08:00:00Z' }), { status: 201 }),
      '/api/v1/workouts/W2/attach': () => { attached = true; return new Response(null, { status: 204 }) },
    })
    const origFetch = global.fetch
    global.fetch = vi.fn(async (url, init) => {
      const key = String(url)
      if (key === '/api/v1/workouts' && init?.method === 'POST') {
        createdBody = JSON.parse(init.body as string)
      }
      return (origFetch as any)(url, init)
    }) as typeof fetch

    render(
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route path="/" element={<LastTrainingCard rowerID="R1" />} />
          <Route path="/live" element={<div>LIVE</div>} />
        </Routes>
      </MemoryRouter>,
    )
    await userEvent.click(await screen.findByRole('button', { name: /wiederholen/i }))
    await waitFor(() => expect(screen.getByText('LIVE')).toBeInTheDocument())
    expect(createdBody?.mode).toBe('distance')
    expect(attached).toBe(true)
  })
})
```

(Note: the plan's mock pattern is intentionally slightly ugly — simplify with `msw` if the codebase already uses it. Check `web/src/setupTests.ts` first.)

- [ ] **Step 2: Implementation sketch**

```tsx
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { listSessions, type SessionRow } from '../../api/client'
import { createWorkout, getLastWorkout } from '../../api/workouts'
import styles from './LastTrainingCard.module.css'

export type Props = { rowerID: string }

export function LastTrainingCard({ rowerID }: Props) {
  const [session, setSession] = useState<SessionRow | null>(null)
  const [loading, setLoading] = useState(true)
  const nav = useNavigate()

  useEffect(() => {
    listSessions({ limit: 1, offset: 0, rowerID }).then((list) => setSession(list[0] ?? null)).finally(() => setLoading(false))
  }, [rowerID])

  if (loading || !session) return null

  async function repeat() {
    const last = await getLastWorkout(rowerID)
    if (!last) { nav('/live'); return }
    const created = await createWorkout({
      mode: last.mode,
      params: last.params,
      intensity: last.intensity,
      warmup_sec: last.warmup_sec,
      cooldown_sec: last.cooldown_sec,
    })
    await fetch(`/api/v1/workouts/${created.id}/attach`, { method: 'POST' })
    nav('/live')
  }

  const km = (session.total_distance_m ?? 0) / 1000
  const mins = Math.round((session.total_time_sec ?? 0) / 60)
  const date = new Date(session.started_at).toLocaleDateString('de-DE')

  return (
    <article data-testid="last-training-card" className={styles.card}>
      <header className={styles.header}>
        <span className={styles.date}>{date}</span>
      </header>
      <div className={styles.metrics}>
        <span>{km.toFixed(2).replace('.', ',')} km</span>
        <span>{mins} min</span>
      </div>
      <div className={styles.sparkline} aria-hidden />
      <button type="button" className={styles.repeat} onClick={repeat}>Wiederholen</button>
    </article>
  )
}
```

**Note on `listSessions` filter:** Inspect the existing `listSessions` signature in `web/src/api/client.ts`. If it already takes a `rower_id` filter, reuse. If not, extend it — add the test first under `client.test.ts`.

- [ ] **Step 3: Integrate into HomePage**

In `HomePage.tsx`, after the tiles:

```tsx
import { useActiveRower } from '../hooks/useActiveRower' // check the real hook path first
import { LastTrainingCard } from './home/LastTrainingCard'

// inside the component:
const { id: rowerID } = useActiveRower()
...
{rowerID && <LastTrainingCard rowerID={rowerID} />}
```

If no `useActiveRower` hook exists, find how the rower ID is obtained elsewhere (search for `active-rower`). Adjust accordingly.

- [ ] **Step 4: Run tests — PASS**
- [ ] **Step 5: Commit**: `feat(web): LastTrainingCard on Home with Wiederholen`

---

## Task 6 — Favorites list on Home

**Files:** `web/src/pages/home/FavoritesList.tsx` + `.module.css` + `.test.tsx`; integrate into HomePage.

Behavior:
- Fetches `listFavorites(rowerID)`.
- Hidden when empty.
- Each item renders name + compact summary (e.g., "5 km · moderat").
- Tap → `createWorkout(...)` + `attachWorkout(...)` + navigate `/live` (no confirm).
- Delete button on each (trash icon, confirm via browser `confirm()` for v1 simplicity).

Write one comprehensive test:
- Empty list hides section
- Populated list renders chips
- Tap starts workout (mock POST → expect attach → expect navigation)
- Delete removes chip

- [ ] **Step 1–5**: TDD as above. Commit with message `feat(web): favorites list on Home`.

---

## Task 7 — Workout flow shell + context

**Files:** `web/src/pages/workout/WorkoutFlowProvider.tsx`, `WorkoutFlowPage.tsx`, `.test.tsx`

State model:

```ts
type FlowState = {
  step: 1 | 2 | 3 | 'confirm'
  mode?: 'distance' | 'time' | 'intervals'
  distanceMeters?: number
  timeSeconds?: number
  intervals?: { reps: number; length: { unit: 'm' | 'min'; value: number }; rest_sec: number }
  intensity?: 'locker' | 'moderat' | 'hart' | 'allout'
  warmupSec: number   // default 300
  cooldownSec: number // default 300
  warmupEnabled: boolean  // default true
  cooldownEnabled: boolean // default true
}
```

Reducer actions: `SELECT_MODE`, `SET_DISTANCE`, `SET_TIME`, `SET_INTERVALS`, `SET_INTENSITY`, `TOGGLE_WARMUP`, `SET_WARMUP_SEC`, `TOGGLE_COOLDOWN`, `SET_COOLDOWN_SEC`, `GO_BACK`, `GO_TO_CONFIRM`, `RESET`.

Route structure in `AppRouter.tsx`:

```tsx
<Route path="/workout/new" element={<WorkoutFlowPage />} />
```

`WorkoutFlowPage.tsx` wraps children in `WorkoutFlowProvider`, reads state, and renders one of `<Step1Mode>`, `<Step2Dimension>`, `<Step3Intensity>`, `<ConfirmScreen>`.

- [ ] Test: provider dispatches actions, state transitions correctly.
- [ ] Test: wrong step renders corresponding component.
- [ ] Commit: `feat(web): workout flow provider + shell`

---

## Task 8 — Step 1: Mode picker

**Files:** `web/src/pages/workout/Step1Mode.tsx` + `.module.css` + `.test.tsx`

Three cards: Distanz / Zeit / Intervalle. Tap dispatches `SELECT_MODE` + advances to step 2. Stepper indicator "1 / 4". Back button → navigate to `/`.

- [ ] Test: each card dispatches the right mode. Back goes home.
- [ ] Commit: `feat(web): workout flow step 1 mode picker`

---

## Task 9 — Step 2: Dimension (all three modes)

**Files:** `web/src/pages/workout/Step2Dimension.tsx` + `.module.css` + `.test.tsx`, `web/src/pages/workout/presets.ts`

Single component, branches on `state.mode`:

```ts
// presets.ts
export const distancePresets: { label: string; meters: number }[] = [
  { label: '500 m', meters: 500 },
  { label: '1 km', meters: 1000 },
  { label: '2 km', meters: 2000 },
  { label: '5 km', meters: 5000 },
  { label: '6 km', meters: 6000 },
  { label: '10 km', meters: 10000 },
  { label: 'HM', meters: 21097 },
  { label: 'Marathon', meters: 42195 },
]

export const timePresets: { label: string; seconds: number }[] = [
  { label: '10 min', seconds: 600 },
  { label: '20 min', seconds: 1200 },
  { label: '30 min', seconds: 1800 },
  { label: '45 min', seconds: 2700 },
  { label: '60 min', seconds: 3600 },
]

export type IntervalPreset = { label: string; reps: number; length: { unit: 'm'|'min'; value: number }; rest_sec: number }
export const intervalPresets: IntervalPreset[] = [
  { label: '8×500 m', reps: 8, length: { unit: 'm', value: 500 }, rest_sec: 120 },
  { label: '5×1000 m', reps: 5, length: { unit: 'm', value: 1000 }, rest_sec: 180 },
  { label: '4×2000 m', reps: 4, length: { unit: 'm', value: 2000 }, rest_sec: 300 },
  { label: '6×1 min', reps: 6, length: { unit: 'min', value: 1 }, rest_sec: 60 },
  { label: '4×4 min', reps: 4, length: { unit: 'min', value: 4 }, rest_sec: 120 },
]
```

UI per mode:
- Distance / Time: chip row of presets + "Eigene" → reveals stepper (± buttons).
- Intervals: chip row of presets + "Eigene" → reveals three steppers matching Stitch `Workout-Auswahl: Intervalle Konfiguration (3/4)`:
  - Anzahl Wiederholungen (stepper, min 1)
  - Intervall-Länge (toggle `Meter` | `Minuten` + stepper, min 1)
  - Pause (stepper in min, min 0)
- Selecting a preset OR confirming "Eigene" → dispatches SET_* + GO_TO_STEP3.
- Back button → `GO_BACK`.

- [ ] Tests: preset chip sets distance/time/intervals; custom stepper increments/decrements; intervals "Eigene" renders 3 steppers + Meter/Minuten toggle; Back returns to step 1.
- [ ] Commit: `feat(web): workout flow step 2 dimension picker (distance/time/intervals)`

---

## Task 10 — Step 3: Intensity + intensityRanges

**Files:** `web/src/pages/workout/Step3Intensity.tsx` + `.module.css` + `.test.tsx`, `web/src/pages/workout/intensityRanges.ts`

`intensityRanges.ts`:

```ts
export type Range = { lo: number; hi: number | null }
export type IntensityRange = {
  splitSec: Range
  spm: Range
}

// TODO (FEAT-0004 PBs): replace static values with per-user defaults.
export const intensityRanges: Record<string, IntensityRange> = {
  locker:   { splitSec: { lo: 140, hi: 160 }, spm: { lo: 18, hi: 22 } },
  moderat:  { splitSec: { lo: 125, hi: 140 }, spm: { lo: 22, hi: 26 } },
  hart:     { splitSec: { lo: 110, hi: 125 }, spm: { lo: 26, hi: 30 } },
  allout:   { splitSec: { lo: 0,   hi: 110 }, spm: { lo: 30, hi: null } },
}

export function formatSplit(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}
```

(Adjust ranges to match the spec intensity table: Locker 2:20–2:40 = 140–160 sec; Moderat 2:05–2:20 = 125–140; Hart 1:50–2:05 = 110–125; All-out <1:50 = upper 110 with lo=0.)

Four cards with label, split range, SPM range. Tap → `SET_INTENSITY` + GO_TO_CONFIRM. Back → GO_BACK.

- [ ] Tests: range rendering, selection advances state.
- [ ] Commit: `feat(web): workout flow step 3 intensity (static ranges)`

---

## Task 11 — Confirm screen + flow start

**Files:** `web/src/pages/workout/ConfirmScreen.tsx` + `.module.css` + `.test.tsx`

Responsibilities:
- Title from `{mode, params, intensity}` (e.g., "5 km · Moderat").
- Timeline strip: warmup (dashed) if enabled → work segments → cooldown (dashed) if enabled. For intervals, show alternating work/rest blocks.
- Warmup toggle (default on) + stepper 0–15 min.
- Cooldown toggle (default on) + stepper 0–15 min.
- "Als Favorit speichern" toggle → reveals text input required when on.
- Buttons: Start (primary), Anpassen (→ Step3), Zurück (→ Step2).
- Start:
  1. Build `params` payload from state.
  2. `await createWorkout({ mode, params, intensity, warmup_sec, cooldown_sec })` (toggles off → sec=0).
  3. `await attachWorkout(id)`.
  4. If save-as-favorite is on, `createFavorite({ rower_id, name, ... })` — errors are non-fatal (log + continue).
  5. `nav('/live')`.

- [ ] Tests: timeline renders correctly for distance + intervals; toggles update state; Start triggers POST chain with correct body; Favorit-toggle triggers createFavorite.
- [ ] Commit: `feat(web): workout flow confirm screen + start handler`

---

## Task 12 — End-of-session navigation

**Files:** `web/src/pages/LivePage.tsx` (or wherever the session-end effect lives)

When the current session closes (session_end event or user taps "Session beenden"), navigate back to `/`.

- [ ] **Step 1: Identify the current session-end handler** — search `LivePage.tsx` for `session_end`, `SessionEnd`, or "Session beenden".
- [ ] **Step 2: Add `const nav = useNavigate()` and `nav('/')` on session end**.
- [ ] **Step 3: Test** — render LivePage with a mocked LiveSessionContext that transitions into "ended" state; assert navigation.
- [ ] **Step 4: Commit**: `feat(web): return to Home after session ends`

---

## Task 13 — Wire routes end-to-end + smoke test

- [ ] **Step 1:** Confirm `AppRouter.tsx` has:
  ```tsx
  <Route index element={<HomePage />} />
  <Route path="/live" element={<LivePage />} />
  <Route path="/workout/new" element={<WorkoutFlowPage />} />
  ```
- [ ] **Step 2:** `cd web && npm run build` — must succeed.
- [ ] **Step 3:** `npm run test` — all pass.
- [ ] **Step 4:** Manual smoke (if dev server is fine): `npm run dev`, visit `/`, click Nur rudern → /live; back to `/`, click Neues Workout → `/workout/new`, walk Distanz → 5 km → Moderat → Confirm → Start. Watch Network: POST /workouts + POST /attach + redirect to /live. Kill server.
- [ ] **Step 5:** Commit: `feat(web): end-to-end Home + Workout flow wired`

---

## Self-review checklist (pre-handoff)

**Spec coverage:**
- Home tiles (Nur rudern, Neues Workout) ✓ (T4)
- Last-Training card ✓ (T5)
- Favorites list ✓ (T6)
- 3-step flow ✓ (T7–T10)
- Confirm screen with WU/CD + save-as-favorite ✓ (T11)
- Start handler: createWorkout → attach → /live ✓ (T11)
- Session-end → Home ✓ (T12)
- Intensity = target range (static v1) ✓ (T10)
- Pyramide excluded ✓ (Step 1 offers only distance/time/intervals — T8)

**Placeholder scan:** No `TBD`/`TODO` left in steps; only `TODO (FEAT-0004 PBs)` in `intensityRanges.ts` code (intentional, per spec).

**Type consistency:** `WorkoutMode`, `Intensity`, `IntervalLength`, `WorkoutParams`, `Workout`, `Favorite`, `FlowState` — used with the exact names across all tasks.

## Not in this plan

- Segment progression & SSE events (→ live-view plan)
- Range indicator on live tiles (→ live-view plan)
- Haptic/audio cues at segment boundaries (→ live-view plan)
- Per-user intensity defaults from FEAT-0004
