import { useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { getRowerTrends, type TrendsRange, type TrendsResponse, type TrendsSeries } from '../../api/client'
import { useActiveRower } from '../../hooks/useActiveRower'
import { TrendsChart, type TrendsChartSeries } from '../../components/charts/TrendsChart'
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
        return <TrendsContent data={data} range={range} />
      })()}
    </div>
  )
}

const SERIES_THRESHOLD = 3

function TrendsContent({ data, range }: { data: TrendsResponse; range: TrendsRange }) {
  const perfSeries = data.series.filter((s) => s.points.length >= SERIES_THRESHOLD)
  const effSeries = data.efficiency_series.filter((s) => s.points.length >= SERIES_THRESHOLD)

  return (
    <>
      <TrendsHeadlineCard data={data} />

      <section className={styles.card} aria-label="Leistung">
        <header className={styles.cardHead}>
          <span className={styles.cardTitle}>Leistung</span>
        </header>
        <LeistungChart series={perfSeries} range={range} />
      </section>

      <section className={styles.card} aria-label="Effizienz">
        <header className={styles.cardHead}>
          <span className={styles.cardTitle}>Effizienz</span>
        </header>
        <EffizienzChart series={effSeries} range={range} />
      </section>
    </>
  )
}

function LeistungChart({ series, range }: { series: TrendsSeries[]; range: TrendsRange }) {
  const navigate = useNavigate()
  if (series.length === 0) {
    return (
      <p className={styles.placeholder} data-testid="leistung-empty">
        Noch keine Serie mit genug Sessions im Zeitraum.
      </p>
    )
  }
  const chartSeries: TrendsChartSeries[] = series.slice(0, 2).map((s, i) => ({
    key: s.key.shape_hash,
    label: s.display_name,
    tone: i === 0 ? 'primary' : 'neutral',
    variant: i === 0 ? 'solid' : 'dashed',
    fmt: (v) => pace500m(v) ?? '—',
    invertImprovement: true,
    points: s.points.map((p) => ({
      t: new Date(p.t).getTime(),
      y: p.avg_pace_sec_per_500m,
      sessionId: p.session_id,
    })),
  }))
  return (
    <TrendsChart
      series={chartSeries}
      range={range}
      rollingFor="primary-only"
      onDotTap={(id) => navigate(`/historie/${id}`)}
    />
  )
}

function EffizienzChart({ series, range }: { series: TrendsSeries[]; range: TrendsRange }) {
  const navigate = useNavigate()
  if (series.length === 0) {
    return (
      <p className={styles.placeholder} data-testid="effizienz-empty">
        Noch keine Serie mit genug Sessions im Zeitraum.
      </p>
    )
  }
  const s0 = series[0]
  const chartSeries: TrendsChartSeries[] = [
    {
      key: `${s0.key.shape_hash}-dps`,
      label: 'Ø DPS',
      tone: 'primary',
      variant: 'solid',
      fmt: (v) => fmtFloat(v, 1),
      points: s0.points.map((p) => ({
        t: new Date(p.t).getTime(),
        y: p.avg_dps,
        sessionId: p.session_id,
      })),
    },
    {
      key: `${s0.key.shape_hash}-spi`,
      label: 'Ø SPI',
      tone: 'neutral',
      variant: 'dashed',
      fmt: (v) => fmtFloat(v, 1),
      points: s0.points.map((p) => ({
        t: new Date(p.t).getTime(),
        y: p.avg_spi,
        sessionId: p.session_id,
      })),
    },
  ]
  return (
    <TrendsChart
      series={chartSeries}
      range={range}
      rollingFor="none"
      onDotTap={(id) => navigate(`/historie/${id}`)}
    />
  )
}
