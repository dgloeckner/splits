import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { createWorkout, getWorkout, type CreateWorkoutInput, type WorkoutMode } from '../api/workouts'
import { startSession } from '../api/client'
import { fetchRaceOpponents } from '../api/raceOpponents'
import { workoutChipLabel } from '../util/workoutLabel'
import { useLiveSession } from '../live/LiveSessionContext'
import { useWakeLock } from '../live/useWakeLock'
import { ConnectionBanner } from '../live/ConnectionBanner'
import { useWorkoutProgress } from '../live/useWorkoutProgress'
import { LiveHero } from './LiveHero'
import { TileGrid } from './TileGrid'
import { RaceFlow } from '../race/RaceFlow'
import { enqueueEndSession, processPendingEndSessions } from '../live/endSessionQueue'
import { useLiveViewHoldsUpdate } from '../offline/swUpdate'
import { useWorkoutOverlay } from './live/WorkoutOverlayContext'
import { WorkoutProgressStrip } from './live/WorkoutProgressStrip'
import { SegmentStatus } from './live/SegmentStatus'
import { SessionEndedOverlay } from './live/SessionEndedOverlay'
import { PhaseCountdownView } from './live/PhaseCountdownView'
import { RacePostScreen } from '../race/RacePostScreen'
import { PauseDialog } from './live/PauseDialog'
import { useSegmentTransitions } from '../live/useSegmentTransitions'
import { usePBBanners } from './live/usePBBanners'
import { PBOverlay } from './live/PBOverlay'
import { useActiveRower } from '../hooks/useActiveRower'
import styles from './LivePage.module.css'

function LiveBody() {
  useSegmentTransitions()
  const state = useLiveSession()
  const nav = useNavigate()
  const { active, segments, workout, isLoading, remainingAnchorMs } = useWorkoutProgress()
  const { aborted, abort } = useWorkoutOverlay()
  const seg = active?.segment
  const workSeg = seg && seg.kind === 'work' ? seg : null
  const target = workSeg
    ? { split: workSeg.targetSplit, spm: workSeg.targetSPM }
    : null
  const debug = new URLSearchParams(window.location.search).get('debug') === '1'
  const isRace = workout?.mode === 'race'
  if (isRace) {
    const meters = (workout.params as { meters: number }).meters
    let opponentsLabel = 'Ghost · PB'
    try {
      const raw = sessionStorage.getItem('race-opp-selection')
      if (raw) {
        const sel = JSON.parse(raw) as { ghost: boolean; pb: boolean }
        const parts = [sel.ghost ? 'Ghost' : null, sel.pb ? 'PB' : null].filter(Boolean)
        opponentsLabel = parts.length ? parts.join(' · ') : '—'
      }
    } catch {
      // unreadable or malformed selection: keep the default label
    }
    // 0019-03: Fertig button on the FinishOverlay routes through the
    // existing endSessionQueue path used by the manual abort flow
    // (see PauseDialog) — same end-point, different trigger. Idle-
    // timeout `session_end` remains a passive fallback for rowers who
    // walk away.
    const sessionId = state.session?.session_id ?? null
    const handleFinish = () => {
      if (sessionId) enqueueEndSession(sessionId)
      void processPendingEndSessions()
      abort()
      nav('/')
    }
    return (
      <div className={styles.page}>
        <RaceFlow
          liveState={state}
          totalMeters={meters}
          opponentsLabel={opponentsLabel}
          onAbort={abort}
          onFinish={handleFinish}
        />
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
      {(() => {
        // FEAT-0015 Slice 1: warmup/cooldown swap the dashboard for a
        // dedicated mm:ss countdown. The progress strip + ✕ remain
        // visible above so the user can still abort.
        //
        // F8: cover the gap between Start and the first server
        // phase_change event. If the workout has a warmup and no
        // stroke has landed yet, show the warmup countdown eagerly
        // with the full warmup duration. The earlier behaviour
        // briefly flashed the standard tile dashboard with "sammle
        // Daten …" placeholders before the server signal arrived.
        const serverPhase = state.phase
        if (serverPhase === 'warmup' || serverPhase === 'cooldown') {
          return (
            <PhaseCountdownView
              phase={serverPhase}
              remainingSec={seg && seg.kind === serverPhase ? active?.remainingSec ?? null : null}
              anchorMs={remainingAnchorMs}
            />
          )
        }
        if (
          serverPhase === null &&
          workout != null &&
          workout.warmup_sec > 0 &&
          state.stroke === null &&
          state.session !== null
        ) {
          return (
            <PhaseCountdownView
              phase="warmup"
              remainingSec={workout.warmup_sec}
            />
          )
        }
        return null
      })() ?? (
        <>
          <div className={styles.leftCol}>
            <LiveHero state={state} target={target} />
          </div>
          <div className={styles.rightCol}>
            <TileGrid state={state} />
          </div>
        </>
      )}
    </div>
  )
}

export function LivePage() {
  // ADR-0023 §5: a new build is never offered while the Live view is up.
  useLiveViewHoldsUpdate()
  // 0017-05: gate the entire LivePage on the workout query's loaded
  // state. While the active session's workout is still loading,
  // `workout?.mode` is undefined and the LiveBody falls through to
  // its non-race branch — which transiently mounts the
  // `SessionEndedOverlay` container alongside RaceFlow on the
  // null→summary transition (see 0017-03 investigation). Rendering a
  // minimal placeholder here prevents that branch from ever painting
  // a non-race tree for a race workout, and guarantees only one of
  // RaceFlow / SessionEndedOverlay is in the DOM at a time. The
  // content lives in a separate component so the latched-summary,
  // wake-lock, and overlay hooks below only mount once the workout
  // is known — keeping React's hook ordering stable across the gate.
  const progress = useWorkoutProgress()
  const workoutResolving =
    progress.workoutId !== null && (progress.isLoading || progress.workout === null)
  if (workoutResolving) {
    return <div className={styles.page} data-testid="live-loading" aria-busy="true" />
  }
  return <LivePageContent />
}

function LivePageContent() {
  const state = useLiveSession()
  const nav = useNavigate()
  const qc = useQueryClient()
  // 0019-08: capture the active workout's mode at latch time so the
  // session-end overlay choice can branch on it. CONTEXT.md §Finish
  // horn: in race mode the FinishOverlay IS the post-session result
  // surface; the generic SessionEndedOverlay ("Bestleistungen werden
  // berechnet…") must NOT slide in over it.
  const activeWorkout = useWorkoutProgress().workout
  const activeWorkoutMode = activeWorkout?.mode ?? null

  // FEAT-0015 Slice 2 / ADR-0010: hold the screen awake for the
  // duration of every active session so the phone does not power-save
  // mid-row and silently drop the connection. Best-effort —
  // unsupported browsers (iOS PWAs etc.) are non-blocking.
  const sessionOpen = state.session !== null && state.summary === null
  useWakeLock(sessionOpen)

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
    // 0019-08: snapshot the workout mode at session-end so the
    // post-session overlay choice is stable across re-renders, even
    // after the session clears from live state.
    workoutMode: string | null
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

  const { wasDiscarded } = useWorkoutOverlay()
  const incomingSummary = state.summary
  const incomingSessionId = state.session?.session_id ?? null
  const incomingWorkoutId = state.session?.workout_id ?? null
  useEffect(() => {
    const prev = prevSummaryRef.current
    if (!prev && incomingSummary) {
      if (wasDiscarded(incomingSessionId)) {
        // Discarded session: never latch, never show the save-overlay.
        // Clear any stale latch and refresh the list so the row is gone.
        try {
          window.sessionStorage.removeItem(STORAGE_KEY)
        } catch {
          // storage unavailable: nothing was latched to clear
        }
        qc.invalidateQueries({ queryKey: ['sessions'] })
        prevSummaryRef.current = incomingSummary
        return
      }
      const next: Latched = {
        summary: incomingSummary,
        sessionId: incomingSessionId,
        workoutId: incomingWorkoutId,
        workoutMode: activeWorkoutMode,
      }
      // The latch answers a session-end event and goes together with the
      // storage write and the cache invalidations below, which must not run
      // while rendering; one extra render at session end is the price.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLatched(next)
      try {
        window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(next))
      } catch {
        // storage unavailable: the latch lives in memory only
      }
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
  }, [incomingSummary, incomingSessionId, incomingWorkoutId, activeWorkoutMode, qc, wasDiscarded])

  // FEAT-0009 acceptance: closing the tab does NOT end the session.
  // The backend's idle / inactivity timeouts, the workout-complete
  // trigger, and the X (abort) in WorkoutProgressStrip are the only
  // session-end triggers; on revisit, the SSE stream re-attaches via
  // Last-Event-ID and Snapshot.

  const banners = usePBBanners(latched?.sessionId ?? null)
  const activeRower = useActiveRower()
  const activeRowerId = activeRower.data?.id ?? null
  const [pbDismissed, setPbDismissed] = useState(false)
  const dismiss = () => {
    setLatched(null)
    // The next session-end can show PBs again.
    setPbDismissed(false)
    try {
      window.sessionStorage.removeItem(STORAGE_KEY)
    } catch {
      // storage unavailable: nothing was latched to clear
    }
  }

  const latchedWorkoutId = latched?.workoutId ?? null
  const workoutQ = useQuery({
    queryKey: ['workout', latchedWorkoutId],
    queryFn: () => (latchedWorkoutId ? getWorkout(latchedWorkoutId) : Promise.resolve(null)),
    enabled: !!latchedWorkoutId,
    staleTime: 60_000,
  })
  const workoutLabel = workoutQ.data ? workoutChipLabel(workoutQ.data) : undefined

  const raceOpponentsQ = useQuery({
    queryKey: ['race-opponents', latched?.workoutId, activeRowerId],
    queryFn: () =>
      fetchRaceOpponents({
        workoutId: latched!.workoutId!,
        rowerId: activeRowerId!,
      }),
    enabled:
      !!latched &&
      !!latched.summary?.race &&
      !!latched.workoutId &&
      !!activeRowerId,
    staleTime: 60_000,
  })

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
      {showSummary && latched && latched.summary.race != null && (
        <RacePostScreen
          totalMeters={
            (workoutQ.data?.params as { meters?: number } | undefined)?.meters ??
            latched.summary.total_distance_m
          }
          userTotalSec={latched.summary.total_time_sec}
          userTSec={latched.summary.samples?.t_sec ?? []}
          userSplit={(latched.summary.samples?.split ?? []).map((s) => Number(s))}
          ghost={raceOpponentsQ.data?.ghost ?? null}
          pb={raceOpponentsQ.data?.pb ?? null}
          vsGhostSec={latched.summary.race.vs_ghost_sec ?? null}
          vsPbSec={latched.summary.race.vs_pb_sec ?? null}
          onRetry={async () => {
            // 0014-07: re-enter the race flow with the prior distance,
            // intensity, and opponent selection pre-filled — landing
            // on BereitScreen, not the full wizard. The
            // `race-opp-selection` entry in sessionStorage is left
            // intact so the next BereitScreen reflects the same
            // opponents; the new race session opens a fresh
            // lifecycle (Confirmed → Bereit) once the SSE
            // `session_start` lands.
            const prior = workoutQ.data
            const meters =
              (prior?.params as { meters?: number } | undefined)?.meters ??
              latched.summary.total_distance_m
            const intensity = prior?.intensity
            const input: CreateWorkoutInput = {
              mode: 'race' as WorkoutMode,
              params: { meters },
              intensity,
              warmup_sec: 0,
              cooldown_sec: 0,
            }
            try {
              const created = await createWorkout(input)
              await startSession(created.id)
              dismiss()
            } catch (e) {
              console.error('Erneut rennen failed', e)
            }
          }}
          onShowDetail={() => {
            const id = latched.sessionId
            dismiss()
            if (id) nav(`/historie/${id}`)
            else nav('/')
          }}
        />
      )}
      {showSummary && latched && latched.summary.race == null && latched.workoutMode !== 'race' && (
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
