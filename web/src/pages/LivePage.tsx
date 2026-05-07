import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { getWorkout } from '../api/workouts'
import { workoutChipLabel } from '../util/workoutLabel'
import { useLiveSession } from '../live/LiveSessionContext'
import { ConnectionBanner } from '../live/ConnectionBanner'
import { useWorkoutProgress } from '../live/useWorkoutProgress'
import { LiveHero } from './LiveHero'
import { TileGrid } from './TileGrid'
import { RaceLiveView } from '../race/RaceLiveView'
import { useWorkoutOverlay } from './live/WorkoutOverlayContext'
import { WorkoutProgressStrip } from './live/WorkoutProgressStrip'
import { SegmentStatus } from './live/SegmentStatus'
import { SessionEndedOverlay } from './live/SessionEndedOverlay'
import { PauseDialog } from './live/PauseDialog'
import { useSegmentTransitions } from '../live/useSegmentTransitions'
import { usePBBanners } from './live/usePBBanners'
import { PBOverlay } from './live/PBOverlay'
import { useActiveRower } from '../hooks/useActiveRower'
import styles from './LivePage.module.css'

function LiveBody() {
  useSegmentTransitions()
  const state = useLiveSession()
  const { active, segments, workout, isLoading } = useWorkoutProgress()
  const { aborted } = useWorkoutOverlay()
  const seg = active?.segment
  const workSeg = seg && seg.kind === 'work' ? seg : null
  const target = workSeg
    ? { split: workSeg.targetSplit, spm: workSeg.targetSPM }
    : null
  const debug = new URLSearchParams(window.location.search).get('debug') === '1'
  const isRace = workout?.mode === 'race'
  if (isRace) {
    const meters = (workout.params as { meters: number }).meters
    return (
      <div className={styles.page}>
        <RaceLiveView liveState={state} totalMeters={meters} />
      </div>
    )
  }
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
  type Latched = {
    summary: NonNullable<typeof state.summary>
    sessionId: string | null
    workoutId: string | null
  }
  const STORAGE_KEY = 'ruderergo:latched-summary'
  const [latched, setLatched] = useState<Latched | null>(() => {
    if (typeof window === 'undefined') return null
    try {
      const raw = window.sessionStorage.getItem(STORAGE_KEY)
      return raw ? (JSON.parse(raw) as Latched) : null
    } catch {
      return null
    }
  })
  const prevSummaryRef = useRef(state.summary)

  const incomingSummary = state.summary
  const incomingSessionId = state.session?.session_id ?? null
  const incomingWorkoutId = state.session?.workout_id ?? null
  useEffect(() => {
    const prev = prevSummaryRef.current
    if (!prev && incomingSummary) {
      const next: Latched = {
        summary: incomingSummary,
        sessionId: incomingSessionId,
        workoutId: incomingWorkoutId,
      }
      setLatched(next)
      try {
        window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(next))
      } catch {}
      // Session-end writes new PBs / lifetime totals / achievements
       // / trends rows server-side. Without invalidation here the
       // Rekorde tab keeps showing the cached pre-session PB list and
       // the just-celebrated "Neue Bestzeit" banner has no
       // counterpart in the grid until something else refetches.
       qc.invalidateQueries({ queryKey: ['sessions'] })
       qc.invalidateQueries({ queryKey: ['rower-pbs'] })
       qc.invalidateQueries({ queryKey: ['rower-lifetime'] })
       qc.invalidateQueries({ queryKey: ['rower-achievements'] })
       qc.invalidateQueries({ queryKey: ['rower-trends'] })
    }
    prevSummaryRef.current = incomingSummary
  }, [incomingSummary, incomingSessionId, incomingWorkoutId, qc])

  // FEAT-0009 acceptance: closing the tab does NOT end the session.
  // The backend's idle / inactivity timeouts, the workout-complete
  // trigger, and the X (abort) in WorkoutProgressStrip are the only
  // session-end triggers; on revisit, the SSE stream re-attaches via
  // Last-Event-ID and Snapshot.

  const banners = usePBBanners(latched?.sessionId ?? null)
  const activeRower = useActiveRower()
  const activeRowerId = activeRower.data?.id ?? null
  const dismiss = () => {
    setLatched(null)
    try {
      window.sessionStorage.removeItem(STORAGE_KEY)
    } catch {}
  }

  const latchedWorkoutId = latched?.workoutId ?? null
  const workoutQ = useQuery({
    queryKey: ['workout', latchedWorkoutId],
    queryFn: () => (latchedWorkoutId ? getWorkout(latchedWorkoutId) : Promise.resolve(null)),
    enabled: !!latchedWorkoutId,
    staleTime: 60_000,
  })
  const workoutLabel = workoutQ.data ? workoutChipLabel(workoutQ.data) : undefined

  const [pbDismissed, setPbDismissed] = useState(false)
  // Reset when latched clears (next session-end can show PBs again).
  useEffect(() => {
    if (!latched) setPbDismissed(false)
  }, [latched])

  const pbCount =
    banners.kind === 'resolved'
      ? banners.banners.distance.length + banners.banners.window.length
      : 0
  const showPbOverlay =
    !!latched && banners.kind === 'resolved' && pbCount > 0 && !pbDismissed
  const showSummary = !!latched && !showPbOverlay

  return (
    <>
      <LiveBody />
      <ConnectionBanner />
      <PauseDialog />
      {showPbOverlay && banners.kind === 'resolved' && (
        <PBOverlay
          banners={banners.banners}
          workoutLabel={workoutLabel}
          onDismiss={() => setPbDismissed(true)}
          onShowInRekorde={(item) => {
            const ridParam = activeRowerId
              ? `?rower=${encodeURIComponent(activeRowerId)}`
              : ''
            const anchor =
              item.kind === 'distance'
                ? `#pb-distance-${item.pb.distance_m}`
                : `#pb-window-${item.pb.metric}-${item.pb.window_size}`
            dismiss()
            nav(`/historie/rekorde${ridParam}${anchor}`)
          }}
        />
      )}
      {showSummary && latched && (
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
