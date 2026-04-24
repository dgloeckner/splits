import { Outlet } from 'react-router-dom'
import { AppIcon } from '../icons'
import { BottomNav } from './BottomNav'
import { RowerStrip } from './RowerStrip'
import styles from './AppLayout.module.css'

export function AppLayout() {
  return (
    <div className={styles.shell}>
      <header className={styles.topBar}>
        <div className={styles.brand}>
          <AppIcon size={24} className={styles.brandIcon} />
          <span className={styles.brandText}>home-ergo</span>
        </div>
        <RowerStrip />
      </header>
      <main className={styles.main}>
        <Outlet />
      </main>
      <BottomNav />
    </div>
  )
}
