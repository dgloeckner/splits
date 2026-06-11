import { useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { deleteSession } from '../../api/client'
import { showToast } from '../../app/Toast'
import { useWorkoutOverlay } from './WorkoutOverlayContext'

/**
 * Single source of truth for discarding the open session. Both the ✕
 * abort dialog (WorkoutProgressStrip) and the pause dialog (PauseDialog)
 * use this so the rule lives in exactly one place.
 *
 * Order matters: markDiscarded runs BEFORE the delete is awaited, so the
 * `session_end` that the backend's EndSession() emits during delete is
 * recognised as a discard and LivePage suppresses the save-overlay.
 *
 * Returns true on success (caller closes its dialog), false on failure
 * (caller leaves the dialog open; a toast has been shown).
 */
export function useDiscardSession(): (sessionId: string | null) => Promise<boolean> {
  const { abort, markDiscarded } = useWorkoutOverlay()
  const qc = useQueryClient()
  const nav = useNavigate()
  return useCallback(
    async (sessionId: string | null): Promise<boolean> => {
      if (sessionId) {
        markDiscarded(sessionId)
        try {
          await deleteSession(sessionId)
          qc.invalidateQueries({ queryKey: ['sessions'] })
        } catch {
          showToast('Verwerfen fehlgeschlagen — bitte erneut versuchen.', 'warn')
          return false
        }
      }
      abort()
      nav('/')
      return true
    },
    [abort, markDiscarded, qc, nav],
  )
}
