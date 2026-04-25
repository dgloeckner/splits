import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { endSession } from '../api/client'
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
      {state.session && !state.summary && <FinishCTA />}
    </div>
  )
}

function FinishCTA() {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  if (!open) {
    return (
      <button
        type="button"
        className={styles.finishBtn}
        onClick={() => setOpen(true)}
        data-testid="live-finish-cta"
      >
        Beenden
      </button>
    )
  }
  return (
    <div className={styles.finishConfirmScrim} role="dialog" aria-modal="true">
      <div className={styles.finishConfirmCard}>
        <h2 className={styles.finishConfirmTitle}>Workout beenden?</h2>
        <p className={styles.finishConfirmBody}>
          Die Sitzung wird abgeschlossen und Bestleistungen werden berechnet.
        </p>
        <div className={styles.finishConfirmActions}>
          <button
            type="button"
            className={styles.finishConfirmPrimary}
            disabled={busy}
            onClick={async () => {
              setBusy(true)
              try {
                await endSession()
              } finally {
                setBusy(false)
                setOpen(false)
              }
            }}
            data-testid="live-finish-confirm"
          >
            Ja, beenden
          </button>
          <button
            type="button"
            className={styles.finishConfirmSecondary}
            onClick={() => setOpen(false)}
          >
            Abbrechen
          </button>
        </div>
      </div>
    </div>
  )
}

export function LivePage() {
  const state = useLiveSession()
  const nav = useNavigate()
  const qc = useQueryClient()
  const sessionId = state.session?.session_id ?? null

  useEffect(() => {
    if (state.summary) {
      qc.invalidateQueries({ queryKey: ['sessions'] })
    }
  }, [state.summary, qc])

  // FEAT-0009 acceptance: closing the tab does NOT end the session.
  // The backend's idle / inactivity timeouts and the explicit
  // "Beenden" CTA are the only triggers; on revisit, the SSE stream
  // re-attaches via Last-Event-ID and Snapshot.

  const banners = usePBBanners(state.summary ? sessionId : null)

  return (
    <>
      <LiveBody />
      {state.summary && (
        <SessionEndedOverlay
          summary={state.summary}
          banners={banners}
          onAcknowledge={() => nav('/')}
          onShowDetails={
            sessionId ? () => nav(`/historie/${sessionId}`) : undefined
          }
        />
      )}
    </>
  )
}
