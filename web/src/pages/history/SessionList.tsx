import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import type { TrendsPoint, TrendsResponse, TrendsWindowKey } from '../../api/client'
import { formatMonthChip } from '../../components/charts/format'
import { pace500m } from '../../util/format'
import { groupByMonth, monthGroupHeading, type MonthGroup } from './groupByMonth'
import { shapeChip } from './shapeChip'
import styles from './VerlaufTab.module.css'

const fmtTime = (sec: number) => {
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

// The list scrolls inside its own pane on the iPad layout and inside the
// app's <main> on the phone; headers stick to, and chips scroll, that one.
function scrollParent(el: HTMLElement | null): HTMLElement | null {
  for (let p = el; p; p = p.parentElement) {
    const oy = getComputedStyle(p).overflowY
    if (oy === 'auto' || oy === 'scroll') return p
  }
  return null
}

// Height of the sticky chip row the headers park below (0 on the iPad).
function chipsHeight(el: HTMLElement | null): number {
  const pane = el?.parentElement
  return pane ? parseFloat(getComputedStyle(pane).getPropertyValue('--month-chips-h')) || 0 : 0
}

export function SessionList({ data, window_, highlightId, labelByShape }: {
  data: TrendsResponse
  window_: TrendsWindowKey
  highlightId: string | null
  labelByShape: Map<string, string>
}) {
  const row = (q: TrendsPoint) => (
    // Every row stays navigable, also away from home: the packed
    // details live in the SW cache, which the in-memory bag cannot
    // see; a miss is explained on the detail page (issue #9).
    <Link key={q.session_id} to={`/historie/${q.session_id}`}
      data-testid={`verlauf-row-${q.session_id}`}
      className={q.session_id === highlightId ? `${styles.row} ${styles.rowActive}` : styles.row}>
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
    </Link>
  )

  // A 30-day window spans at most two months; headers would be noise.
  if (window_ === '30d') {
    const rows = [...data.points].sort((a, b) => (a.t < b.t ? 1 : -1))
    return (
      <section className={styles.list} aria-label="Sessions">
        {rows.map(row)}
      </section>
    )
  }
  return <GroupedList points={data.points} row={row} />
}

function GroupedList({ points, row }: { points: TrendsPoint[]; row: (q: TrendsPoint) => React.ReactNode }) {
  const groups = useMemo(() => groupByMonth(points), [points])
  const listRef = useRef<HTMLElement | null>(null)
  const [activeKey, setActiveKey] = useState<string | null>(null)
  const [lastMinH, setLastMinH] = useState(0)

  // The oldest month gets the pane's height, so a chip can bring even
  // that header to the top instead of stopping at the end of the list.
  useLayoutEffect(() => {
    const sp = scrollParent(listRef.current)
    if (!sp) return
    // The iPad pane is capped by max-height and may not be full yet.
    const cs = getComputedStyle(sp)
    const paneH = cs.maxHeight !== 'none' ? parseFloat(cs.maxHeight) : sp.clientHeight
    setLastMinH(paneH - parseFloat(cs.paddingBottom || '0') - chipsHeight(listRef.current))
  }, [groups])

  // The month whose group crosses the top band of the pane is current.
  useEffect(() => {
    const list = listRef.current
    if (!list || typeof IntersectionObserver === 'undefined') return
    const visible = new Set<string>()
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        const key = (e.target as HTMLElement).dataset.month ?? ''
        if (e.isIntersecting) visible.add(key)
        else visible.delete(key)
      }
      const current = groups.filter((g) => visible.has(g.key)).pop()
      if (current) setActiveKey(current.key)
    }, { root: scrollParent(list), rootMargin: `-${chipsHeight(list)}px 0px -85% 0px` })
    list.querySelectorAll<HTMLElement>('[data-month]').forEach((el) => io.observe(el))
    return () => io.disconnect()
  }, [groups])

  // Scroll only the list's own container: scrollIntoView would also
  // scroll <main> on the iPad and take the chip row out of view.
  const jump = (g: MonthGroup) => {
    setActiveKey(g.key)
    const header = document.getElementById(`month-${g.key}`)
    const sp = scrollParent(listRef.current)
    if (!header || !sp) return
    const top = header.getBoundingClientRect().top - sp.getBoundingClientRect().top - chipsHeight(listRef.current)
    sp.scrollBy?.({ top, behavior: 'smooth' })
  }
  const selected = activeKey ?? groups[0]?.key

  return (
    <div className={groups.length >= 2 ? `${styles.listPane} ${styles.withChips}` : styles.listPane}>
      {groups.length >= 2 && (
        <div className={styles.monthChips} role="tablist" aria-label="Monat">
          {groups.map((g) => (
            <button key={g.key} type="button" role="tab" aria-selected={g.key === selected}
              data-testid={`verlauf-month-chip-${g.key}`}
              className={g.key === selected ? `${styles.chip} ${styles.chipActive}` : styles.chip}
              onClick={() => jump(g)}>
              {formatMonthChip(g.t)}
            </button>
          ))}
        </div>
      )}
      <section className={styles.list} aria-label="Sessions" ref={listRef}>
        {groups.map((g, i) => (
          <div key={g.key} className={styles.monthGroup} data-month={g.key}
            style={i === groups.length - 1 && groups.length > 1 && lastMinH > 0 ? { minHeight: lastMinH } : undefined}>
            <h3 className={styles.monthHeader} id={`month-${g.key}`} data-testid={`verlauf-month-${g.key}`}>
              {monthGroupHeading(g)}
            </h3>
            {g.points.map(row)}
          </div>
        ))}
      </section>
    </div>
  )
}
