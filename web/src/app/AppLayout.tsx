import { Outlet, useLocation } from 'react-router-dom'
import { AppIcon } from '../icons'
import { BottomNav } from './BottomNav'
import styles from './AppLayout.module.css'

function pageLabel(pathname: string): string {
  if (pathname === '/') return 'Training'
  if (pathname === '/live') return 'Live'
  if (pathname.startsWith('/workout')) return 'Workout'
  if (pathname.startsWith('/historie')) return 'Historie'
  if (pathname.startsWith('/profil')) return 'Profil'
  return ''
}

export function AppLayout() {
  const { pathname } = useLocation()
  const label = pageLabel(pathname)
  return (
    <div className={styles.shell}>
      <header className={styles.topBar}>
        <div className={styles.brand}>
          <AppIcon size={22} className={styles.brandIcon} />
          <h1 className={styles.brandText}>HOME-ERGO</h1>
        </div>
        {label && <span className={styles.pageLabel}>{label}</span>}
      </header>
      <main className={styles.main}>
        <Outlet />
      </main>
      <BottomNav />
    </div>
  )
}
