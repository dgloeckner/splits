import { useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useLiveSession } from '../live/LiveSessionContext'
import { LiveHero } from './LiveHero'
import { TileGrid } from './TileGrid'
import styles from './LivePage.module.css'

export function LivePage() {
  const state = useLiveSession()
  const nav = useNavigate()
  const prevSummary = useRef(state.summary)

  useEffect(() => {
    if (!prevSummary.current && state.summary) {
      // Rising edge: session just ended.
      nav('/')
    }
    prevSummary.current = state.summary
  }, [state.summary, nav])

  return (
    <div className={styles.page}>
      <LiveHero state={state} />
      <TileGrid state={state} />
    </div>
  )
}
