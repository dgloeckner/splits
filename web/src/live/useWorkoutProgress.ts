import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { useLiveSession } from './LiveSessionContext'
import { getWorkout, type Workout } from '../api/workouts'
import { expandWorkout, locateSegment, type ActiveSegment, type Segment } from './segments'
import { useWorkoutOverlay } from '../pages/live/WorkoutOverlayContext'

export type WorkoutProgress = {
  segments: Segment[]
  active: ActiveSegment | null
  workoutId: string | null
  isLoading: boolean
  workout: Workout | null
  /** Wall-clock ms at which the latest `active.remainingSec` was
   *  computed. Consumers that render a live countdown can extrapolate
   *  the displayed value with `(Date.now() - anchor) / 1000` between
   *  strokes so the timer ticks continuously rather than only on
   *  stroke arrivals. Null when no stroke has arrived yet. */
  remainingAnchorMs: number | null
}

export function useWorkoutProgress(): WorkoutProgress {
  const state = useLiveSession()
  const workoutId = state.session?.workout_id ?? null
  const { aborted } = useWorkoutOverlay()

  const q = useQuery({
    queryKey: ['workout', workoutId],
    queryFn: () => getWorkout(workoutId!),
    enabled: !!workoutId,
    staleTime: 60_000,
  })

  const segments = useMemo(() => (q.data ? expandWorkout(q.data) : []), [q.data])
  const active = useMemo(() => {
    if (!state.stroke || segments.length === 0) return null
    return locateSegment(
      segments,
      state.stroke.distance_m,
      state.stroke.time_sec,
      state.workStartDistanceM,
    )
  }, [state.stroke, segments, state.workStartDistanceM])

  if (aborted) {
    return { segments: [], active: null, workoutId: null, isLoading: false, workout: null, remainingAnchorMs: null }
  }

  return {
    segments,
    active,
    workoutId,
    isLoading: q.isLoading,
    workout: q.data ?? null,
    remainingAnchorMs: state.lastStrokeReceivedAtMs,
  }
}
