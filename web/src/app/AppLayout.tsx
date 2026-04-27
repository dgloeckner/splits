import { Outlet } from 'react-router-dom'
import { AppIcon } from '../icons'
import { BottomNav } from './BottomNav'
import { useLiveSession } from '../live/LiveSessionContext'
import styles from './AppLayout.module.css'

function UserAvatar({ initial, connected }: { initial: string; connected: boolean }) {
  return (
    <div className={styles.avatar} aria-label="Profil">
      <span>{initial}</span>
      <span
        className={styles.statusDot}
        data-connected={connected ? 'true' : 'false'}
        aria-hidden
      />
    </div>
  )
}

export function AppLayout() {
  const state = useLiveSession()
  const connected = state.status === 'open'
  return (
    <div className={styles.shell}>
      <header className={styles.topBar}>
        <div className={styles.brand}>
          <AppIcon size={22} className={styles.brandIcon} />
          <h1 className={styles.brandText}>splits</h1>
        </div>
        <UserAvatar initial="D" connected={connected} />
      </header>
      <main className={styles.main}>
        <Outlet />
      </main>
      <BottomNav />
    </div>
  )
}
