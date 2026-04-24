import { useState } from 'react'
import { deleteSession } from '../../api/client'
import { useLiveSession } from '../../live/LiveSessionContext'
import { useWorkoutProgress } from '../../live/useWorkoutProgress'
import type { ActiveSegment, Segment } from '../../live/segments'
import { useWorkoutOverlay } from './WorkoutOverlayContext'
import { AbortWorkoutDialog } from './AbortWorkoutDialog'
import styles from './WorkoutProgressStrip.module.css'

export function WorkoutProgressStrip() {
  const { segments, active } = useWorkoutProgress()
  const { abort } = useWorkoutOverlay()
  const state = useLiveSession()
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
      <AbortWorkoutDialog
        open={open}
        onSave={() => {
          abort()
          setOpen(false)
        }}
        onContinue={() => setOpen(false)}
        onDiscard={() => {
          if (sessionId) void deleteSession(sessionId).catch(() => {})
          abort()
          setOpen(false)
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
          <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
            <path
              d="M3 3 L11 11 M11 3 L3 11"
              stroke="currentColor"
              strokeWidth="1.5"
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
  if (seg.durationSec) return seg.durationSec * 3
  return 1
}
