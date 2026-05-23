import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { deleteSession } from '../../api/client'
import { showToast } from '../../app/Toast'
import { enqueueEndSession, processPendingEndSessions } from '../../live/endSessionQueue'
import { useLiveSession } from '../../live/LiveSessionContext'
import { useWorkoutProgress } from '../../live/useWorkoutProgress'
import type { ActiveSegment, Segment } from '../../live/segments'
import { useWorkoutOverlay } from './WorkoutOverlayContext'
import { AbortWorkoutDialog } from './AbortWorkoutDialog'
import { useExtrapolatedActiveSegment } from './SegmentStatus'
import { WorkProgressBadge } from './WorkProgressBadge'
import styles from './WorkoutProgressStrip.module.css'

export function WorkoutProgressStrip() {
  const { segments, active: activeRaw } = useWorkoutProgress()
  const active = useExtrapolatedActiveSegment(activeRaw)
  const { abort } = useWorkoutOverlay()
  const state = useLiveSession()
  const qc = useQueryClient()
  const nav = useNavigate()
  const [open, setOpen] = useState(false)
  const sessionId = state.session?.session_id ?? null
  if (segments.length === 0) return null
  return (
    <>
      <WorkoutProgressStripView
        segments={segments}
        active={active}
        onAbort={() => setOpen(true)}
      />
      <WorkProgressBadge />
      <AbortWorkoutDialog
        open={open}
        onSave={() => {
          // Force-close the open session immediately rather than
          // waiting for idle timeout. Backend handles "no session
          // open" gracefully (idempotent 204). Route through the
          // retry queue so a transient failure (sleeping phone,
          // dropped Wi-Fi mid-cooldown) is recovered on the next
          // app start or `online` event. FEAT-0015 Slice 2.
          if (sessionId) enqueueEndSession(sessionId)
          void processPendingEndSessions()
          abort()
          setOpen(false)
          nav('/')
        }}
        onContinue={() => setOpen(false)}
        onDiscard={async () => {
          if (sessionId) {
            try {
              await deleteSession(sessionId)
              qc.invalidateQueries({ queryKey: ['sessions'] })
            } catch {
              showToast('Verwerfen fehlgeschlagen — bitte erneut versuchen.', 'warn')
              return
            }
          }
          abort()
          setOpen(false)
          nav('/')
        }}
      />
    </>
  )
}

export type ViewProps = {
  segments: Segment[]
  active: ActiveSegment | null
  onAbort?: () => void
}

export function WorkoutProgressStripView({ segments, active, onAbort }: ViewProps) {
  if (segments.length === 0) return null
  return (
    <div className={styles.wrap}>
      <div
        className={styles.strip}
        data-testid="progress-strip"
        role="progressbar"
        aria-label="Workout-Fortschritt"
      >
        {segments.map((seg) => {
          const cost = segmentCost(seg)
          const isActive = active?.segment.index === seg.index
          return (
            <span
              key={seg.index}
              className={`${styles.block} ${styles[`block_${seg.kind}`]}`}
              style={{ flexGrow: cost }}
              data-active={isActive ? 'true' : undefined}
            >
              {isActive && (
                <span
                  className={styles.marker}
                  style={{ left: `${Math.max(0, Math.min(1, active!.progressRatio)) * 100}%` }}
                  data-testid="progress-marker"
                />
              )}
            </span>
          )
        })}
      </div>
      {onAbort && (
        <button
          type="button"
          className={styles.abortX}
          onClick={onAbort}
          aria-label="Workout beenden"
          data-testid="progress-strip-abort"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
            <path
              d="M4 4 L12 12 M12 4 L4 12"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>
        </button>
      )}
    </div>
  )
}

function segmentCost(seg: Segment): number {
  if (seg.distanceM) return seg.distanceM
  if (seg.kind === 'warmup' || seg.kind === 'cooldown' || seg.kind === 'rest') {
    return Math.min(seg.durationSec ?? 30, 60)
  }
  if (seg.durationSec) return seg.durationSec * 3
  return 1
}
