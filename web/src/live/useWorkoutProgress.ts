import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { useLiveSession } from './LiveSessionContext'
import { getWorkout, type Workout } from '../api/workouts'
import { expandWorkout, locateSegment, type ActiveSegment, type Segment } from './segments'

export type WorkoutProgress = {
  segments: Segment[]
  active: ActiveSegment | null
  workoutId: string | null
  isLoading: boolean
  workout: Workout | null
}

export function useWorkoutProgress(): WorkoutProgress {
  const state = useLiveSession()
  const workoutId = state.session?.workout_id ?? null

  const q = useQuery({
    queryKey: ['workout', workoutId],
    queryFn: () => getWorkout(workoutId!),
    enabled: !!workoutId,
    staleTime: 60_000,
  })

  const segments = useMemo(() => (q.data ? expandWorkout(q.data) : []), [q.data])
  const active = useMemo(() => {
    if (!state.stroke || segments.length === 0) return null
    return locateSegment(segments, state.stroke.distance_m, state.stroke.time_sec)
  }, [state.stroke, segments])

  return { segments, active, workoutId, isLoading: q.isLoading, workout: q.data ?? null }
}
