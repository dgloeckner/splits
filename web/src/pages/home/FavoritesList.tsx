import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { startSession } from '../../api/client'
import { deleteFavorite, listFavorites, type Favorite } from '../../api/favorites'
import { createWorkout } from '../../api/workouts'
import { workoutIconFor } from '../../icons/workout'
import { handleStartFailure } from '../../offline/offlinePrompt'
import styles from './FavoritesList.module.css'

export type Props = { rowerID?: string; disabled?: boolean }

export function FavoritesList({ rowerID, disabled = false }: Props) {
  const nav = useNavigate()
  const qc = useQueryClient()
  const { data } = useQuery({
    queryKey: ['favorites', rowerID ?? ''],
    queryFn: () => listFavorites(rowerID as string),
    enabled: !!rowerID,
    staleTime: 15_000,
  })
  const del = useMutation({
    mutationFn: deleteFavorite,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['favorites', rowerID] }),
  })
  const favorites = data ?? []

  async function start(fav: Favorite) {
    let created
    try {
      created = await createWorkout({
        mode: fav.mode,
        params: fav.params,
        intensity: fav.intensity,
        warmup_sec: fav.warmup_sec,
        cooldown_sec: fav.cooldown_sec,
      })
    } catch (e) {
      handleStartFailure(e)
      return
    }
    try {
      await startSession(created.id)
    } catch (e) {
      handleStartFailure(e)
      return
    }
    nav('/live')
  }

  if (favorites.length === 0) return null

  return (
    <section
      data-testid="favorites-list"
      className={disabled ? `${styles.section} ${styles.sectionDimmed}` : styles.section}
    >
      <h2 className={styles.heading}>Favoriten</h2>
      <ul className={styles.list}>
        {favorites.map((fav) => {
          const Icon = workoutIconFor(fav.mode)
          return (
            <li key={fav.id} className={styles.item}>
              <button
                type="button"
                className={styles.itemBody}
                onClick={() => start(fav)}
                disabled={disabled}
              >
                <span className={styles.icon}>
                  <Icon size={24} />
                </span>
                <span className={styles.name}>{fav.name}</span>
                <span className={styles.summary}>{formatFavoriteSummary(fav)}</span>
              </button>
              <button
                type="button"
                aria-label="Favorit löschen"
                className={styles.delete}
                onClick={() => {
                  if (window.confirm('Favorit löschen?')) del.mutate(fav.id)
                }}
                disabled={disabled}
              >
                ✕
              </button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

function formatFavoriteSummary(fav: Favorite): string {
  let base = ''
  switch (fav.mode) {
    case 'distance': {
      const m = (fav.params as { meters: number }).meters
      const km = m / 1000
      base = `${Number.isInteger(km) ? km : km.toFixed(2).replace('.', ',')} km`
      break
    }
    case 'time': {
      const s = (fav.params as { seconds: number }).seconds
      base = `${Math.round(s / 60)} min`
      break
    }
    case 'intervals': {
      const p = fav.params as { reps: number; length: { unit: string; value: number }; rest_sec: number }
      const rest = p.rest_sec === 0 ? 'kein Pause' : `${Math.round(p.rest_sec / 60)} min Pause`
      base = `${p.reps}×${p.length.value}${p.length.unit} / ${rest}`
      break
    }
    default:
      base = 'Nur rudern'
  }
  return fav.intensity ? `${base} · ${fav.intensity}` : base
}
