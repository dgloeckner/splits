import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { enqueueEndSession, processPendingEndSessions } from '../../live/endSessionQueue'
import { useLiveSession } from '../../live/LiveSessionContext'
import { useIsLivePaused } from '../../live/useLiveDisplay'
import { useWorkoutProgress } from '../../live/useWorkoutProgress'
import { useWorkoutOverlay } from './WorkoutOverlayContext'
import { useDiscardSession } from './useDiscardSession'
import { AbortWorkoutDialog } from './AbortWorkoutDialog'

/**
 * Auto-shows the Speichern / Weiter / Verwerfen dialog whenever the
 * rower has paused (no strokes for the pause threshold) and an active
 * session is open. Closes automatically when strokes resume. The
 * "Weiter" button suppresses the dialog for the current pause window;
 * resuming clears the suppression so the dialog reappears on the next
 * pause.
 */
export function PauseDialog() {
  const state = useLiveSession()
  const paused = useIsLivePaused(state)
  const { workout } = useWorkoutProgress()
  const { abort } = useWorkoutOverlay()
  const discard = useDiscardSession()
  const nav = useNavigate()
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    if (!paused) setDismissed(false)
  }, [paused])

  const sessionActive = state.session !== null && state.summary === null
  const hasStrokes = state.stroke !== null
  // Phase-gate (FEAT-0015 Slice 1 / ADR-0010): only auto-pop during the
  // Work phase. Idleness inside Warmup or Cooldown is expected and must
  // not trigger the Speichern/Weiter/Verwerfen sheet. FreeRow / Just Row
  // sessions carry phase = null and retain today's behaviour. The ✕ in
  // WorkoutProgressStrip opens the same dialog unconditionally in any
  // phase.
  const phaseAllowsAutoOpen = state.phase === null || state.phase === 'work'
  // 0014-05: race mode is a one-shot competition unit. The Speichern /
  // Weiter / Verwerfen pause sheet is suppressed entirely; if the rower
  // stops, they abort via the ✕ in WorkoutProgressStrip, which lands
  // the session with summary_json.race = null (race_result.go: distance
  // < goal → nil).
  const isRace = workout?.mode === 'race'
  const open =
    sessionActive && hasStrokes && paused && phaseAllowsAutoOpen && !isRace && !dismissed
  const sessionId = state.session?.session_id ?? null

  return (
    <AbortWorkoutDialog
      open={open}
      onSave={() => {
        // Route through the retry queue so a transient backend or
        // network failure does not silently drop the session-end.
        // FEAT-0015 Slice 2 / ADR-0010.
        if (sessionId) enqueueEndSession(sessionId)
        void processPendingEndSessions()
        abort()
        setDismissed(false)
        nav('/')
      }}
      onContinue={() => setDismissed(true)}
      onDiscard={async () => {
        const ok = await discard(sessionId)
        if (ok) setDismissed(false)
      }}
    />
  )
}
