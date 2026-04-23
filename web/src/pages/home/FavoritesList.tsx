import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { deleteFavorite, listFavorites, type Favorite } from '../../api/favorites'
import { attachWorkout, createWorkout } from '../../api/workouts'
import styles from './FavoritesList.module.css'

export type Props = { rowerID: string }

export function FavoritesList({ rowerID }: Props) {
  const nav = useNavigate()
  const qc = useQueryClient()
  const { data } = useQuery({
    queryKey: ['favorites', rowerID],
    queryFn: () => listFavorites(rowerID),
    staleTime: 15_000,
  })
  const del = useMutation({
    mutationFn: deleteFavorite,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['favorites', rowerID] }),
  })

  if (!data || data.length === 0) return null

  async function start(fav: Favorite) {
    const created = await createWorkout({
      mode: fav.mode,
      params: fav.params,
      intensity: fav.intensity,
      warmup_sec: fav.warmup_sec,
      cooldown_sec: fav.cooldown_sec,
    })
    await attachWorkout(created.id)
    nav('/live')
  }

  return (
    <section data-testid="favorites-list" className={styles.section}>
      <h2 className={styles.heading}>Favoriten</h2>
      <ul className={styles.list}>
        {data.map((fav) => (
          <li key={fav.id} className={styles.item}>
            <button
              type="button"
              className={styles.itemBody}
              onClick={() => start(fav)}
            >
              <span className={styles.name}>{fav.name}</span>
              <span className={styles.summary}>{formatFavoriteSummary(fav)}</span>
            </button>
            <button
              type="button"
              aria-label={`Favorit löschen`}
              className={styles.delete}
              onClick={() => {
                if (window.confirm('Favorit löschen?')) del.mutate(fav.id)
              }}
            >
              ✕
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}

export function formatFavoriteSummary(fav: Favorite): string {
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
