import { useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useLiveSession } from '../live/LiveSessionContext'
import { useWorkoutProgress } from '../live/useWorkoutProgress'
import { LiveHero } from './LiveHero'
import { TileGrid } from './TileGrid'
import { useWorkoutOverlay } from './live/WorkoutOverlayContext'
import { WorkoutProgressStrip } from './live/WorkoutProgressStrip'
import { SegmentStatus } from './live/SegmentStatus'
import { useSegmentTransitions } from '../live/useSegmentTransitions'
import styles from './LivePage.module.css'

function LiveBody() {
  useSegmentTransitions()
  const state = useLiveSession()
  const { reset } = useWorkoutOverlay()
  const workoutId = state.session?.workout_id ?? null
  const prevWorkoutId = useRef<string | null>(workoutId)
  useEffect(() => {
    if (workoutId && workoutId !== prevWorkoutId.current) reset()
    prevWorkoutId.current = workoutId
  }, [workoutId, reset])
  const { active, segments, workout, isLoading } = useWorkoutProgress()
  const { aborted } = useWorkoutOverlay()
  const seg = active?.segment
  const workSeg = seg && seg.kind === 'work' ? seg : null
  const target = workSeg
    ? { split: workSeg.targetSplit, spm: workSeg.targetSPM }
    : null
  const debug = new URLSearchParams(window.location.search).get('debug') === '1'
  return (
    <div className={styles.page}>
      {debug && (
        <pre
          style={{
            background: '#222',
            color: '#0ff',
            padding: 8,
            fontSize: 11,
            margin: 0,
            whiteSpace: 'pre-wrap',
            gridColumn: '1 / -1',
          }}
          data-testid="live-debug"
        >
          {JSON.stringify(
            {
              sessionId: state.session?.session_id ?? null,
              workoutIdInSession: state.session?.workout_id ?? null,
              workoutLoaded: !!workout,
              workoutIntensity: workout?.intensity ?? null,
              isLoading,
              aborted,
              segmentCount: segments.length,
              activeKind: active?.segment.kind ?? null,
              workSegExists: !!workSeg,
              target,
            },
            null,
            2,
          )}
        </pre>
      )}
      {segments.length > 0 && (
        <div className={styles.topStrip}>
          <WorkoutProgressStrip />
          <SegmentStatus />
        </div>
      )}
      <div className={styles.leftCol}>
        <LiveHero state={state} target={target} />
      </div>
      <div className={styles.rightCol}>
        <TileGrid state={state} />
      </div>
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

  return <LiveBody />
}
