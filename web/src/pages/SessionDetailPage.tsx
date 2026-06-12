import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  deleteSession,
  getSamples,
  getSession,
  getSessionPBBanners,
  type Sample,
  type SessionPBBanners,
  type SessionRow,
} from '../api/client'
import { getWorkout, type Workout } from '../api/workouts'
import { workoutChipLabel } from '../util/workoutLabel'
import { LineChart } from '../components/LineChart/LineChart'
import { fmtFloat, fmtInt, fmtMeters, mmss, mmssWhole, pace500m } from '../util/format'
import { formatSessionStart } from '../util/dates'
import { DeleteSessionDialog } from './history/DeleteSessionDialog'
import { showToast } from '../app/Toast'
import { InsightsSection } from './session/InsightsSection'
import styles from './SessionDetailPage.module.css'

export function SessionDetailPage() {
  const { sessionId = '' } = useParams()
  const navigate = useNavigate()
  const qc = useQueryClient()

  const sessionQ = useQuery<SessionRow>({
    queryKey: ['sessions', sessionId],
    queryFn: () => getSession(sessionId),
    enabled: sessionId !== '',
  })
  const samplesQ = useQuery<Sample[]>({
    queryKey: ['sessions', sessionId, 'samples'],
    queryFn: () => getSamples(sessionId),
    enabled: sessionId !== '',
  })
  const workoutQ = useQuery<Workout | null>({
    queryKey: ['workout', sessionQ.data?.workout_id ?? null],
    queryFn: () => (sessionQ.data?.workout_id ? getWorkout(sessionQ.data.workout_id) : Promise.resolve(null)),
    enabled: !!sessionQ.data?.workout_id,
    staleTime: 60_000,
  })
  const bannersQ = useQuery<SessionPBBanners>({
    queryKey: ['sessions', sessionId, 'pb-banners'],
    queryFn: () => getSessionPBBanners(sessionId),
    enabled: sessionId !== '',
  })
  const [confirmOpen, setConfirmOpen] = useState(false)
  const deleteM = useMutation({
    mutationFn: () => deleteSession(sessionId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sessions'] })
      navigate('/historie', { replace: true })
    },
    onError: () =>
      showToast('Löschen fehlgeschlagen — bitte erneut versuchen.', 'warn'),
  })

  if (sessionQ.isPending) {
    return <div className={styles.page}>Lädt …</div>
  }
  if (sessionQ.error || !sessionQ.data) {
    return (
      <div className={styles.page}>
        <Link to="/historie" className={styles.back}>
          ← Zurück
        </Link>
        <p>Session nicht gefunden.</p>
      </div>
    )
  }

  const s = sessionQ.data
  const samples = samplesQ.data ?? []

  const splitPts = samples.map((x) => ({ x: x.time_sec, y: x.pace_sec_per_500m })).filter((p) => p.y > 0)
  const wattPts = samples.map((x) => ({ x: x.time_sec, y: x.power_w }))
  const spmPts = samples.map((x) => ({ x: x.time_sec, y: x.spm }))

  return (
    <div className={styles.page}>
      <Link to="/historie" className={styles.back}>
        ← Zurück
      </Link>

      {(() => {
        const b = bannersQ.data
        const dist = b?.distance ?? []
        const win = b?.window ?? []
        if (dist.length === 0 && win.length === 0) return null
        return (
          <div className={styles.bannersStrip} data-testid="session-pb-banners">
            {dist.map((d) => (
              <span key={`d-${d.distance_m}`} className={styles.banner}>
                🏆 Neue Bestzeit · {d.distance_m / 1000} km · {mmssWhole(d.time_sec)}
              </span>
            ))}
            {win.map((w) => (
              <span key={`w-${w.metric}-${w.window_size}`} className={styles.banner}>
                🏆 Bestleistung · {bannerWindowLabel(w.metric, w.window_kind, w.window_size)}
              </span>
            ))}
          </div>
        )
      })()}

      <header className={styles.titleBlock}>
        <h1 className={styles.workoutTitle} data-testid="session-workout-title">
          {workoutChipLabel(workoutQ.data ?? null)}
        </h1>
        <span className={`label-sm ${styles.dateSub}`}>{formatSessionStart(s.started_at)}</span>
      </header>

      <section className={styles.hero}>
        <div className={styles.heroMain}>
          <span className={styles.heroValue} data-testid="detail-total-distance">
            {fmtMeters(s.total_distance_m ?? null)} m
          </span>
          <span className={styles.heroValue} data-testid="detail-total-time">
            {mmss(s.total_time_sec ?? null)}
          </span>
        </div>
        <div className={styles.heroSecondary}>
          <div className={styles.heroSecondaryRow}>
            <span className={`label-sm ${styles.heroSecondaryKey}`}>Ø Split</span>
            <span className={styles.heroSecondaryValue} data-testid="detail-avg-split">
              {pace500m(s.summary?.avg_pace_sec_per_500m ?? null)}
            </span>
          </div>
          <div className={styles.heroSecondaryRow}>
            <span className={`label-sm ${styles.heroSecondaryKey}`}>Ø SPM</span>
            <span className={styles.heroSecondaryValue} data-testid="detail-avg-spm">
              {fmtFloat(s.summary?.avg_spm ?? null, 1)}
            </span>
          </div>
          <div className={styles.heroSecondaryRow}>
            <span className={`label-sm ${styles.heroSecondaryKey}`}>Ø Watt</span>
            <span className={styles.heroSecondaryValue} data-testid="detail-avg-watt">
              {fmtInt(s.summary?.avg_power_w ?? null)}
            </span>
          </div>
          <div className={styles.heroSecondaryRow}>
            <span className={`label-sm ${styles.heroSecondaryKey}`}>Ø DPS</span>
            <span className={styles.heroSecondaryValue} data-testid="detail-avg-dps">
              {fmtFloat(s.summary?.avg_dps ?? null, 2)}
            </span>
          </div>
          <div className={styles.heroSecondaryRow}>
            <span className={`label-sm ${styles.heroSecondaryKey}`}>Schläge</span>
            <span className={styles.heroSecondaryValue} data-testid="detail-total-strokes">
              {fmtInt(s.total_strokes ?? null)}
            </span>
          </div>
        </div>
      </section>

      <InsightsSection sessionId={sessionId} />

      <div className={styles.charts}>
        <LineChart title="Split-Verlauf (s / 500 m)" points={splitPts} fmt={(v) => mmss(v)} />
        <LineChart title="Watt-Verlauf" points={wattPts} />
        <LineChart title="SPM-Verlauf" points={spmPts} />
      </div>

      <div className={styles.actions}>
        <button
          className={styles.deleteBtn}
          onClick={() => setConfirmOpen(true)}
          disabled={deleteM.isPending}
          data-testid="session-detail-delete"
        >
          Löschen
        </button>
      </div>

      <DeleteSessionDialog
        open={confirmOpen}
        session={s}
        busy={deleteM.isPending}
        onConfirm={() => deleteM.mutate()}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  )
}

function bannerWindowLabel(metric: string, kind: string, size: number): string {
  const window = kind === 'seconds' ? `${size} s` : `${size} Schläge`
  switch (metric) {
    case 'power':
      return `Power ${window}`
    case 'pace':
      return `Pace ${window}`
    case 'dps':
      return `DPS ${window}`
    case 'spi':
      return `SPI ${window}`
    default:
      return `${metric} ${window}`
  }
}
