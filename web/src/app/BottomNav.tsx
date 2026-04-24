import { NavLink } from 'react-router-dom'
import { IconWorkout, IconHistory, IconProfile } from '../icons'
import styles from './BottomNav.module.css'

export function BottomNav() {
  return (
    <nav className={styles.nav} aria-label="Hauptnavigation">
      <NavLink to="/" end className={styles.link}>
        <IconWorkout />
        <span>Training</span>
      </NavLink>
      <NavLink to="/historie" className={styles.link}>
        <IconHistory />
        <span>Historie</span>
      </NavLink>
      <NavLink to="/profil" className={styles.link}>
        <IconProfile />
        <span>Profil</span>
      </NavLink>
    </nav>
  )
}
