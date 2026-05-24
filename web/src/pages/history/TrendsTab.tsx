import { useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { getRowerTrends, type TrendsRange, type TrendsResponse, type TrendsSeries } from '../../api/client'
import { useActiveRower } from '../../hooks/useActiveRower'
import { DualLineChart, type Series } from '../../components/DualLineChart/DualLineChart'
import { fmtFloat, pace500m } from '../../util/format'
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

const SERIES_THRESHOLD = 3

function TrendsContent({ data }: { data: TrendsResponse }) {
  const perfSeries = data.series.filter((s) => s.points.length >= SERIES_THRESHOLD)
  const effSeries = data.efficiency_series.filter((s) => s.points.length >= SERIES_THRESHOLD)

  return (
    <>
      <TrendsHeadlineCard data={data} />

      <section className={styles.card} aria-label="Leistung">
        <header className={styles.cardHead}>
          <span className={styles.cardTitle}>Leistung</span>
        </header>
        <LeistungChart series={perfSeries} />
      </section>

      <section className={styles.card} aria-label="Effizienz">
        <header className={styles.cardHead}>
          <span className={styles.cardTitle}>Effizienz</span>
        </header>
        <EffizienzChart series={effSeries} />
      </section>
    </>
  )
}

function LeistungChart({ series }: { series: TrendsSeries[] }) {
  if (series.length === 0) {
    return (
      <p className={styles.placeholder} data-testid="leistung-empty">
        Noch keine Serie mit genug Sessions im Zeitraum.
      </p>
    )
  }
  // Primary = most-rowed series (API already sorts by point count desc).
  const primary: Series = {
    label: `${series[0].display_name} · Ø Split`,
    variant: 'solid',
    tone: 'primary',
    fmt: (v) => pace500m(v) ?? '—',
    points: series[0].points.map((p) => ({ x: tToX(p.t), y: p.avg_pace_sec_per_500m })),
  }
  const secondary: Series | undefined =
    series.length >= 2
      ? {
          label: `${series[1].display_name} · Ø Split`,
          variant: 'dashed',
          tone: 'neutral',
          fmt: (v) => pace500m(v) ?? '—',
          points: series[1].points.map((p) => ({ x: tToX(p.t), y: p.avg_pace_sec_per_500m })),
        }
      : undefined
  return (
    <>
      <div className={styles.legend}>
        {series.slice(0, 2).map((s, i) => {
          const last = s.points[s.points.length - 1]
          return (
            <div key={`${s.key.mode}|${s.key.shape_hash}`} className={styles.legendRow}>
              <span className={i === 1 ? `${styles.dot} ${styles.dotNeutral}` : styles.dot} />{' '}
              {s.display_name}: {pace500m(last.avg_pace_sec_per_500m) ?? '—'}
              {s.pb_pace_sec_per_500m ? (
                <>
                  {' '}
                  <small data-testid={`pb-${s.key.mode}-${s.key.shape_hash}`}>
                    PB {pace500m(s.pb_pace_sec_per_500m) ?? '—'}
                  </small>
                </>
              ) : null}
            </div>
          )
        })}
      </div>
      <DualLineChart primary={primary} secondary={secondary} />
    </>
  )
}

function EffizienzChart({ series }: { series: TrendsSeries[] }) {
  if (series.length === 0) {
    return (
      <p className={styles.placeholder} data-testid="effizienz-empty">
        Noch keine Serie mit genug Sessions im Zeitraum.
      </p>
    )
  }
  // Use the most-rowed series; DPS solid, SPI dashed.
  const s0 = series[0]
  const dps: Series = {
    label: `${s0.display_name} · Ø DPS`,
    variant: 'solid',
    tone: 'primary',
    fmt: (v) => fmtFloat(v, 1),
    points: s0.points.map((p) => ({ x: tToX(p.t), y: p.avg_dps })),
  }
  const spi: Series = {
    label: `${s0.display_name} · Ø SPI`,
    variant: 'dashed',
    tone: 'neutral',
    fmt: (v) => fmtFloat(v, 1),
    points: s0.points.map((p) => ({ x: tToX(p.t), y: p.avg_spi })),
  }
  const last = s0.points[s0.points.length - 1]
  return (
    <>
      <div className={styles.legend}>
        <div className={styles.legendRow}>
          <span className={styles.dot} /> Ø DPS: {fmtFloat(last.avg_dps, 1)}
        </div>
        <div className={styles.legendRow}>
          <span className={`${styles.dot} ${styles.dotNeutral}`} /> Ø SPI:{' '}
          {fmtFloat(last.avg_spi, 1)}
        </div>
      </div>
      <DualLineChart primary={dps} secondary={spi} />
    </>
  )
}

function tToX(iso: string): number {
  const d = new Date(iso)
  const t = d.getTime()
  return Number.isFinite(t) ? t : 0
}
