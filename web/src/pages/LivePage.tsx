import { useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useLiveSession } from '../live/LiveSessionContext'
import { LiveHero } from './LiveHero'
import { TileGrid } from './TileGrid'
import { WorkoutOverlayProvider } from './live/WorkoutOverlayContext'
import { WorkoutProgressStrip } from './live/WorkoutProgressStrip'
import { SegmentStatus } from './live/SegmentStatus'
import { AbortWorkoutButton } from './live/AbortWorkoutButton'
import { useSegmentTransitions } from '../live/useSegmentTransitions'
import styles from './LivePage.module.css'

function LiveBody() {
  useSegmentTransitions()
  const state = useLiveSession()
  return (
    <div className={styles.page}>
      <WorkoutProgressStrip />
      <SegmentStatus />
      <AbortWorkoutButton />
      <LiveHero state={state} />
      <TileGrid state={state} />
    </div>
  )
}

export function LivePage() {
  const state = useLiveSession()
  const nav = useNavigate()
  const prevSummary = useRef(state.summary)

  useEffect(() => {
    if (!prevSummary.current && state.summary) nav('/')
    prevSummary.current = state.summary
  }, [state.summary, nav])

  return (
    <WorkoutOverlayProvider>
      <LiveBody />
    </WorkoutOverlayProvider>
  )
}
