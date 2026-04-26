import { NavLink, Outlet } from 'react-router-dom'
import styles from './HistoryPage.module.css'

export function HistoryPage() {
  return (
    <div className={styles.page}>
      <h1 className="headline-sm">Historie</h1>
      <nav className={styles.subnav} aria-label="Historie">
        <NavLink
          to="/historie"
          end
          className={({ isActive }) =>
            isActive ? `${styles.tab} ${styles.tabActive}` : styles.tab
          }
        >
          Sessions
        </NavLink>
        <NavLink
          to="/historie/trends"
          className={({ isActive }) =>
            isActive ? `${styles.tab} ${styles.tabActive}` : styles.tab
          }
        >
          Trends
        </NavLink>
        <NavLink
          to="/historie/rekorde"
          className={({ isActive }) =>
            isActive ? `${styles.tab} ${styles.tabActive}` : styles.tab
          }
        >
          Rekorde
        </NavLink>
      </nav>
      <Outlet />
    </div>
  )
}
