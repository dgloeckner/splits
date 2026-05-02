# PBs → History Rekorde Tab Implementation Plan

> **Status:** Shipped — merged to main.


> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move all PB / achievement / consistency UI from `ProfilePage` to a new `Rekorde` tab under `/historie`. Profile keeps only identity + Wartung (housekeeping).

**Architecture:** Pure frontend refactor. Add a third nested route `/historie/rekorde` and a sibling NavLink in the History subnav. Extract the existing `Wartung` block from `PBSummary` into a standalone `Wartung.tsx` so Profile can render it directly. The other five sub-components (`DistanceGrid`, `WindowSection`, `WorkoutSection`, `ConsistencyCards`, `MilestonesStrip`) and their helpers move verbatim into a new `RekordeTab.tsx` (co-located, not split per file — they are small and only consumed by the tab). CSS module `PBSummary.module.css` splits into `RekordeTab.module.css` (the five sections' styles) and `Wartung.module.css` (the maintenance row styles). No backend, no query-key changes.

**Tech Stack:** React, React Router v6 nested routes, React Query, Vitest, Testing Library, CSS Modules.

---

## File Structure

**Create:**
- `web/src/pages/history/RekordeTab.tsx` — composes the five PB sections
- `web/src/pages/history/RekordeTab.module.css` — styles for the five sections (subset of old `PBSummary.module.css`)
- `web/src/pages/history/RekordeTab.test.tsx` — coverage for tab rendering, empty state, distance grid placeholders
- `web/src/pages/profile/Wartung.tsx` — extracted maintenance block
- `web/src/pages/profile/Wartung.module.css` — wartung row styles + empty-state style
- `web/src/pages/profile/Wartung.test.tsx` — minimal: renders count + lifetime distance, kB/MB switch

**Modify:**
- `web/src/app/AppRouter.tsx` — add `<Route path="rekorde" element={<RekordeTab />} />` inside the existing `/historie` route
- `web/src/pages/HistoryPage.tsx` — add third NavLink "Rekorde" → `/historie/rekorde`
- `web/src/pages/HistoryPage.test.tsx` — assert third link "Rekorde" present
- `web/src/pages/ProfilePage.tsx` — replace `<PBSummary>` with `<Wartung>`

**Delete:**
- `web/src/pages/profile/PBSummary.tsx`
- `web/src/pages/profile/PBSummary.module.css`

---

## Task 1: Extract Wartung component

**Files:**
- Create: `web/src/pages/profile/Wartung.tsx`
- Create: `web/src/pages/profile/Wartung.module.css`
- Create: `web/src/pages/profile/Wartung.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `web/src/pages/profile/Wartung.test.tsx`:

```tsx
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Wartung } from './Wartung'

const originalFetch = global.fetch
afterEach(() => {
  global.fetch = originalFetch
  vi.restoreAllMocks()
})

function renderWartung() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <Wartung rowerID="R1" />
    </QueryClientProvider>,
  )
}

describe('Wartung', () => {
  it('renders session count, footprint, and lifetime distance', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('/lifetime')) {
          return new Response(
            JSON.stringify({ total_sessions: 42, total_distance_m: 12500 }),
            { status: 200 },
          )
        }
        return new Response(JSON.stringify({ sessions: [] }), { status: 200 })
      }),
    )
    renderWartung()
    await waitFor(() => expect(screen.getByText('42')).toBeInTheDocument())
    expect(screen.getByText('12.5 km')).toBeInTheDocument()
    // 42 sessions * 1.2 KB ≈ 50 kB
    expect(screen.getByText(/~50 kB/)).toBeInTheDocument()
  })

  it('switches kB → MB at the 1024 boundary', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('/lifetime')) {
          return new Response(
            JSON.stringify({ total_sessions: 1000, total_distance_m: 0 }),
            { status: 200 },
          )
        }
        return new Response(JSON.stringify({ sessions: [] }), { status: 200 })
      }),
    )
    renderWartung()
    // 1000 * 1.2 = 1200 kB → "~1.2 MB"
    await waitFor(() => expect(screen.getByText(/~1\.2 MB/)).toBeInTheDocument())
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run src/pages/profile/Wartung.test.tsx`
Expected: FAIL — "Cannot find module './Wartung'"

- [ ] **Step 3: Create CSS module**

Create `web/src/pages/profile/Wartung.module.css`:

```css
.section {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  margin-bottom: var(--space-4);
}

.sectionLabel {
  font-family: var(--font-body, 'Inter'), sans-serif;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--color-on-surface-variant);
  margin: 0;
}

.row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  background: var(--color-surface-container, #1f2020);
  border-radius: 8px;
}

.label {
  font-family: var(--font-body, 'Inter'), sans-serif;
  font-size: 13px;
  color: var(--color-on-surface-variant);
}

.value {
  font-family: var(--font-display, 'Space Grotesk'), sans-serif;
  font-size: 15px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  color: var(--color-on-surface);
}

.empty {
  color: var(--color-on-surface-variant);
  font-size: 14px;
  padding: var(--space-3);
}
```

- [ ] **Step 4: Implement Wartung component**

Create `web/src/pages/profile/Wartung.tsx`:

```tsx
import { useQueries, useQuery } from '@tanstack/react-query'
import {
  getRowerLifetime,
  listSessions,
  type RowerLifetime,
} from '../../api/client'
import styles from './Wartung.module.css'

type Props = { rowerID: string }

// Footprint heuristic: ~1.2 KB per session row (summary_json is the heaviest
// field). Strokes are ephemeral, so 0 contribution.
export function Wartung({ rowerID }: Props) {
  const lifetimeQ = useQuery<RowerLifetime>({
    queryKey: ['rower-lifetime', rowerID],
    queryFn: () => getRowerLifetime(rowerID),
  })
  // Keep cache warm; data unused here but other surfaces consume it.
  const sessionsQ = useQueries({
    queries: [{ queryKey: ['sessions', 'list'], queryFn: () => listSessions(50, 0) }],
  })

  if (lifetimeQ.isPending) {
    return <p className={styles.empty}>Wartung wird geladen …</p>
  }
  const lifetime = lifetimeQ.data
  if (!lifetime) return null

  const sessionCount = lifetime.total_sessions
  const footprintKB = Math.round(sessionCount * 1.2)
  const footprint =
    footprintKB > 1024 ? `~${(footprintKB / 1024).toFixed(1)} MB` : `~${footprintKB} kB`

  return (
    <section className={styles.section} data-testid="wartung-section">
      <h2 className={styles.sectionLabel}>Wartung</h2>
      <div className={styles.row}>
        <span className={styles.label}>Sitzungen</span>
        <span className={styles.value}>{sessionCount}</span>
      </div>
      <div className={styles.row}>
        <span className={styles.label}>Geschätzter Speicher</span>
        <span className={styles.value}>{footprint}</span>
      </div>
      <div className={styles.row}>
        <span className={styles.label}>Lifetime-Distanz</span>
        <span className={styles.value}>
          {(lifetime.total_distance_m / 1000).toFixed(1)} km
        </span>
      </div>
      {/* keep useQueries call alive to satisfy linter; data unused */}
      <span hidden>{sessionsQ[0].data?.length ?? 0}</span>
    </section>
  )
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd web && npx vitest run src/pages/profile/Wartung.test.tsx`
Expected: PASS — both tests green.

- [ ] **Step 6: Commit**

```bash
git add web/src/pages/profile/Wartung.tsx web/src/pages/profile/Wartung.module.css web/src/pages/profile/Wartung.test.tsx
git commit -m "feat(profile): extract Wartung component from PBSummary"
```

---

## Task 2: Create RekordeTab

**Files:**
- Create: `web/src/pages/history/RekordeTab.tsx`
- Create: `web/src/pages/history/RekordeTab.module.css`
- Create: `web/src/pages/history/RekordeTab.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `web/src/pages/history/RekordeTab.test.tsx`:

```tsx
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { RekordeTab } from './RekordeTab'

vi.mock('../../api/rowers', () => ({
  getActiveRower: vi.fn(async () => ({
    id: 'R1',
    name: 'Test',
    color: '#fff',
    created_at: '2026-01-01T00:00:00Z',
  })),
}))

const originalFetch = global.fetch
afterEach(() => {
  global.fetch = originalFetch
  vi.restoreAllMocks()
})

function renderTab() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <RekordeTab />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

function mockBackend(opts: {
  pbs?: { distance: unknown[]; window: unknown[]; workout: unknown[] }
  achievements?: unknown[]
}) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url.includes('/pbs')) {
        return new Response(
          JSON.stringify(opts.pbs ?? { distance: [], window: [], workout: [] }),
          { status: 200 },
        )
      }
      if (url.includes('/achievements')) {
        return new Response(JSON.stringify(opts.achievements ?? []), { status: 200 })
      }
      return new Response('{}', { status: 200 })
    }),
  )
}

describe('RekordeTab', () => {
  it('renders empty state when no PBs and no achievements', async () => {
    mockBackend({})
    renderTab()
    await waitFor(() =>
      expect(screen.getByText(/Noch keine Bestleistungen/)).toBeInTheDocument(),
    )
  })

  it('renders distance grid with placeholders for missing distances', async () => {
    mockBackend({
      pbs: {
        distance: [{ distance_m: 2000, time_sec: 480, achieved_at: '2026-04-01T10:00:00Z' }],
        window: [],
        workout: [],
      },
    })
    renderTab()
    await waitFor(() =>
      expect(screen.getByText(/Persönliche Bestzeiten · Distanzen/)).toBeInTheDocument(),
    )
    // 2 k card has the value
    expect(screen.getByText('08:00')).toBeInTheDocument()
    // Other standard distances render placeholder dashes
    const dashes = screen.getAllByText('—')
    expect(dashes.length).toBeGreaterThanOrEqual(5)
  })

  it('renders milestones strip when achievements include volume entries', async () => {
    mockBackend({
      pbs: {
        distance: [{ distance_m: 1000, time_sec: 240, achieved_at: '2026-04-01T10:00:00Z' }],
        window: [],
        workout: [],
      },
      achievements: [
        { type: 'volume', key: 'distance_10000m', value: 10000 },
      ],
    })
    renderTab()
    await waitFor(() => expect(screen.getByText(/Meilensteine/)).toBeInTheDocument())
    expect(screen.getByText(/10 km Gesamt/)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run src/pages/history/RekordeTab.test.tsx`
Expected: FAIL — "Cannot find module './RekordeTab'"

- [ ] **Step 3: Create CSS module**

Create `web/src/pages/history/RekordeTab.module.css` by copying everything from
`web/src/pages/profile/PBSummary.module.css` EXCEPT the `.wartungRow`,
`.wartungLabel`, and `.wartungValue` rules (those moved to `Wartung.module.css`
in Task 1).

Final content:

```css
.empty {
  color: var(--color-on-surface-variant);
  font-size: 14px;
  padding: var(--space-3);
}

.section {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  margin-bottom: var(--space-4);
}

.sectionLabel {
  font-family: var(--font-body, 'Inter'), sans-serif;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--color-on-surface-variant);
  margin: 0;
}

.distanceGrid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 8px;
}

@media (min-width: 600px) {
  .distanceGrid {
    grid-template-columns: repeat(3, 1fr);
  }
}

.distanceCard {
  background: var(--color-surface-container, #1f2020);
  border-radius: 12px;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.distanceLabel {
  font-family: var(--font-body, 'Inter'), sans-serif;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--color-on-surface-variant);
}

.distanceValue {
  font-family: var(--font-display, 'Space Grotesk'), sans-serif;
  font-size: 26px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  color: var(--color-on-surface);
}

.distanceDate {
  font-family: var(--font-body, 'Inter'), sans-serif;
  font-size: 11px;
  color: var(--color-on-surface-variant);
}

.windowList {
  display: flex;
  gap: 8px;
  overflow-x: auto;
  padding-bottom: 4px;
  -webkit-overflow-scrolling: touch;
  scroll-snap-type: x mandatory;
}

.windowCard {
  flex: 0 0 auto;
  min-width: 160px;
  background: var(--color-surface-container, #1f2020);
  border-radius: 12px;
  padding: 14px 16px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  scroll-snap-align: start;
}

.windowLabel {
  font-family: var(--font-body, 'Inter'), sans-serif;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--color-on-surface-variant);
}

.windowValue {
  font-family: var(--font-display, 'Space Grotesk'), sans-serif;
  font-size: 22px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  color: var(--color-on-surface);
}

.workoutList {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.workoutCard {
  background: var(--color-surface-container, #1f2020);
  border-radius: 12px;
  padding: 12px 16px;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.workoutMode {
  font-family: var(--font-body, 'Inter'), sans-serif;
  font-size: 13px;
  font-weight: 600;
  color: var(--color-on-surface);
}

.workoutValue {
  font-family: var(--font-display, 'Space Grotesk'), sans-serif;
  font-size: 18px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  color: var(--color-on-surface);
}

.consistencyGrid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
}

.consistencyCard {
  background: var(--color-surface-container, #1f2020);
  border-radius: 12px;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.consistencyLabel {
  font-family: var(--font-body, 'Inter'), sans-serif;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--color-on-surface-variant);
}

.consistencyValue {
  font-family: var(--font-display, 'Space Grotesk'), sans-serif;
  font-size: 17px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  color: var(--color-on-surface);
}

.milestones {
  display: flex;
  gap: 8px;
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
  padding-bottom: 4px;
}

.milestone {
  flex: 0 0 auto;
  background: var(--color-primary-container, rgba(0, 163, 175, 0.18));
  color: var(--color-on-primary-container, var(--color-on-surface));
  border-radius: 999px;
  padding: 6px 14px;
  font-family: var(--font-body, 'Inter'), sans-serif;
  font-size: 13px;
  font-weight: 600;
  white-space: nowrap;
}
```

- [ ] **Step 4: Implement RekordeTab**

Create `web/src/pages/history/RekordeTab.tsx`. This is `PBSummary.tsx` with:
- Wartung section removed
- Component renamed to `RekordeTab`, no `rowerID` prop — sources active rower via `useActiveRower`
- Empty-state branch added when nothing to render
- CSS module import path updated
- `getRowerLifetime` import + query removed

```tsx
import { useQuery } from '@tanstack/react-query'
import {
  getRowerAchievements,
  getRowerPBs,
  type Achievement,
  type RowerPBs,
} from '../../api/client'
import { useActiveRower } from '../../hooks/useActiveRower'
import { fmtMeters, mmssWhole, pace500m } from '../../util/format'
import styles from './RekordeTab.module.css'

export function RekordeTab() {
  const active = useActiveRower()
  const rowerID = active.data?.id

  const pbsQ = useQuery<RowerPBs>({
    queryKey: ['rower-pbs', rowerID],
    queryFn: () => getRowerPBs(rowerID!),
    enabled: !!rowerID,
  })
  const achievementsQ = useQuery<Achievement[]>({
    queryKey: ['rower-achievements', rowerID],
    queryFn: () => getRowerAchievements(rowerID!),
    enabled: !!rowerID,
  })

  if (!rowerID || pbsQ.isPending) {
    return <p className={styles.empty}>Bestleistungen werden geladen …</p>
  }
  const pbs = pbsQ.data
  if (!pbs) return null

  const distanceByM = new Map(pbs.distance.map((d) => [d.distance_m, d]))
  const milestones = (achievementsQ.data ?? []).filter((a) => a.type === 'volume')
  const consistency = (achievementsQ.data ?? []).filter(
    (a) => a.type === 'consistency_intra',
  )

  const isEmpty =
    pbs.distance.length === 0 &&
    pbs.window.length === 0 &&
    pbs.workout.length === 0 &&
    milestones.length === 0 &&
    consistency.length === 0

  if (isEmpty) {
    return (
      <p className={styles.empty}>Noch keine Bestleistungen. Starte ein Workout.</p>
    )
  }

  return (
    <>
      <DistanceGrid byM={distanceByM} />
      {pbs.window.length > 0 && <WindowSection items={pbs.window} />}
      {pbs.workout.length > 0 && <WorkoutSection items={pbs.workout} />}
      {consistency.length > 0 && <ConsistencyCards items={consistency} />}
      {milestones.length > 0 && <MilestonesStrip items={milestones} />}
    </>
  )
}

const STANDARD_DISTANCES = [500, 1000, 2000, 5000, 6000, 10000]

function DistanceGrid({ byM }: { byM: Map<number, RowerPBs['distance'][number]> }) {
  return (
    <section className={styles.section}>
      <h2 className={styles.sectionLabel}>Persönliche Bestzeiten · Distanzen</h2>
      <div className={styles.distanceGrid}>
        {STANDARD_DISTANCES.map((m) => {
          const pb = byM.get(m)
          return (
            <div key={m} className={styles.distanceCard}>
              <span className={styles.distanceLabel}>{distanceLabel(m)}</span>
              <span className={styles.distanceValue}>
                {pb ? mmssWhole(pb.time_sec) : '—'}
              </span>
              {pb && (
                <span className={styles.distanceDate}>
                  {formatShortDate(pb.achieved_at)}
                </span>
              )}
            </div>
          )
        })}
      </div>
    </section>
  )
}

function WindowSection({ items }: { items: RowerPBs['window'] }) {
  return (
    <section className={styles.section}>
      <h2 className={styles.sectionLabel}>Bestleistungen · Fenster</h2>
      <div className={styles.windowList}>
        {items.map((w) => (
          <div key={`${w.metric}-${w.window_size}`} className={styles.windowCard}>
            <span className={styles.windowLabel}>{windowLabel(w)}</span>
            <span className={styles.windowValue}>{windowValue(w)}</span>
          </div>
        ))}
      </div>
    </section>
  )
}

function WorkoutSection({ items }: { items: RowerPBs['workout'] }) {
  return (
    <section className={styles.section}>
      <h2 className={styles.sectionLabel}>Bestleistungen · Workouts</h2>
      <div className={styles.workoutList}>
        {items.map((w) => (
          <div key={w.shape_hash} className={styles.workoutCard}>
            <span className={styles.workoutMode}>{modeLabel(w.mode)}</span>
            <span className={styles.workoutValue}>
              {w.value_kind === 'time_sec'
                ? mmssWhole(w.value)
                : `${fmtMeters(w.value)} m`}
            </span>
          </div>
        ))}
      </div>
    </section>
  )
}

function ConsistencyCards({ items }: { items: Achievement[] }) {
  const byKey = new Map(items.map((a) => [a.key, a]))
  const cards: { key: string; label: string }[] = [
    { key: 'consistency_power_cv', label: 'Power-Konstanz' },
    { key: 'consistency_pace_split_cv', label: 'Split-Konstanz' },
    { key: 'consistency_spm_cv', label: 'SPM-Konstanz' },
  ]
  return (
    <section className={styles.section}>
      <h2 className={styles.sectionLabel}>Konstanz-Bestleistungen</h2>
      <div className={styles.consistencyGrid}>
        {cards.map((c) => {
          const a = byKey.get(c.key)
          return (
            <div key={c.key} className={styles.consistencyCard}>
              <span className={styles.consistencyLabel}>{c.label}</span>
              <span className={styles.consistencyValue}>
                {a && typeof a.value === 'number'
                  ? `CV ${(a.value * 100).toFixed(1)} %`
                  : '—'}
              </span>
            </div>
          )
        })}
      </div>
    </section>
  )
}

function MilestonesStrip({ items }: { items: Achievement[] }) {
  return (
    <section className={styles.section}>
      <h2 className={styles.sectionLabel}>Meilensteine</h2>
      <div className={styles.milestones}>
        {items.map((a) => (
          <span key={a.key} className={styles.milestone}>
            🏆 {milestoneLabel(a.key)}
          </span>
        ))}
      </div>
    </section>
  )
}

function distanceLabel(m: number): string {
  if (m >= 1000) return `${m / 1000} k`
  return `${m} m`
}

function windowLabel(w: { metric: string; window_kind: string; window_size: number }): string {
  const win = w.window_kind === 'seconds' ? `${w.window_size} s` : `${w.window_size} Schläge`
  switch (w.metric) {
    case 'power':
      return `Beste ${win} Power`
    case 'pace':
      return `Bester ${win} Split`
    case 'dps':
      return `Beste ${win} DPS`
    case 'spi':
      return `Beste ${win} SPI`
  }
  return `${w.metric} ${win}`
}

function windowValue(w: { metric: string; value: number }): string {
  switch (w.metric) {
    case 'power':
      return `${Math.round(w.value)} W`
    case 'pace':
      return pace500m(Math.round(w.value))
    case 'dps':
      return `${w.value.toFixed(2)} m`
    case 'spi':
      return `${w.value.toFixed(1)} J`
  }
  return String(w.value)
}

function modeLabel(mode: string): string {
  switch (mode) {
    case 'distance':
      return 'Distanz'
    case 'time':
      return 'Zeit'
    case 'intervals':
      return 'Intervalle'
    case 'just_row':
      return 'Just Row'
  }
  return mode
}

function milestoneLabel(key: string): string {
  if (key.startsWith('distance_') && key.endsWith('m')) {
    const meters = parseInt(key.slice(9, -1), 10)
    return `${meters / 1000} km Gesamt`
  }
  if (key.startsWith('strokes_')) {
    const n = parseInt(key.slice(8), 10)
    return `${n.toLocaleString('de-DE')} Schläge`
  }
  if (key.startsWith('active_seconds_')) {
    const sec = parseInt(key.slice(15), 10)
    return `${Math.round(sec / 3600)} h aktiv`
  }
  return key
}

function formatShortDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit' })
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd web && npx vitest run src/pages/history/RekordeTab.test.tsx`
Expected: PASS — all three tests green.

- [ ] **Step 6: Commit**

```bash
git add web/src/pages/history/RekordeTab.tsx web/src/pages/history/RekordeTab.module.css web/src/pages/history/RekordeTab.test.tsx
git commit -m "feat(history): add Rekorde tab composing PB sections"
```

---

## Task 3: Wire Rekorde route + nav link

**Files:**
- Modify: `web/src/app/AppRouter.tsx`
- Modify: `web/src/pages/HistoryPage.tsx`
- Modify: `web/src/pages/HistoryPage.test.tsx`

- [ ] **Step 1: Update HistoryPage test to assert third tab**

Edit `web/src/pages/HistoryPage.test.tsx`. Replace the first test block:

```tsx
  it('renders the sub-nav with Sessions, Trends, and Rekorde links', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ sessions: [] }), { status: 200 })),
    )
    wrap()
    expect(screen.getByRole('link', { name: 'Sessions' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Trends' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Rekorde' })).toBeInTheDocument()
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run src/pages/HistoryPage.test.tsx`
Expected: FAIL — "Unable to find role 'link' with name 'Rekorde'"

- [ ] **Step 3: Add Rekorde link to HistoryPage**

Edit `web/src/pages/HistoryPage.tsx`. After the existing Trends `NavLink`, add:

```tsx
        <NavLink
          to="/historie/rekorde"
          className={({ isActive }) =>
            isActive ? `${styles.tab} ${styles.tabActive}` : styles.tab
          }
        >
          Rekorde
        </NavLink>
```

- [ ] **Step 4: Add Rekorde route to AppRouter**

Edit `web/src/app/AppRouter.tsx`:

Add import after the existing TrendsTab import:

```tsx
import { RekordeTab } from '../pages/history/RekordeTab'
```

Add route inside the `/historie` Route, after the trends route:

```tsx
                <Route path="/historie" element={<HistoryPage />}>
                  <Route index element={<SessionsTab />} />
                  <Route path="trends" element={<TrendsTab />} />
                  <Route path="rekorde" element={<RekordeTab />} />
                </Route>
```

- [ ] **Step 5: Run HistoryPage test to verify it passes**

Run: `cd web && npx vitest run src/pages/HistoryPage.test.tsx`
Expected: PASS — all three tests green.

- [ ] **Step 6: Commit**

```bash
git add web/src/app/AppRouter.tsx web/src/pages/HistoryPage.tsx web/src/pages/HistoryPage.test.tsx
git commit -m "feat(history): wire Rekorde route and subnav link"
```

---

## Task 4: Swap PBSummary for Wartung in ProfilePage; delete PBSummary

**Files:**
- Modify: `web/src/pages/ProfilePage.tsx`
- Delete: `web/src/pages/profile/PBSummary.tsx`
- Delete: `web/src/pages/profile/PBSummary.module.css`

- [ ] **Step 1: Update ProfilePage to render Wartung instead of PBSummary**

Edit `web/src/pages/ProfilePage.tsx`:

Change the import:

```tsx
import { Wartung } from './profile/Wartung'
```

(remove the `import { PBSummary } from './profile/PBSummary'` line)

Inside the active-rower section, replace the `<PBSummary>` element so the section reads:

```tsx
        <section className={styles.section}>
          <h2 className={styles.sectionLabel}>Aktiver Rudernde</h2>
          <HeroCard rower={activeRower} />
          <RowerEditor r={activeRower} />
          <Wartung rowerID={activeRower.id} />
        </section>
```

(note: `Wartung` now sits *after* `RowerEditor`, not before, per spec — housekeeping grouped near account)

- [ ] **Step 2: Delete PBSummary files**

```bash
git rm web/src/pages/profile/PBSummary.tsx web/src/pages/profile/PBSummary.module.css
```

- [ ] **Step 3: Run frontend tests**

Run: `cd web && npx vitest run`
Expected: PASS — full suite green. No leftover references to `PBSummary`.

- [ ] **Step 4: Run TypeScript check**

Run: `cd web && npx tsc --noEmit`
Expected: PASS — no type errors.

- [ ] **Step 5: Manual verification in browser**

Start dev server (if not running): `cd web && npm run dev`

Verify in browser:
1. Navigate to `/historie` → Sessions tab visible, three sub-nav links: Sessions / Trends / Rekorde.
2. Click Rekorde → URL becomes `/historie/rekorde`. PB content renders (or empty-state copy if no PBs).
3. Click Trends → still works.
4. Navigate to `/profil` → no PB sections present. Wartung section visible at the bottom of the active-rower block, showing session count, footprint, lifetime distance.
5. Reload `/historie/rekorde` directly → renders correctly (route works on hard refresh).

- [ ] **Step 6: Commit**

```bash
git add web/src/pages/ProfilePage.tsx
git commit -m "refactor(profile): drop PBSummary; use Wartung directly"
```

---

## Self-Review Notes

- **Spec coverage:** Routing ✓ Task 3. RekordeTab composition ✓ Task 2. Wartung extraction ✓ Task 1. ProfilePage swap ✓ Task 4. PBSummary deletion ✓ Task 4. HistoryPage test update ✓ Task 3. ProfilePage test update — N/A, file does not exist.
- **Type consistency:** `Wartung` props `{ rowerID: string }` consistent in Tasks 1 and 4. `RekordeTab` takes no props (sources active rower internally) consistent in Tasks 2 and 3.
- **Placeholders:** None.
- **Order:** Wartung first (Task 1) so ProfilePage swap in Task 4 has something to import. RekordeTab second (Task 2) so route wiring in Task 3 has something to import. Deletion last (Task 4) so no broken imports during the route + test wiring.
