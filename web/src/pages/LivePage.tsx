import { useEffect, useRef, useState } from 'react'
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
import { usePBBanners } from './live/usePBBanners'
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

  // Latch the just-ended summary locally so a subsequent
  // `session_start` from the SSE stream (e.g. someone keeps rowing
  // and the sessionizer opens the next session) does not dismiss the
  // overlay before the user has acknowledged it. Only latch on the
  // null → summary transition; remounting LivePage when the reducer
  // still holds a stale summary from a previous, already-acknowledged
  // session must NOT re-show the overlay.
  const [latched, setLatched] = useState<{
    summary: NonNullable<typeof state.summary>
    sessionId: string | null
  } | null>(null)
  const prevSummaryRef = useRef(state.summary)

  const incomingSummary = state.summary
  const incomingSessionId = state.session?.session_id ?? null
  useEffect(() => {
    const prev = prevSummaryRef.current
    if (!prev && incomingSummary) {
      setLatched({ summary: incomingSummary, sessionId: incomingSessionId })
      qc.invalidateQueries({ queryKey: ['sessions'] })
    }
    prevSummaryRef.current = incomingSummary
  }, [incomingSummary, incomingSessionId, qc])

  // FEAT-0009 acceptance: closing the tab does NOT end the session.
  // The backend's idle / inactivity timeouts, the workout-complete
  // trigger, and the X (abort) in WorkoutProgressStrip are the only
  // session-end triggers; on revisit, the SSE stream re-attaches via
  // Last-Event-ID and Snapshot.

  const banners = usePBBanners(latched?.sessionId ?? null)
  const dismiss = () => setLatched(null)

  return (
    <>
      <LiveBody />
      {latched && (
        <SessionEndedOverlay
          summary={latched.summary}
          banners={banners}
          onAcknowledge={() => {
            dismiss()
            nav('/')
          }}
          onShowDetails={
            latched.sessionId
              ? () => {
                  const id = latched.sessionId
                  dismiss()
                  nav(`/historie/${id}`)
                }
              : undefined
          }
        />
      )}
    </>
  )
}
