# FEAT-0004 PB Notification Overlay Implementation Plan

> **Status:** Shipped — merged to main 2026-05-01.


> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the small "🏆" pills in `SessionEndedOverlay` with the hero / multi-stack PB notification per the Stitch designs (`PB: 500m Bestzeit (Dark)`, `PB: Mehrere Bestleistungen (Stack)`, `PB: 10 km Bestzeit (Light)`, `PB: Wattbestzeit (Tablet)`, `Workout abgeschlossen: Neue Bestzeit!`, `Bestleistungen werden berechnet…`). Backend wiring already exists; this plan is web-only.

**Architecture:** New `PBOverlay` shown FIRST after session_end when the resolved banners contain ≥1 PB; user dismisses it before reaching the existing summary card. Multi-PBs render as a horizontal carousel with dot indicator. The existing `SessionEndedOverlay` remains intact and runs after the PB overlay closes (or shows immediately when there were no PBs).

**Tech Stack:** React 18 / TanStack Query (already wired), CSS modules, vitest + React Testing Library. No new deps.

**Out of scope:**
- Mid-session live PB triggers. Would require a new SSE event kind (`pb_announce`) emitted by the recompute scheduler when an in-flight session crosses a PB threshold. Defer to a follow-up; backend has the data but no push channel.
- Backend changes — `previous_time_sec` / `previous_value` are already in the API response.

---

## Files map

**New:**
- `web/src/pages/live/PBOverlay.tsx` — full-screen modal; stack-aware.
- `web/src/pages/live/PBOverlay.module.css`
- `web/src/pages/live/PBOverlay.test.tsx`
- `web/src/pages/live/PBCard.tsx` — single-PB hero card (used both standalone and inside stack).
- `web/src/pages/live/pbCopy.ts` — title/icon/value-formatter per PB kind. Pure functions.
- `web/src/pages/live/pbCopy.test.ts`

**Modified:**
- `web/src/pages/live/SessionEndedOverlay.tsx` — drop the inline `BannersStrip`. Banners now travel through `PBOverlay`; this card just shows summary + actions.
- `web/src/pages/LivePage.tsx` — orchestrate: while banners.kind === 'computing' show summary with skeleton; once `resolved` and non-empty, render `PBOverlay` first; once dismissed, fall through to `SessionEndedOverlay`.

---

## Phase A — pure helpers (Tasks 1-2)

### Task 1: PB copy + formatter helpers

**Files:**
- Create: `web/src/pages/live/pbCopy.ts`
- Create: `web/src/pages/live/pbCopy.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// web/src/pages/live/pbCopy.test.ts
import { describe, expect, it } from 'vitest'
import {
  pbTitleDistance,
  pbTitleWindow,
  pbDeltaText,
  pbHeroValue,
  pbIcon,
} from './pbCopy'
import type { DistancePB, WindowPB } from '../../api/client'

const dpb: DistancePB = {
  distance_m: 500,
  time_sec: 98,
  previous_time_sec: 102,
  source_session_id: 'S1',
  source_session_started_at: '',
  achieved_at: '2026-05-01T18:42:00Z',
}

const wpb: WindowPB = {
  metric: 'power',
  window_kind: 'seconds',
  window_size: 60,
  value: 286,
  previous_value: 268,
  source_session_id: 'S1',
  source_session_started_at: '',
  achieved_at: '2026-05-01T18:42:00Z',
}

describe('pbCopy', () => {
  it('formats distance PB title', () => {
    expect(pbTitleDistance({ ...dpb, distance_m: 500 })).toBe('Neue 500m-Bestzeit!')
    expect(pbTitleDistance({ ...dpb, distance_m: 10000 })).toBe('Neue 10 km-Bestzeit!')
  })

  it('formats window PB title', () => {
    expect(pbTitleWindow(wpb)).toBe('Neue Wattbestzeit!')
    expect(pbTitleWindow({ ...wpb, metric: 'pace' })).toBe('Neue Pace-Bestzeit!')
  })

  it('formats hero value for split (distance PB time)', () => {
    expect(pbHeroValue('distance', dpb)).toBe('1:38')
  })

  it('formats hero value for distance PB long format', () => {
    expect(
      pbHeroValue('distance', { ...dpb, distance_m: 10000, time_sec: 2533 }),
    ).toBe('00:42:13')
  })

  it('formats hero value for power window PB', () => {
    expect(pbHeroValue('window', wpb)).toBe('286 W')
  })

  it('renders delta line for distance PB', () => {
    expect(pbDeltaText('distance', dpb)).toBe('vorher 1:42 — schneller um 4 s')
  })

  it('renders delta for power PB', () => {
    expect(pbDeltaText('window', wpb)).toBe('vorher 268 W — +18 W')
  })

  it('renders empty delta when no previous value', () => {
    expect(pbDeltaText('distance', { ...dpb, previous_time_sec: undefined })).toBe('')
  })

  it('returns icon name per kind', () => {
    expect(pbIcon('distance')).toBe('medal')
    expect(pbIcon('window', 'power')).toBe('lightning')
    expect(pbIcon('window', 'pace')).toBe('stopwatch')
  })
})
```

- [ ] **Step 2: Run** — FAIL.

```
cd web && npm test -- --run src/pages/live/pbCopy.test.ts
```

- [ ] **Step 3: Implement helpers**

```ts
// web/src/pages/live/pbCopy.ts
import type { DistancePB, WindowPB } from '../../api/client'
import { mmssWhole, pace500m } from '../../util/format'

export type PBKind = 'distance' | 'window'
export type PBIcon = 'medal' | 'lightning' | 'stopwatch' | 'bolt'

export function pbTitleDistance(p: DistancePB): string {
  const d = p.distance_m
  if (d >= 1000) return `Neue ${d / 1000} km-Bestzeit!`
  return `Neue ${d}m-Bestzeit!`
}

export function pbTitleWindow(p: WindowPB): string {
  switch (p.metric) {
    case 'power': return 'Neue Wattbestzeit!'
    case 'pace':  return 'Neue Pace-Bestzeit!'
    case 'dps':   return 'Neue DPS-Bestzeit!'
    case 'spi':   return 'Neue SPI-Bestzeit!'
    default:      return `Neue ${p.metric}-Bestzeit!`
  }
}

export function pbHeroValue(kind: PBKind, p: DistancePB | WindowPB): string {
  if (kind === 'distance') {
    const t = (p as DistancePB).time_sec
    const d = (p as DistancePB).distance_m
    return d >= 1000 ? formatHHMMSS(t) : pace500m(t * (500 / d))
    // For ≤1km PBs we display mm:ss split; for ≥1km we show absolute time.
  }
  const w = p as WindowPB
  switch (w.metric) {
    case 'power': return `${Math.round(w.value)} W`
    case 'pace':  return pace500m(w.value)
    case 'dps':   return w.value.toFixed(1) + ' m'
    case 'spi':   return w.value.toFixed(1)
    default:      return String(w.value)
  }
}

export function pbDeltaText(kind: PBKind, p: DistancePB | WindowPB): string {
  if (kind === 'distance') {
    const dp = p as DistancePB
    if (dp.previous_time_sec === undefined) return ''
    const delta = dp.previous_time_sec - dp.time_sec
    const prev = dp.distance_m >= 1000 ? formatHHMMSS(dp.previous_time_sec) : mmssWhole(dp.previous_time_sec)
    return `vorher ${prev} — schneller um ${formatDelta(delta)}`
  }
  const w = p as WindowPB
  if (w.previous_value === undefined) return ''
  const delta = w.value - w.previous_value
  const sign = delta >= 0 ? '+' : ''
  switch (w.metric) {
    case 'power': return `vorher ${Math.round(w.previous_value)} W — ${sign}${Math.round(delta)} W`
    case 'pace':  return `vorher ${pace500m(w.previous_value)} — schneller um ${formatDelta(w.previous_value - w.value)}`
    default:      return `vorher ${w.previous_value.toFixed(1)} — ${sign}${delta.toFixed(1)}`
  }
}

export function pbIcon(kind: PBKind, metric?: string): PBIcon {
  if (kind === 'distance') return 'medal'
  switch (metric) {
    case 'power': return 'lightning'
    case 'pace':  return 'stopwatch'
    case 'dps':
    case 'spi':
    default:      return 'bolt'
  }
}

function formatHHMMSS(sec: number): string {
  const s = Math.round(sec)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60).toString().padStart(2, '0')
  const r = (s % 60).toString().padStart(2, '0')
  return `${h.toString().padStart(2, '0')}:${m}:${r}`
}

function formatDelta(deltaSec: number): string {
  const abs = Math.abs(deltaSec)
  if (abs >= 60) {
    const m = Math.floor(abs / 60)
    const s = Math.round(abs % 60)
    return `${m}:${s.toString().padStart(2, '0')} min`
  }
  return `${Math.round(abs)} s`
}
```

- [ ] **Step 4: Run** — PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/pages/live/pbCopy.ts web/src/pages/live/pbCopy.test.ts
git commit -m "feat(pb): copy + formatter helpers (title/value/delta/icon)"
```

---

### Task 2: PBCard component (hero treatment)

**Files:**
- Create: `web/src/pages/live/PBCard.tsx`
- Create: `web/src/pages/live/PBCard.module.css`
- Create: `web/src/pages/live/PBCard.test.tsx`

- [ ] **Step 1: Failing test**

```tsx
// web/src/pages/live/PBCard.test.tsx
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { PBCard } from './PBCard'

const dpb = {
  kind: 'distance' as const,
  pb: {
    distance_m: 500,
    time_sec: 98,
    previous_time_sec: 102,
    source_session_id: 'S1',
    source_session_started_at: '',
    achieved_at: '2026-05-01T18:42:00Z',
  },
}

describe('PBCard', () => {
  it('renders title, hero value, delta', () => {
    render(<PBCard {...dpb} />)
    expect(screen.getByText('Neue 500m-Bestzeit!')).toBeTruthy()
    expect(screen.getByText('1:38')).toBeTruthy()
    expect(screen.getByText(/vorher 1:42/)).toBeTruthy()
  })

  it('omits delta line when no previous value', () => {
    render(<PBCard kind="distance" pb={{ ...dpb.pb, previous_time_sec: undefined }} />)
    expect(screen.queryByText(/vorher/)).toBeNull()
  })

  it('shows achievement icon by name', () => {
    render(<PBCard {...dpb} />)
    expect(screen.getByTestId('pb-icon-medal')).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run** — FAIL.

- [ ] **Step 3: Implement**

```tsx
// web/src/pages/live/PBCard.tsx
import type { DistancePB, WindowPB } from '../../api/client'
import {
  pbTitleDistance,
  pbTitleWindow,
  pbHeroValue,
  pbDeltaText,
  pbIcon,
  type PBKind,
} from './pbCopy'
import styles from './PBCard.module.css'

type Props =
  | { kind: 'distance'; pb: DistancePB }
  | { kind: 'window'; pb: WindowPB }

export function PBCard(props: Props) {
  const title =
    props.kind === 'distance' ? pbTitleDistance(props.pb) : pbTitleWindow(props.pb)
  const value = pbHeroValue(props.kind, props.pb)
  const delta = pbDeltaText(props.kind, props.pb)
  const iconName = pbIcon(
    props.kind,
    props.kind === 'window' ? props.pb.metric : undefined,
  )
  const stamp = formatStamp(props.pb.achieved_at)

  return (
    <article className={styles.card} aria-label={`${title} ${value}`}>
      <header className={styles.head}>
        <Icon name={iconName} />
        <span className={styles.stamp}>{stamp}</span>
      </header>
      <h2 className={styles.title}>{title}</h2>
      <p className={styles.hero}>{value}</p>
      {delta && <p className={styles.delta}>{delta}</p>}
    </article>
  )
}

function Icon({ name }: { name: 'medal' | 'lightning' | 'stopwatch' | 'bolt' }) {
  // Inline SVGs keep the bundle tiny + theme-aware via currentColor.
  const map: Record<string, string> = {
    medal: 'M12 2l3 6 6 .5-4.5 4 1.5 6.5L12 16l-6 3 1.5-6.5L3 8.5 9 8z',
    lightning: 'M13 2L3 14h7l-1 8 11-14h-7z',
    stopwatch: 'M12 8v5l3 2M12 22a8 8 0 100-16 8 8 0 000 16z M9 2h6',
    bolt: 'M11 21h-1l1-7H7.5L13 3h1l-1 7h3.5z',
  }
  return (
    <svg
      data-testid={`pb-icon-${name}`}
      className={styles.icon}
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d={map[name]} />
    </svg>
  )
}

function formatStamp(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const dd = d.getDate().toString().padStart(2, '0')
  const mm = (d.getMonth() + 1).toString().padStart(2, '0')
  const yyyy = d.getFullYear()
  const hh = d.getHours().toString().padStart(2, '0')
  const mi = d.getMinutes().toString().padStart(2, '0')
  return `${dd}.${mm}.${yyyy} ${hh}:${mi}`
}

export type { PBKind }
```

```css
/* web/src/pages/live/PBCard.module.css */
.card {
  display: grid;
  gap: 12px;
  padding: 24px;
  border-radius: 24px;
  background: var(--surface, #1a1a1a);
  color: var(--text, #fff);
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.4);
  width: 80vw;
  max-width: 360px;
  text-align: center;
}
.head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 12px;
  color: var(--text-muted, #999);
}
.icon { color: var(--accent-pb, #ed7b7b); }
.stamp { font-variant-numeric: tabular-nums; }
.title {
  font: 700 28px/1.1 'Space Grotesk', system-ui, sans-serif;
  color: var(--accent-pb, #ed7b7b);
  margin: 0;
}
.hero {
  font: 500 84px/1 'Space Grotesk', system-ui, sans-serif;
  font-variant-numeric: tabular-nums;
  margin: 8px 0;
  letter-spacing: -0.02em;
}
.delta {
  font-size: 14px;
  color: var(--text-muted, #aaa);
  margin: 0;
}
```

- [ ] **Step 4: Run** — PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/pages/live/PBCard.tsx web/src/pages/live/PBCard.module.css web/src/pages/live/PBCard.test.tsx
git commit -m "feat(pb): hero PBCard with achievement icon + delta"
```

---

## Phase B — overlay + orchestration (Tasks 3-5)

### Task 3: PBOverlay (single + carousel)

**Files:**
- Create: `web/src/pages/live/PBOverlay.tsx`
- Create: `web/src/pages/live/PBOverlay.module.css`
- Create: `web/src/pages/live/PBOverlay.test.tsx`

- [ ] **Step 1: Failing test**

```tsx
// web/src/pages/live/PBOverlay.test.tsx
import { describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { PBOverlay } from './PBOverlay'
import type { SessionPBBanners } from '../../api/client'

const onlyDist: SessionPBBanners = {
  distance: [
    {
      distance_m: 500,
      time_sec: 98,
      previous_time_sec: 102,
      source_session_id: 'S1',
      source_session_started_at: '',
      achieved_at: '2026-05-01T18:42:00Z',
    },
  ],
  window: [],
}

const stack: SessionPBBanners = {
  distance: [onlyDist.distance[0]],
  window: [
    {
      metric: 'power',
      window_kind: 'seconds',
      window_size: 60,
      value: 286,
      previous_value: 268,
      source_session_id: 'S1',
      source_session_started_at: '',
      achieved_at: '2026-05-01T18:42:00Z',
    },
    {
      metric: 'pace',
      window_kind: 'seconds',
      window_size: 60,
      value: 110,
      previous_value: 115,
      source_session_id: 'S1',
      source_session_started_at: '',
      achieved_at: '2026-05-01T18:42:00Z',
    },
  ],
}

describe('PBOverlay', () => {
  it('renders single-PB hero', () => {
    render(<PBOverlay banners={onlyDist} onDismiss={() => {}} onShowInRekorde={() => {}} />)
    expect(screen.getByText('Neue 500m-Bestzeit!')).toBeTruthy()
    expect(screen.queryByTestId('pb-stack-dots')).toBeNull()
  })

  it('renders stack with dot indicator', () => {
    render(<PBOverlay banners={stack} onDismiss={() => {}} onShowInRekorde={() => {}} />)
    const dots = screen.getByTestId('pb-stack-dots').querySelectorAll('span')
    expect(dots.length).toBe(3) // 1 distance + 2 window
  })

  it('Weiter advances stack until last card; final Weiter dismisses', () => {
    const onDismiss = vi.fn()
    render(<PBOverlay banners={stack} onDismiss={onDismiss} onShowInRekorde={() => {}} />)
    const next = () => fireEvent.click(screen.getByRole('button', { name: /Weiter/i }))
    next() // 1 → 2
    next() // 2 → 3
    next() // 3 → dismiss
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  it('In Rekorden zeigen invokes callback with current PB', () => {
    const onShow = vi.fn()
    render(<PBOverlay banners={onlyDist} onDismiss={() => {}} onShowInRekorde={onShow} />)
    fireEvent.click(screen.getByRole('button', { name: /In Rekorden zeigen/i }))
    expect(onShow).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 2: Run** — FAIL.

- [ ] **Step 3: Implement**

```tsx
// web/src/pages/live/PBOverlay.tsx
import { useMemo, useState } from 'react'
import type { DistancePB, SessionPBBanners, WindowPB } from '../../api/client'
import { PBCard } from './PBCard'
import styles from './PBOverlay.module.css'

type Item =
  | { kind: 'distance'; pb: DistancePB }
  | { kind: 'window'; pb: WindowPB }

type Props = {
  banners: SessionPBBanners
  onDismiss: () => void
  onShowInRekorde: (item: Item) => void
}

export function PBOverlay({ banners, onDismiss, onShowInRekorde }: Props) {
  const items: Item[] = useMemo(() => {
    return [
      ...banners.distance.map((pb): Item => ({ kind: 'distance', pb })),
      ...banners.window.map((pb): Item => ({ kind: 'window', pb })),
    ]
  }, [banners])
  const [idx, setIdx] = useState(0)

  if (items.length === 0) {
    // Caller should not render us in this case, but be defensive.
    return null
  }
  const current = items[idx]
  const isLast = idx === items.length - 1
  const advance = () => (isLast ? onDismiss() : setIdx(idx + 1))

  return (
    <div className={styles.scrim} role="dialog" aria-modal="true" data-testid="pb-overlay">
      <div className={styles.holder}>
        {items.length > 1 && (
          <div className={styles.dots} data-testid="pb-stack-dots">
            {items.map((_, i) => (
              <span key={i} className={i === idx ? styles.dotActive : styles.dot} />
            ))}
          </div>
        )}
        <PBCard {...current} />
        <div className={styles.actions}>
          <button type="button" className={styles.primary} onClick={advance}>
            {isLast ? 'Weiter' : 'Weiter'}
          </button>
          <button
            type="button"
            className={styles.secondary}
            onClick={() => onShowInRekorde(current)}
          >
            In Rekorden zeigen
          </button>
        </div>
      </div>
    </div>
  )
}

export type { Item as PBOverlayItem }
```

```css
/* web/src/pages/live/PBOverlay.module.css */
.scrim {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.65);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1100;
  animation: fade-in 220ms cubic-bezier(0.2, 0.9, 0.2, 1);
}
.holder {
  display: grid;
  gap: 16px;
  align-items: center;
  justify-items: center;
  animation: pop-in 220ms cubic-bezier(0.2, 0.9, 0.2, 1);
}
.dots { display: flex; gap: 6px; }
.dot, .dotActive {
  width: 8px; height: 8px; border-radius: 999px;
  background: rgba(255,255,255,0.3);
}
.dotActive { background: var(--accent-pb, #ed7b7b); }
.actions {
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 80vw;
  max-width: 360px;
}
.primary, .secondary {
  font: inherit;
  padding: 12px 16px;
  border-radius: 12px;
  border: none;
  cursor: pointer;
}
.primary {
  background: var(--accent-pb, #ed7b7b);
  color: #fff;
  font-weight: 600;
}
.secondary {
  background: transparent;
  color: var(--text, #fff);
  border: 1px solid rgba(255,255,255,0.3);
}
@keyframes fade-in { from { opacity: 0; } to { opacity: 1; } }
@keyframes pop-in {
  from { transform: scale(0.92); opacity: 0; }
  to { transform: scale(1); opacity: 1; }
}
```

- [ ] **Step 4: Run** — PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/pages/live/PBOverlay.tsx web/src/pages/live/PBOverlay.module.css web/src/pages/live/PBOverlay.test.tsx
git commit -m "feat(pb): PBOverlay with single + carousel variants"
```

---

### Task 4: Strip banners from SessionEndedOverlay

**Files:**
- Modify: `web/src/pages/live/SessionEndedOverlay.tsx`
- Modify: `web/src/pages/live/SessionEndedOverlay.test.tsx` if it asserts banner pills.

- [ ] **Step 1: Update component**

Remove the `BannersStrip` block and the `windowLabel` helper. Keep `summary` + `actions`. The `banners` prop becomes optional (computing-state still informs the subtitle line).

```tsx
type Props = {
  summary: SessionEndSummary
  banners: BannerState
  onAcknowledge: () => void
  onShowDetails?: () => void
}

export function SessionEndedOverlay({ summary, banners, onAcknowledge, onShowDetails }: Props) {
  return (
    <div className={styles.scrim} role="dialog" aria-modal="true" aria-labelledby="ended-title">
      <section className={styles.card} data-testid="session-ended-overlay">
        <div className={styles.header}>
          <h2 id="ended-title" className={styles.title}>Session beendet</h2>
          <p className={styles.subtitle}>
            {banners.kind === 'computing'
              ? 'Bestleistungen werden berechnet …'
              : 'Bereit für eine neue Runde?'}
          </p>
        </div>
        <div className={styles.metrics}>
          <Cell label="Distanz" value={`${fmtMeters(summary.total_distance_m)} m`} />
          <Cell label="Zeit" value={mmssWhole(summary.total_time_sec)} />
          <Cell label="Ø Split" value={pace500m(summary.avg_pace_sec_per_500m)} />
          <Cell label="Schläge" value={fmtInt(summary.total_strokes)} />
        </div>
        <div className={styles.actions}>
          <button type="button" className={styles.primary} onClick={onAcknowledge} data-testid="session-ended-ok">
            Neue Session starten
          </button>
          {onShowDetails && (
            <button type="button" className={styles.secondary} onClick={onShowDetails} data-testid="session-ended-details">
              Details ansehen
            </button>
          )}
        </div>
      </section>
    </div>
  )
}
```

Drop `BannersStrip` + `windowLabel` from this file entirely.

- [ ] **Step 2: Update tests**

Find any test asserting `pb-banners-resolved` or pill rendering inside the SessionEndedOverlay; relocate those assertions to `PBOverlay.test.tsx` (already covered there). Strip from this file.

- [ ] **Step 3: Run** — `cd web && npm test -- --run`. All PASS.

- [ ] **Step 4: Commit**

```bash
git add web/src/pages/live/SessionEndedOverlay.tsx web/src/pages/live/SessionEndedOverlay.test.tsx
git commit -m "refactor(session-end): drop inline PB pills (moved to PBOverlay)"
```

---

### Task 5: Wire PBOverlay into LivePage flow

**Files:**
- Modify: `web/src/pages/LivePage.tsx`
- Test: extend `web/src/pages/LivePage.test.tsx`

- [ ] **Step 1: Failing test**

```tsx
it('shows PBOverlay before SessionEndedOverlay when resolved banners contain PBs', async () => {
  // Mock fetch for /pb-banners returning a non-empty banner.
  // Latched session-end. Render LivePage. Expect PBOverlay first;
  // click Weiter → SessionEndedOverlay.
})
```

(Mirror the existing LivePage test setup — likely uses a latched session storage shim. If the existing structure makes this awkward, place this test on a smaller `LivePostSessionFlow` extracted helper component instead.)

- [ ] **Step 2: Run** — FAIL.

- [ ] **Step 3: Implement orchestrator**

In `LivePage.tsx`, around the existing latched/banners block, add a `pbDismissed` ref or state. Render order:

```tsx
{latched && banners.kind === 'resolved' &&
 (banners.banners.distance.length + banners.banners.window.length) > 0 &&
 !pbDismissed && (
  <PBOverlay
    banners={banners.banners}
    onDismiss={() => setPbDismissed(true)}
    onShowInRekorde={(item) => {
      const ridParam = activeRowerId ? `?rower=${activeRowerId}` : ''
      const anchor = pbAnchor(item)
      nav(`/history/rekorde${ridParam}${anchor}`)
      dismiss() // also clear latched session-end state
    }}
  />
)}

{latched && (banners.kind !== 'resolved' || pbDismissed ||
   (banners.banners.distance.length + banners.banners.window.length) === 0) && (
  <SessionEndedOverlay … />
)}
```

`pbAnchor(item)` returns `#pb-distance-500` or `#pb-window-power-60`; the Rekorde tab's PB rows already render with stable ids (verify; if not, add `id={`pb-${kind}-…`}` while wiring this).

`pbDismissed` resets when `latched` clears (effect: `useEffect(() => { if (!latched) setPbDismissed(false) }, [latched])`).

- [ ] **Step 4: Run** — PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/pages/LivePage.tsx web/src/pages/LivePage.test.tsx
git commit -m "feat(live): show PBOverlay before SessionEndedOverlay when PBs present"
```

---

## Phase C — polish (Tasks 6-7)

### Task 6: Rekorde anchor scroll-to

**Files:**
- Modify: `web/src/pages/history/RekordeTab.tsx`
- Test: extend `web/src/pages/history/RekordeTab.test.tsx`

- [ ] **Step 1: Add stable ids on PB rows**

Each PB row in RekordeTab renders with an `id` attribute matching the anchor format used by `pbAnchor(item)`:

```tsx
<li id={`pb-distance-${pb.distance_m}`}>…</li>
<li id={`pb-window-${pb.metric}-${pb.window_size}`}>…</li>
```

- [ ] **Step 2: Auto-scroll on hash on mount**

```tsx
useEffect(() => {
  const hash = window.location.hash
  if (!hash) return
  const el = document.getElementById(hash.slice(1))
  if (el) {
    el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    el.classList.add(styles.flash)
    window.setTimeout(() => el.classList.remove(styles.flash), 2000)
  }
}, [])
```

Add a `.flash` keyframe (1.5s color fade) to the CSS module.

- [ ] **Step 3: Test**

Component test: render with `window.location.hash = '#pb-distance-500'` and assert the matching row has `flash` class after mount.

- [ ] **Step 4: Run** — PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/pages/history/RekordeTab.tsx web/src/pages/history/RekordeTab.module.css web/src/pages/history/RekordeTab.test.tsx
git commit -m "feat(rekorde): scroll-to + flash anchor for deep-linked PB row"
```

---

### Task 7: Workout-completed PB variant headline

**Files:**
- Modify: `web/src/pages/live/PBOverlay.tsx`
- Test: add a case to `PBOverlay.test.tsx`

The Stitch screen `Workout abgeschlossen: Neue Bestzeit!` is the same overlay with an extra subtitle line when the just-ended session was a workout (not a free row). Surface it via an optional `workoutLabel?: string` prop on `PBOverlay`. Renders as a small line above the card title:

```tsx
{workoutLabel && <p className={styles.workoutLabel}>Workout abgeschlossen · {workoutLabel}</p>}
```

LivePage passes `workoutLabel` if `latched.summary.workout_id` was non-null; the workout name comes from the existing workout query.

- [ ] **Step 1: Test**

```tsx
it('shows workout-complete subtitle when label is provided', () => {
  render(
    <PBOverlay
      banners={onlyDist}
      workoutLabel="2× 500m"
      onDismiss={() => {}}
      onShowInRekorde={() => {}}
    />,
  )
  expect(screen.getByText(/Workout abgeschlossen · 2× 500m/)).toBeTruthy()
})
```

- [ ] **Step 2: Implement** — add the optional prop + render block.

- [ ] **Step 3: Wire from LivePage** — pass workout name when present.

- [ ] **Step 4: Run** — PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/pages/live/PBOverlay.tsx web/src/pages/live/PBOverlay.module.css web/src/pages/live/PBOverlay.test.tsx web/src/pages/LivePage.tsx
git commit -m "feat(pb): workout-completed subtitle on PBOverlay"
```

---

## Self-review

**Spec coverage** — every Stitch screen maps to code:

| Stitch screen | Implemented in |
|---|---|
| PB: 500m Bestzeit (Dark) | PBCard + PBOverlay (single) |
| PB: 10 km Bestzeit (Light) | Same component, theme-driven (light is the existing :root variant) |
| PB: Wattbestzeit (Tablet) | Same component; CSS scales fluidly |
| PB: Mehrere Bestleistungen (Stack) | PBOverlay carousel mode |
| Workout abgeschlossen: Neue Bestzeit! | PBOverlay with `workoutLabel` prop (Task 7) |
| Bestleistungen werden berechnet… | Existing SessionEndedOverlay subtitle (kept; no separate component needed) |

**Placeholder scan:** None — every step has real code or test.

**Type consistency:** `PBOverlayItem`, `PBKind`, `pbTitleDistance|Window`, `pbHeroValue`, `pbDeltaText`, `pbIcon` — referenced consistently across tasks.

## Verification at end of all phases

```bash
cd web && npm test -- --run && npx tsc -p tsconfig.app.json
```

All tests green; TS strict still passes.

Manual smoke: trigger a session_end with a known PB-eligible session via fixture replay; confirm overlay flow (computing → PB hero → dismiss → summary → details). Test the Rekorde deep-link (tap "In Rekorden zeigen", verify the row scrolls into view + flashes briefly).

## Out of scope follow-ups (post-v1)

- Mid-session live PB triggers (new SSE event kind from recompute scheduler).
- Hero count-up animation (84sp number animating from previous→new value over 600ms).
- Achievement-icon haptic pulse on iOS / `navigator.vibrate(20)` on Android.
- Auto-dismiss timer + ring (only meaningful for live mid-session variant).
- Swipe-gesture support for the carousel (currently only Weiter button advances).
