import { useLiveSession } from '../live/LiveSessionContext'
import { LiveHero } from './LiveHero'
import styles from './LivePage.module.css'

export function LivePage() {
  const state = useLiveSession()
  return (
    <div className={styles.page}>
      <LiveHero state={state} />
      <div className={styles.gridPlaceholder} aria-label="Tile-Grid kommt in Task 18" />
    </div>
  )
}
