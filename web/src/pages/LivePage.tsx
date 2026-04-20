import { useLiveSession } from '../live/LiveSessionContext'
import { LiveHero } from './LiveHero'
import { TileGrid } from './TileGrid'
import styles from './LivePage.module.css'

export function LivePage() {
  const state = useLiveSession()
  return (
    <div className={styles.page}>
      <LiveHero state={state} />
      <TileGrid state={state} />
    </div>
  )
}
