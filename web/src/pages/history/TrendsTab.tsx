import { useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { getRowerTrends, type TrendsRange, type TrendsResponse } from '../../api/client'
import { useActiveRower } from '../../hooks/useActiveRower'
import { DualLineChart, type Series } from '../../components/DualLineChart/DualLineChart'
import { fmtFloat, fmtInt, pace500m, signedNum } from '../../util/format'
import { RangeTabs } from './RangeTabs'
import { TrendsHeadlineCard } from './TrendsHeadlineCard'
import styles from './TrendsTab.module.css'

const VALID: TrendsRange[] = ['week', 'month', 'year', 'all']

// F9: widening ladder used by the empty-state escape hatch.
const RANGE_LABEL: Record<TrendsRange, string> = {
  week: 'Woche',
  month: 'Monat',
  year: 'Jahr',
  all: 'Alles',
}
function nextWiderRange(r: TrendsRange): TrendsRange | null {
  switch (r) {
    case 'week':
      return 'month'
    case 'month':
      return 'year'
    case 'year':
      return 'all'
    case 'all':
      return null
  }
}

function parseRange(s: string | null): TrendsRange {
  if (s && (VALID as string[]).includes(s)) return s as TrendsRange
  return 'month'
}

export function TrendsTab() {
  const { data: rower } = useActiveRower()
  const [params, setParams] = useSearchParams()
  const range = parseRange(params.get('range'))
  const setRange = (r: TrendsRange) => {
    const next = new URLSearchParams(params)
    next.set('range', r)
    setParams(next, { replace: true })
  }

  const rowerId = rower?.id ?? ''
  const { data, isPending, error } = useQuery<TrendsResponse>({
    queryKey: ['rower-trends', rowerId, range],
    queryFn: () => getRowerTrends(rowerId, range),
    enabled: !!rowerId,
  })

  return (
    <div className={styles.wrap}>
      <RangeTabs value={range} onChange={setRange} />
      {isPending && <p className={styles.placeholder}>Lädt …</p>}
      {error && <p className={styles.placeholder}>Konnte Trends nicht laden.</p>}
      {data && (() => {
        // Render charts when EITHER the headline period has sessions
        // OR the wider chart window does. Month/week range tend to
        // hit the empty branch when the user rowed in earlier weeks
        // but not the current one — the bars still carry useful
        // history, so don't hide them.
        const hasChartData =
          data.performance.points.length > 0 || data.efficiency.points.length > 0
        if (data.totals.sessions === 0 && !hasChartData) {
          // F9: empty state gives the user a way out. The current
          // range hit zero; the next wider range may have data — and
          // for a user whose sessions are 30+ days old, that's the
          // actually useful affordance to surface.
          const wider = nextWiderRange(range)
          return (
            <div className={styles.empty} data-testid="trends-empty">
              <p className={styles.placeholder}>Noch keine Sessions im Zeitraum.</p>
              {wider && (
                <button
                  type="button"
                  className={styles.widenBtn}
                  onClick={() => setRange(wider)}
                  data-testid="trends-widen"
                >
                  Zeitraum erweitern → {RANGE_LABEL[wider]}
                </button>
              )}
            </div>
          )
        }
        return <TrendsContent data={data} />
      })()}
    </div>
  )
}

function TrendsContent({ data }: { data: TrendsResponse }) {
  const perfPower: Series = {
    label: 'Ø Watt',
    variant: 'solid',
    tone: 'primary',
    fmt: (v) => `${fmtInt(Math.round(v))} W`,
    points: data.performance.points.map((p) => ({ x: tToX(p.t), y: p.avg_power_w })),
  }
  const perfPace: Series = {
    label: 'Ø Split',
    variant: 'dashed',
    tone: 'neutral',
    fmt: (v) => pace500m(v) ?? '—',
    points: data.performance.points.map((p) => ({ x: tToX(p.t), y: p.avg_pace_sec_per_500m })),
  }
  const effDPS: Series = {
    label: 'Ø DPS',
    variant: 'solid',
    tone: 'primary',
    fmt: (v) => fmtFloat(v, 1),
    points: data.efficiency.points.map((p) => ({ x: tToX(p.t), y: p.avg_dps })),
  }
  const effSPI: Series = {
    label: 'Ø SPI',
    variant: 'dashed',
    tone: 'neutral',
    fmt: (v) => fmtFloat(v, 1),
    points: data.efficiency.points.map((p) => ({ x: tToX(p.t), y: p.avg_spi })),
  }

  return (
    <>
      <TrendsHeadlineCard data={data} />

      <section className={styles.card} aria-label="Leistung">
        <header className={styles.cardHead}>
          <span className={styles.cardTitle}>Leistung</span>
        </header>
        <div className={styles.legend}>
          <div className={styles.legendRow}>
            <span className={styles.dot} /> Ø Watt: {fmtInt(Math.round(data.performance.avg_power_w))}
          </div>
          <div className={styles.legendRow}>
            <span className={`${styles.dot} ${styles.dotNeutral}`} /> Ø Split:{' '}
            {pace500m(data.performance.avg_pace_sec_per_500m || null)} /500m
          </div>
        </div>
        <DualLineChart primary={perfPower} secondary={perfPace} />
      </section>

      <section className={styles.card} aria-label="Effizienz">
        <header className={styles.cardHead}>
          <span className={styles.cardTitle}>Effizienz</span>
        </header>
        <div className={styles.legend}>
          <div className={styles.legendRow}>
            <span className={styles.dot} /> Ø DPS: {fmtFloat(data.efficiency.avg_dps, 1)}{' '}
            <small data-testid="dps-delta">{signedNum(data.efficiency.delta_dps, 1)}</small>
          </div>
          <div className={styles.legendRow}>
            <span className={`${styles.dot} ${styles.dotNeutral}`} /> Ø SPI:{' '}
            {fmtFloat(data.efficiency.avg_spi, 1)}{' '}
            <small data-testid="spi-delta">{signedNum(data.efficiency.delta_spi, 1)}</small>
          </div>
        </div>
        <DualLineChart primary={effDPS} secondary={effSPI} />
      </section>
    </>
  )
}

function tToX(iso: string): number {
  const d = new Date(iso)
  const t = d.getTime()
  return Number.isFinite(t) ? t : 0
}
