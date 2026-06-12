import { NavLink, Outlet } from 'react-router-dom'
import { ErgoStandNotice } from '../offline/ErgoStandNotice'
import styles from './HistoryPage.module.css'

export function HistoryPage() {
  return (
    <div className={styles.page}>
      <h1 className="headline-sm">Historie</h1>
      <ErgoStandNotice variant="banner" />
      <nav className={styles.subnav} aria-label="Historie">
        <NavLink
          to="/historie"
          end
          className={({ isActive }) =>
            isActive ? `${styles.tab} ${styles.tabActive}` : styles.tab
          }
        >
          Verlauf
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
