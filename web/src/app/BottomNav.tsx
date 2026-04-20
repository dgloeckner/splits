import { NavLink } from 'react-router-dom'
import { IconHome, IconHistory, IconProfile } from '../icons'
import styles from './BottomNav.module.css'

export function BottomNav() {
  return (
    <nav className={styles.nav} aria-label="Hauptnavigation">
      <NavLink to="/" end className={styles.link}>
        <IconHome />
        <span>Live</span>
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
