import { useEffect, useRef } from 'react'
import { endSession } from '../api/client'
import { useLiveSession } from './LiveSessionContext'
import { useWorkoutProgress } from './useWorkoutProgress'

export function useAutoEndOnComplete(): void {
  const state = useLiveSession()
  const { active, segments, isLoading } = useWorkoutProgress()
  const sawActive = useRef(false)
  const fired = useRef(false)
  const sessionId = state.session?.session_id ?? null
  const prevSessionId = useRef<string | null>(null)

  useEffect(() => {
    if (sessionId !== prevSessionId.current) {
      sawActive.current = false
      fired.current = false
      prevSessionId.current = sessionId
    }
  }, [sessionId])

  useEffect(() => {
    if (!sessionId || isLoading || segments.length === 0) return
    if (state.summary) return
    if (active) {
      sawActive.current = true
      return
    }
    if (!sawActive.current || fired.current) return
    fired.current = true
    endSession().catch(() => {
      fired.current = false
    })
  }, [sessionId, isLoading, segments.length, active, state.summary])
}
