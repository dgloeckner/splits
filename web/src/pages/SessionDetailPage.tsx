import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { deleteSession, getSamples, getSession, type Sample, type SessionRow } from '../api/client'
import { LineChart } from '../components/LineChart/LineChart'
import { fmtFloat, fmtInt, fmtMeters, mmss, pace500m } from '../util/format'
import { formatSessionStart } from '../util/dates'
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
  const deleteM = useMutation({
    mutationFn: () => deleteSession(sessionId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sessions'] })
      navigate('/historie', { replace: true })
    },
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

      <section className={styles.hero}>
        <div className={styles.heroMain}>
          <span className={`label-sm ${styles.heroLabel}`}>{formatSessionStart(s.started_at)}</span>
          <span className={styles.heroValue}>{fmtMeters(s.total_distance_m ?? null)} m</span>
          <span className={styles.heroValue}>{mmss(s.total_time_sec ?? null)}</span>
        </div>
        <div className={styles.heroSecondary}>
          <div className={styles.heroSecondaryRow}>
            <span className={`label-sm ${styles.heroSecondaryKey}`}>Ø Split</span>
            <span className={styles.heroSecondaryValue}>
              {pace500m(s.summary?.avg_pace_sec_per_500m ?? null)}
            </span>
          </div>
          <div className={styles.heroSecondaryRow}>
            <span className={`label-sm ${styles.heroSecondaryKey}`}>Ø SPM</span>
            <span className={styles.heroSecondaryValue}>
              {fmtFloat(s.summary?.avg_spm ?? null, 1)}
            </span>
          </div>
          <div className={styles.heroSecondaryRow}>
            <span className={`label-sm ${styles.heroSecondaryKey}`}>Ø Watt</span>
            <span className={styles.heroSecondaryValue}>{fmtInt(s.summary?.avg_power_w ?? null)}</span>
          </div>
          <div className={styles.heroSecondaryRow}>
            <span className={`label-sm ${styles.heroSecondaryKey}`}>Schläge</span>
            <span className={styles.heroSecondaryValue}>{fmtInt(s.total_strokes ?? null)}</span>
          </div>
        </div>
      </section>

      <div className={styles.charts}>
        <LineChart title="Split-Verlauf (s / 500 m)" points={splitPts} fmt={(v) => mmss(v)} />
        <LineChart title="Watt-Verlauf" points={wattPts} />
        <LineChart title="SPM-Verlauf" points={spmPts} />
      </div>

      <div className={styles.actions}>
        <button
          className={styles.deleteBtn}
          onClick={() => {
            if (confirm('Diese Session löschen?')) deleteM.mutate()
          }}
          disabled={deleteM.isPending}
        >
          Löschen
        </button>
      </div>
    </div>
  )
}
