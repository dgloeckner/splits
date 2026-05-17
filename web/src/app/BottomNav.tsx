import { NavLink } from 'react-router-dom'
import { IconWorkout, IconHistory, IconProfile } from '../icons'
import { useLiveSession } from '../live/LiveSessionContext'
import { useWorkoutOverlay } from '../pages/live/WorkoutOverlayContext'
import styles from './BottomNav.module.css'

export function BottomNav() {
  const state = useLiveSession()
  const { aborted } = useWorkoutOverlay()
  const workoutActive = !!state.session?.workout_id && !aborted && state.summary === null

  const lockedProps = workoutActive
    ? {
        'aria-disabled': true,
        tabIndex: -1,
        onClick: (e: React.MouseEvent) => e.preventDefault(),
        'data-locked': 'true',
      }
    : {}

  return (
    <nav className={styles.nav} aria-label="Hauptnavigation">
      <NavLink to="/" end className={styles.link} data-testid="bottom-nav-workout" {...lockedProps}>
        <IconWorkout />
        <span>Workout</span>
      </NavLink>
      <NavLink to="/historie" className={styles.link} data-testid="bottom-nav-historie" {...lockedProps}>
        <IconHistory />
        <span>Historie</span>
      </NavLink>
      <NavLink to="/profil" className={styles.link} data-testid="bottom-nav-profil" {...lockedProps}>
        <IconProfile />
        <span>Profil</span>
      </NavLink>
    </nav>
  )
}
