import type { Intensity, WorkoutMode, WorkoutParams } from './workouts'
import { ApiError } from './error'

export type Favorite = {
  id: string
  rower_id: string
  name: string
  mode: WorkoutMode
  params: WorkoutParams
  intensity?: Intensity
  warmup_sec: number
  cooldown_sec: number
  created_at: string
}

export type CreateFavoriteInput = {
  rower_id: string
  name: string
  mode: WorkoutMode
  params: WorkoutParams
  intensity?: Intensity
  warmup_sec?: number
  cooldown_sec?: number
}

export async function listFavorites(rowerID: string): Promise<Favorite[]> {
  const res = await fetch(`/api/v1/favorites?rower_id=${encodeURIComponent(rowerID)}`)
  if (!res.ok) throw new ApiError(res.status, `listFavorites: ${res.status}`)
  const body = (await res.json()) as { favorites?: Favorite[] }
  return body.favorites ?? []
}

export async function createFavorite(input: CreateFavoriteInput): Promise<Favorite> {
  const res = await fetch('/api/v1/favorites', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      ...input,
      warmup_sec: input.warmup_sec ?? 0,
      cooldown_sec: input.cooldown_sec ?? 0,
    }),
  })
  if (!res.ok) throw new ApiError(res.status, `createFavorite: ${res.status}`)
  return res.json()
}

export async function deleteFavorite(id: string): Promise<void> {
  const res = await fetch(`/api/v1/favorites/${encodeURIComponent(id)}`, { method: 'DELETE' })
  if (!res.ok) throw new ApiError(res.status, `deleteFavorite: ${res.status}`)
}
