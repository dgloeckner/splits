import { Outlet } from 'react-router-dom'
import { AppIcon } from '../icons'
import { BottomNav } from './BottomNav'
import { useLiveSession } from '../live/LiveSessionContext'
import { useActiveRower } from '../hooks/useActiveRower'
import styles from './AppLayout.module.css'

function UserAvatar({
  initial,
  color,
  connected,
}: {
  initial: string
  color?: string
  connected: boolean
}) {
  return (
    <div
      className={styles.avatar}
      aria-label="Profil"
      style={color ? { background: color } : undefined}
    >
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
  const activeRower = useActiveRower().data
  const initial = activeRower?.name?.slice(0, 1).toUpperCase() ?? '?'
  return (
    <div className={styles.shell}>
      <header className={styles.topBar}>
        <div className={styles.brand}>
          <AppIcon size={22} className={styles.brandIcon} />
          <h1 className={styles.brandText}>splits</h1>
        </div>
        <UserAvatar initial={initial} color={activeRower?.color} connected={connected} />
      </header>
      <main className={styles.main}>
        <Outlet />
      </main>
      <BottomNav />
    </div>
  )
}
