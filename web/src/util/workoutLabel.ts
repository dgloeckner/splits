import type { Workout } from '../api/workouts'

// Formats a workout into a short history-card chip label, e.g.
// "6.000 m", "20 Min", "8 × 500 m", "Nur Rudern".
export function workoutChipLabel(workout: Workout | null | undefined): string {
  if (!workout) return 'Nur Rudern'
  switch (workout.mode) {
    case 'just_row':
      return 'Nur Rudern'
    case 'distance': {
      const p = workout.params as { meters: number }
      return `${fmtMeters(p.meters)} m`
    }
    case 'time': {
      const p = workout.params as { seconds: number }
      const min = Math.round(p.seconds / 60)
      return `${min} Min`
    }
    case 'intervals': {
      const p = workout.params as {
        reps: number
        length: { unit: 'm' | 'min'; value: number }
      }
      const unit = p.length.unit === 'm' ? 'm' : 'Min'
      return `${p.reps} × ${p.length.value} ${unit}`
    }
    case 'race': {
      const p = workout.params as { meters: number }
      return `${fmtMeters(p.meters)} m Rennen`
    }
  }
}

function fmtMeters(m: number): string {
  return new Intl.NumberFormat('de-DE').format(m)
}
