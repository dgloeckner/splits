import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { LiveState } from '../live/reducer'
import { StatBar } from './StatBar'
import { RaceCanvas } from './RaceCanvas'
import { useRaceData } from './useRaceData'
import { useReducedMotion } from './reducedMotion'
import { useRaceFreeze } from './useRaceFreeze'
import type { RaceResultLatch } from './raceResultLatch'
import styles from './RaceLiveView.module.css'

/**
 * Renders the in-race canvas + stat bar. As of 0014-04 this component
 * no longer fires the start ceremony on mount — that responsibility
 * moved to the `raceLifecycle` reducer driven by `BereitScreen`. The
 * caller (e.g. `RaceFlow`) must only mount this view once the reducer
 * has transitioned to Ceremony(GO!) or Live.
 */
type Props = {
  liveState: LiveState
  totalMeters: number
  /**
   * Authoritative finish-line latch from the parent lifecycle reducer.
   * When set, drives the StatBar / Canvas freeze (0019-02 AC3/AC4).
   * Optional so unit tests and older callers can render without it.
   */
  latchedResult?: RaceResultLatch | null
}

export function RaceLiveView({ liveState, totalMeters, latchedResult }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  // 0017-01: seed `size` synchronously before paint so the very first
  // rendered frame has non-zero lane heights and the user/ghost/PB
  // sprites are visible at Ceremony(ATTENTION) rather than appearing
  // one async ResizeObserver tick later.
  useLayoutEffect(() => {
    if (!ref.current) return
    const r = ref.current.getBoundingClientRect()
    setSize({ w: r.width, h: r.height })
  }, [])
  useEffect(() => {
    if (!ref.current) return
    const ro = new ResizeObserver((entries) => {
      const r = entries[0].contentRect
      setSize({ w: r.width, h: r.height })
    })
    ro.observe(ref.current)
    return () => ro.disconnect()
  }, [])
  const reducedMotion = useReducedMotion()
  const opps = useRaceData({
    workoutId: liveState.session?.workout_id ?? null,
    rowerId: liveState.session?.rower_id ?? null,
  })

  // 0019-02: route all race-surface render inputs through `useRaceFreeze`
  // so the StatBar and Canvas freeze on the finish-horn snapshot (and
  // opponent positions in the Canvas freeze mechanically as a result).
  const frozen = useRaceFreeze({
    liveState,
    totalMeters,
    opponents: {
      ghost: opps.ghost ? { tSec: opps.ghost.tSec, distM: opps.ghost.distM } : undefined,
      pb: opps.pb ? { tSec: opps.pb.tSec, distM: opps.pb.distM } : undefined,
    },
    latchedResult,
  })
  const { elapsedSec, userDistanceM, split, watts, spm, ghostGap, pbGap } = frozen

  const variant: 'phone' | 'tablet' = size.w >= 768 ? 'tablet' : 'phone'
  const canvasH = Math.max(0, size.h - 56)

  return (
    <div ref={ref} className={styles.view}>
      <div data-component="stat-bar"><StatBar
        variant={variant}
        elapsedSec={elapsedSec}
        splitSec={split}
        distanceLeftM={Math.max(0, totalMeters - userDistanceM)}
        watts={watts}
        spm={spm}
        vsPbSec={pbGap}
        vsGhostSec={ghostGap}
      /></div>
      <div data-component="race-canvas" data-user-distance-m={userDistanceM}><RaceCanvas
        elapsedSec={elapsedSec}
        userDistanceM={userDistanceM}
        totalMeters={totalMeters}
        ghost={opps.ghost}
        pb={opps.pb}
        viewportWidth={size.w}
        viewportHeight={canvasH}
        reducedMotion={reducedMotion}
      /></div>
    </div>
  )
}
