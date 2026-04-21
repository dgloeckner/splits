import { Outlet } from 'react-router-dom'
import { BottomNav } from './BottomNav'
import { RowerStrip } from './RowerStrip'
import styles from './AppLayout.module.css'

export function AppLayout() {
  return (
    <div className={styles.shell}>
      <header className={styles.topBar}>
        <RowerStrip />
      </header>
      <main className={styles.main}>
        <Outlet />
      </main>
      <BottomNav />
    </div>
  )
}
