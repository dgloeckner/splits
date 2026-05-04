import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { deleteSession, endSession } from '../../api/client'
import { useLiveSession } from '../../live/LiveSessionContext'
import { useIsLivePaused } from '../../live/useLiveDisplay'
import { useWorkoutOverlay } from './WorkoutOverlayContext'
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
  const { abort } = useWorkoutOverlay()
  const qc = useQueryClient()
  const nav = useNavigate()
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    if (!paused) setDismissed(false)
  }, [paused])

  const sessionActive = state.session !== null && state.summary === null
  const hasStrokes = state.stroke !== null
  const open = sessionActive && hasStrokes && paused && !dismissed
  const sessionId = state.session?.session_id ?? null

  return (
    <AbortWorkoutDialog
      open={open}
      onSave={() => {
        void endSession()
          .then(() => qc.invalidateQueries({ queryKey: ['sessions'] }))
          .catch(() => {})
        abort()
        setDismissed(false)
        nav('/')
      }}
      onContinue={() => setDismissed(true)}
      onDiscard={() => {
        if (sessionId) {
          void deleteSession(sessionId)
            .then(() => qc.invalidateQueries({ queryKey: ['sessions'] }))
            .catch(() => {})
        }
        abort()
        setDismissed(false)
        nav('/')
      }}
    />
  )
}
