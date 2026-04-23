import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { listSessions, type SessionRow } from '../../api/client'
import { attachWorkout, createWorkout, getLastWorkout } from '../../api/workouts'
import styles from './LastTrainingCard.module.css'

export type Props = { rowerID: string }

export function LastTrainingCard({ rowerID }: Props) {
  const nav = useNavigate()
  const { data, isLoading } = useQuery({
    queryKey: ['sessions-for-home', rowerID],
    queryFn: () => listSessions(50, 0),
    staleTime: 15_000,
  })

  if (isLoading || !data) return null
  const session: SessionRow | undefined = data.find(
    (s) => s.rower_id === rowerID && (s.total_distance_m ?? 0) > 0,
  )
  if (!session) return null

  async function repeat() {
    const last = await getLastWorkout(rowerID)
    if (!last) { nav('/live'); return }
    const created = await createWorkout({
      mode: last.mode,
      params: last.params,
      intensity: last.intensity,
      warmup_sec: last.warmup_sec,
      cooldown_sec: last.cooldown_sec,
    })
    await attachWorkout(created.id)
    nav('/live')
  }

  const km = ((session.total_distance_m ?? 0) / 1000).toFixed(2).replace('.', ',')
  const mins = Math.round((session.total_time_sec ?? 0) / 60)
  const date = new Date(session.started_at).toLocaleDateString('de-DE')

  return (
    <article data-testid="last-training-card" className={styles.card}>
      <header className={styles.header}>
        <span className={styles.date}>{date}</span>
      </header>
      <div className={styles.metrics}>
        <span>{km} km</span>
        <span>{mins} min</span>
      </div>
      <div className={styles.sparkline} aria-hidden />
      <button type="button" className={styles.repeat} onClick={repeat}>Wiederholen</button>
    </article>
  )
}
