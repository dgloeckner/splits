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
      {data && data.totals.sessions === 0 && (
        <p className={styles.placeholder} data-testid="trends-empty">
          Noch keine Sessions im Zeitraum.
        </p>
      )}
      {data && data.totals.sessions > 0 && <TrendsContent data={data} />}
    </div>
  )
}

function TrendsContent({ data }: { data: TrendsResponse }) {
  const perfPower: Series = {
    label: 'Ø Watt',
    variant: 'solid',
    tone: 'primary',
    points: data.performance.points.map((p) => ({ x: tToX(p.t), y: p.avg_power_w })),
  }
  const perfPace: Series = {
    label: 'Ø Split',
    variant: 'dashed',
    tone: 'neutral',
    points: data.performance.points.map((p) => ({ x: tToX(p.t), y: p.avg_pace_sec_per_500m })),
  }
  const effDPS: Series = {
    label: 'Ø DPS',
    variant: 'solid',
    tone: 'primary',
    points: data.efficiency.points.map((p) => ({ x: tToX(p.t), y: p.avg_dps })),
  }
  const effSPI: Series = {
    label: 'Ø SPI',
    variant: 'solid',
    tone: 'neutral',
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
          <span className={styles.tag}>14-Tage Trend</span>
        </header>
        <div className={styles.statRow}>
          <div className={styles.statCell}>
            <span className={styles.statLabel}>Ø DPS</span>
            <span className={styles.statValue}>
              {fmtFloat(data.efficiency.avg_dps, 1)}{' '}
              <small data-testid="dps-delta">{signedNum(data.efficiency.delta_dps, 1)}</small>
            </span>
          </div>
          <div className={styles.statCell}>
            <span className={styles.statLabel}>Ø SPI</span>
            <span className={styles.statValue}>
              {fmtFloat(data.efficiency.avg_spi, 1)}{' '}
              <small data-testid="spi-delta">{signedNum(data.efficiency.delta_spi, 1)}</small>
            </span>
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
