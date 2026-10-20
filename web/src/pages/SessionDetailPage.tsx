import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  deleteSession,
  getSamples,
  getSession,
  getSessionPBBanners,
  windowTimeRange,
  type SessionPBBanners,
  type SessionRow,
  type SessionSamples,
} from '../api/client'
import { getWorkout, type Workout } from '../api/workouts'
import { workoutChipLabel } from '../util/workoutLabel'
import { SessionChart } from '../components/charts/SessionChart'
import { formatMetric, formatTick } from '../components/charts/format'
import { decimalComma, fmtInt, fmtMeters, mmss, mmssWhole } from '../util/format'
import { formatSessionStart } from '../util/dates'
import { DeleteSessionDialog } from './history/DeleteSessionDialog'
import { showToast } from '../app/toastBus'
import { InsightsSection } from './session/InsightsSection'
import { ErgoStandNotice } from '../offline/ErgoStandNotice'
import { useErgoStatus } from '../offline/ergoStatus'
import { ApiError } from '../api/error'
import styles from './SessionDetailPage.module.css'

export function SessionDetailPage() {
  const { sessionId = '' } = useParams()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { reachable } = useErgoStatus()

  const sessionQ = useQuery<SessionRow>({
    queryKey: ['sessions', sessionId],
    queryFn: () => getSession(sessionId),
    enabled: sessionId !== '',
  })
  const samplesQ = useQuery<SessionSamples>({
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
  if (!sessionQ.data) {
    // A 404 means the session is really gone. Anything else (network
    // failure, 5xx) must not masquerade as "nicht gefunden" — see
    // bugs/IMG_3271.PNG where an existing session rendered as missing
    // because the ergo was unreachable.
    const notFound = sessionQ.error instanceof ApiError && sessionQ.error.status === 404
    return (
      <div className={styles.page}>
        <Link to="/historie" className={styles.back}>
          ← Zurück
        </Link>
        <ErgoStandNotice variant="banner" />
        {notFound ? (
          <p>Session nicht gefunden.</p>
        ) : reachable === false ? (
          // Away from home and in neither the bag nor the SW cache: a
          // session outside the pack — explain, no dead end (issue #9).
          <p data-testid="session-not-packed">
            Nicht im Rucksack — zuhause öffnet sich die Session wieder.
          </p>
        ) : (
          <>
            <p>Session konnte nicht geladen werden — Ergo nicht erreichbar?</p>
            <button
              type="button"
              className={styles.retryBtn}
              onClick={() => sessionQ.refetch()}
            >
              Erneut versuchen
            </button>
          </>
        )}
      </div>
    )
  }

  const s = sessionQ.data
  const samples = samplesQ.data?.samples ?? []
  const focus = samplesQ.data ? windowTimeRange(samplesQ.data) : null

  const splitPts = samples.map((x) => ({ x: x.time_sec, y: x.pace_sec_per_500m })).filter((p) => p.y > 0)
  const wattPts = samples.map((x) => ({ x: x.time_sec, y: x.power_w }))
  const spmPts = samples.map((x) => ({ x: x.time_sec, y: x.spm }))
  const dpsPts = samples.map((x) => ({ x: x.time_sec, y: x.dps })).filter((p) => p.y > 0)

  return (
    <div className={styles.page}>
      <Link to="/historie" className={styles.back}>
        ← Zurück
      </Link>
      <ErgoStandNotice variant="banner" />

      {(() => {
        const b = bannersQ.data
        const dist = b?.distance ?? []
        const win = b?.window ?? []
        if (dist.length === 0 && win.length === 0) return null
        return (
          <div className={styles.bannersStrip} data-testid="session-pb-banners">
            {dist.map((d) => (
              <span key={`d-${d.distance_m}`} className={styles.banner}>
                🏆 Neue Bestzeit · {decimalComma(String(d.distance_m / 1000))} km · {mmssWhole(d.time_sec)}
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
          {decimalComma(workoutChipLabel(workoutQ.data ?? null))}
        </h1>
        <span className={`label-sm ${styles.dateSub}`}>{formatSessionStart(s.started_at)}</span>
      </header>

      <section className={styles.hero}>
        <div className={styles.heroMain}>
          <span className={styles.heroValue} data-testid="detail-total-distance">
            {fmtMeters(s.total_distance_m ?? null)} m
          </span>
          <span className={styles.heroValue} data-testid="detail-total-time">
            {decimalComma(mmss(s.total_time_sec ?? null))}
          </span>
        </div>
        <div className={styles.heroSecondary}>
          <div className={styles.heroSecondaryRow}>
            <span className={`label-sm ${styles.heroSecondaryKey}`}>Ø Split</span>
            <span className={styles.heroSecondaryValue} data-testid="detail-avg-split">
              {formatMetric.split(s.summary?.avg_pace_sec_per_500m)}
            </span>
          </div>
          <div className={styles.heroSecondaryRow}>
            <span className={`label-sm ${styles.heroSecondaryKey}`}>Ø SPM</span>
            <span className={styles.heroSecondaryValue} data-testid="detail-avg-spm">
              {formatMetric.spm(s.summary?.avg_spm)}
            </span>
          </div>
          <div className={styles.heroSecondaryRow}>
            <span className={`label-sm ${styles.heroSecondaryKey}`}>Ø Watt</span>
            <span className={styles.heroSecondaryValue} data-testid="detail-avg-watt">
              {formatMetric.watt(s.summary?.avg_power_w)}
            </span>
          </div>
          <div className={styles.heroSecondaryRow}>
            <span className={`label-sm ${styles.heroSecondaryKey}`}>Ø DPS</span>
            <span className={styles.heroSecondaryValue} data-testid="detail-avg-dps">
              {formatMetric.dps(s.summary?.avg_dps)}
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

      <InsightsSection sessionId={sessionId} samples={samplesQ.data} />

      <div className={styles.charts}>
        <SessionChart title="Split-Verlauf (s / 500 m)" points={splitPts} metric="split"
          fmt={formatTick.split} avgValue={s.summary?.avg_pace_sec_per_500m ?? null} focus={focus} />
        <SessionChart title="Watt-Verlauf" points={wattPts} metric="watt"
          fmt={formatTick.watt} avgValue={s.summary?.avg_power_w ?? null} focus={focus} />
        <SessionChart title="SPM-Verlauf" points={spmPts} metric="spm"
          fmt={formatTick.spm} avgValue={s.summary?.avg_spm ?? null} focus={focus} />
        <SessionChart title="DPS-Verlauf (m / Schlag)" points={dpsPts} metric="dps"
          fmt={formatTick.dps} avgValue={s.summary?.avg_dps ?? null} focus={focus} />
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
  if (metric === 'power') return `Power ${window}`
  return `${metric} ${window}`
}
