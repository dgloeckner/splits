import { useEffect, useRef } from 'react'
import { useWorkoutProgress } from './useWorkoutProgress'
import { vibrate } from './haptics'

const TRANSITION_PATTERN: number[] = [80, 40, 80]

/**
 * Fires a haptic buzz when the active segment index rises (segment transition).
 * Silent on initial mount.
 */
export function useSegmentTransitions(): void {
  const { active } = useWorkoutProgress()
  const prev = useRef<number | null>(null)
  const activeIndex = active?.segment.index ?? null

  useEffect(() => {
    if (prev.current !== null && activeIndex !== null && activeIndex > prev.current) {
      vibrate(TRANSITION_PATTERN)
    }
    prev.current = activeIndex
  }, [activeIndex])
}
