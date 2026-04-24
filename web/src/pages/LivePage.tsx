import { useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { useLiveSession } from '../live/LiveSessionContext'
import { useWorkoutProgress } from '../live/useWorkoutProgress'
import { LiveHero } from './LiveHero'
import { TileGrid } from './TileGrid'
import { useWorkoutOverlay } from './live/WorkoutOverlayContext'
import { WorkoutProgressStrip } from './live/WorkoutProgressStrip'
import { SegmentStatus } from './live/SegmentStatus'
import { SessionEndedOverlay } from './live/SessionEndedOverlay'
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
  const qc = useQueryClient()
  const sessionId = state.session?.session_id ?? null
  const sessionOpen = state.session !== null && state.summary === null

  useEffect(() => {
    if (state.summary) {
      qc.invalidateQueries({ queryKey: ['sessions'] })
    }
  }, [state.summary, qc])

  // Best-effort: when the user closes the tab while a session is still
  // open, ask the backend to close it now. sendBeacon survives unload.
  useEffect(() => {
    if (!sessionOpen) return
    const handler = () => {
      navigator.sendBeacon?.('/api/v1/session/end')
    }
    window.addEventListener('pagehide', handler)
    return () => window.removeEventListener('pagehide', handler)
  }, [sessionOpen])

  return (
    <>
      <LiveBody />
      {state.summary && (
        <SessionEndedOverlay
          summary={state.summary}
          onAcknowledge={() => nav('/')}
          onShowDetails={
            sessionId ? () => nav(`/historie/${sessionId}`) : undefined
          }
        />
      )}
    </>
  )
}
