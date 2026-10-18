import { useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  getRowerTrends,
  type TrendsPoint,
  type TrendsResponse,
  type TrendsWindowKey,
} from '../../api/client'
import { useActiveRower } from '../../hooks/useActiveRower'
import { ProgressChart } from '../../components/charts/ProgressChart'
import type { ChartMetric } from '../../components/charts/ticks'
import { formatDurationHuman, pace500m, signedPct } from '../../util/format'
import { WindowTabs } from './WindowTabs'
import styles from './VerlaufTab.module.css'
import { useOfferPendingUpdate } from '../../offline/swUpdate'

const VALID: TrendsWindowKey[] = ['30d', '365d', 'all']
const ROLLING_DAYS: Record<TrendsWindowKey, number> = { '30d': 14, '365d': 30, all: 90 }
const WINDOW_LABEL: Record<TrendsWindowKey, string> = {
  '30d': 'Letzte 30 Tage', '365d': 'Letzte 365 Tage', all: 'Insgesamt',
}
const METRICS: { key: ChartMetric; label: string }[] = [
  { key: 'split', label: 'Split' },
  { key: 'watt', label: 'Watt' },
  { key: 'spm', label: 'SPM' },
  { key: 'dps', label: 'DPS' },
]
const MIN_SERIES_POINTS = 2

function parseWindow(s: string | null): TrendsWindowKey {
  if (s && (VALID as string[]).includes(s)) return s as TrendsWindowKey
  return '30d'
}

function legacyRange(range: string | null): string | null {
  if (range === 'week' || range === 'month') return '30d'
  if (range === 'year') return '365d'
  if (range === 'all') return 'all'
  return null
}

const metricValue: Record<
  ChartMetric,
  (p: { avg_pace_sec_per_500m: number; avg_power_w: number; avg_spm: number; avg_dps: number }) => number
> = {
  split: (p) => p.avg_pace_sec_per_500m,
  watt: (p) => p.avg_power_w,
  spm: (p) => p.avg_spm,
  dps: (p) => p.avg_dps,
}

const metricFmt: Record<ChartMetric, (v: number) => string> = {
  split: (v) => pace500m(v),
  watt: (v) => `${Math.round(v)}`,
  spm: (v) => v.toFixed(1),
  dps: (v) => v.toFixed(1),
}

export function VerlaufTab() {
  // ADR-0023 §5: a build deferred during a session is offered here.
  useOfferPendingUpdate()
  const { data: rower } = useActiveRower()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const window_ = parseWindow(params.get('window') ?? legacyRange(params.get('range')))
  const setWindow = (w: TrendsWindowKey) => {
    const next = new URLSearchParams(params)
    next.set('window', w)
    next.delete('range')
    setParams(next, { replace: true })
  }

  const rowerId = rower?.id ?? ''
  const { data, isPending, error } = useQuery<TrendsResponse>({
    queryKey: ['rower-trends', rowerId, window_],
    queryFn: () => getRowerTrends(rowerId, window_),
    enabled: !!rowerId,
  })

  const [metric, setMetric] = useState<ChartMetric>('split')
  const [selectedShape, setSelectedShape] = useState<string | null>(null)
  const [highlightId, setHighlightId] = useState<string | null>(null)

  return (
    <div className={styles.layout}>
      <div className={styles.leftPane}>
        <WindowTabs value={window_} onChange={setWindow} />
        {isPending && <p className={styles.placeholder}>Lädt …</p>}
        {error && !data && <p className={styles.placeholder}>Konnte Verlauf nicht laden.</p>}
        {data && data.points.length === 0 && <EmptyState window_={window_} onWiden={setWindow} />}
        {data && data.points.length > 0 && (
          <>
            <ProgressCard
              data={data} window_={window_} metric={metric} setMetric={setMetric}
              selectedShape={selectedShape} setSelectedShape={setSelectedShape}
              highlightId={highlightId} setHighlightId={setHighlightId}
              onOpen={(id) => navigate(`/historie/${id}`)}
            />
            <VolumeFootnote data={data} window_={window_} />
          </>
        )}
      </div>
      {data && data.points.length > 0 && (
        <SessionList data={data} highlightId={highlightId} />
      )}
    </div>
  )
}

function EmptyState({ window_, onWiden }: { window_: TrendsWindowKey; onWiden: (w: TrendsWindowKey) => void }) {
  const wider: TrendsWindowKey | null = window_ === '30d' ? '365d' : window_ === '365d' ? 'all' : null
  return (
    <div className={styles.empty} data-testid="verlauf-empty">
      <p className={styles.placeholder}>Noch keine Sessions im Zeitraum.</p>
      {wider && (
        <button type="button" className={styles.widenBtn} onClick={() => onWiden(wider)} data-testid="verlauf-widen">
          Zeitraum erweitern → {wider === '365d' ? 'Jahr' : 'Alles'}
        </button>
      )}
    </div>
  )
}

function ProgressCard(p: {
  data: TrendsResponse
  window_: TrendsWindowKey
  metric: ChartMetric
  setMetric: (m: ChartMetric) => void
  selectedShape: string | null
  setSelectedShape: (s: string | null) => void
  highlightId: string | null
  setHighlightId: (id: string | null) => void
  onOpen: (id: string) => void
}) {
  // Memoized together so `active` keeps its identity across renders and the
  // memos below only recompute when the data or the selection changes.
  const { eligible, shape, active } = useMemo(() => {
    const eligible = p.data.series.filter((s) => s.points.length >= MIN_SERIES_POINTS)
    const shape = p.selectedShape ?? eligible[0]?.key.shape_hash ?? null
    const active = eligible.find((s) => s.key.shape_hash === shape) ?? null
    return { eligible, shape, active }
  }, [p.data.series, p.selectedShape])

  const linePoints = useMemo(() =>
    (active?.points ?? []).map((q) => ({
      t: new Date(q.t).getTime(),
      y: metricValue[p.metric](q),
      sessionId: q.session_id,
    })), [active, p.metric])
  const lineIds = useMemo(() => new Set((active?.points ?? []).map((q) => q.session_id)), [active])
  const contextDots = useMemo(() =>
    p.data.points
      .filter((q) => !lineIds.has(q.session_id))
      .map((q) => ({ t: new Date(q.t).getTime(), y: metricValue[p.metric](q), sessionId: q.session_id }))
      .filter((q) => q.y > 0),
    [p.data.points, lineIds, p.metric])

  const pb = p.metric === 'split' && active?.pb_pace_sec_per_500m ? active.pb_pace_sec_per_500m : null

  return (
    <section className={styles.card} aria-label="Fortschritt">
      {eligible.length > 1 && (
        <div className={styles.chips} role="tablist" aria-label="Workout">
          {eligible.map((s) => (
            <button key={s.key.shape_hash} type="button" role="tab"
              aria-selected={s.key.shape_hash === shape}
              className={s.key.shape_hash === shape ? `${styles.chip} ${styles.chipActive}` : styles.chip}
              onClick={() => p.setSelectedShape(s.key.shape_hash)}>
              {s.display_name}
            </button>
          ))}
        </div>
      )}
      <ProgressChart
        linePoints={linePoints}
        contextDots={contextDots}
        metric={p.metric}
        fmt={metricFmt[p.metric]}
        windowFromMs={new Date(p.data.from).getTime()}
        windowToMs={new Date(p.data.to).getTime()}
        rollingWindowDays={ROLLING_DAYS[p.window_]}
        pbValue={pb}
        pbLabel={pb ? `PB ${pace500m(pb)}` : undefined}
        selectedSessionId={p.highlightId}
        onDotTap={p.onOpen}
        onScrubSession={p.setHighlightId}
      />
      <div className={styles.metricToggle} role="tablist" aria-label="Metrik">
        {METRICS.map((m) => (
          <button key={m.key} type="button" role="tab" aria-selected={p.metric === m.key}
            className={p.metric === m.key ? `${styles.chip} ${styles.chipActive}` : styles.chip}
            onClick={() => p.setMetric(m.key)}>
            {m.label}
          </button>
        ))}
      </div>
    </section>
  )
}

function SessionList({ data, highlightId }: { data: TrendsResponse; highlightId: string | null }) {
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
        // Every row stays navigable, also away from home: the packed
        // details live in the SW cache, which the in-memory bag cannot
        // see; a miss is explained on the detail page (issue #9).
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

function shapeChip(q: TrendsPoint, labels: Map<string | undefined, string>): string {
  const fromSeries = q.shape_hash ? labels.get(q.shape_hash) : undefined
  if (fromSeries) return fromSeries
  switch (q.mode) {
    case 'just_row': return 'Just Row'
    case 'intervals': return 'Intervalle'
    case 'time': return 'Zeit'
    case 'distance': return 'Distanz'
  }
  return q.mode || 'Just Row'
}

function VolumeFootnote({ data, window_ }: { data: TrendsResponse; window_: TrendsWindowKey }) {
  const km = (data.totals.distance_m / 1000).toLocaleString('de-DE', { maximumFractionDigits: 1 })
  const delta =
    data.prior && data.prior.distance_m > 0
      ? signedPct((data.totals.distance_m - data.prior.distance_m) / data.prior.distance_m)
      : null
  return (
    <p className={styles.footnote} data-testid="verlauf-footnote">
      {WINDOW_LABEL[window_]}: {km} km · {data.totals.sessions} Sessions · {formatDurationHuman(data.totals.active_sec)}
      {delta && <span className={styles.footnoteDelta}> · {delta} vs. Vorperiode</span>}
    </p>
  )
}
