import { ApiError } from './error'

export type WorkoutMode = 'just_row' | 'distance' | 'time' | 'intervals' | 'race'
export type Intensity = 'locker' | 'moderat' | 'hart' | 'allout'

export type JustRowParams = Record<string, never>
export type DistanceParams = { meters: number }
export type TimeParams = { seconds: number }
export type IntervalLength = { unit: 'm' | 'min'; value: number }
export type IntervalsParams = { reps: number; length: IntervalLength; rest_sec: number }
export type WorkoutParams = JustRowParams | DistanceParams | TimeParams | IntervalsParams

export type Workout = {
  id: string
  mode: WorkoutMode
  params: WorkoutParams
  intensity?: Intensity
  warmup_sec: number
  cooldown_sec: number
  created_at: string
}

export type CreateWorkoutInput = {
  mode: WorkoutMode
  params: WorkoutParams
  intensity?: Intensity
  warmup_sec?: number
  cooldown_sec?: number
}

export async function createWorkout(input: CreateWorkoutInput): Promise<Workout> {
  const res = await fetch('/api/v1/workouts', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      mode: input.mode,
      params: input.params,
      intensity: input.intensity,
      warmup_sec: input.warmup_sec ?? 0,
      cooldown_sec: input.cooldown_sec ?? 0,
    }),
  })
  if (!res.ok) throw new ApiError(res.status, `createWorkout: ${res.status}`)
  return res.json()
}

export async function attachWorkout(id: string): Promise<void> {
  const res = await fetch(`/api/v1/workouts/${encodeURIComponent(id)}/attach`, { method: 'POST' })
  if (!res.ok) throw new ApiError(res.status, `attachWorkout: ${res.status}`)
}

export async function getWorkout(id: string): Promise<Workout> {
  const res = await fetch(`/api/v1/workouts/${encodeURIComponent(id)}`)
  if (!res.ok) throw new ApiError(res.status, `getWorkout: ${res.status}`)
  return res.json()
}

export async function getLastWorkout(rowerID: string): Promise<Workout | null> {
  const res = await fetch(`/api/v1/workouts/last?rower_id=${encodeURIComponent(rowerID)}`)
  if (res.status === 404) return null
  if (!res.ok) throw new ApiError(res.status, `getLastWorkout: ${res.status}`)
  return res.json()
}
