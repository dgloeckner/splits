import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { LiveState } from '../live/reducer'
import { StatBar } from './StatBar'
import { RaceCanvas } from './RaceCanvas'
import { useRaceData } from './useRaceData'
import { useReducedMotion } from './reducedMotion'
import { opponentLookup } from './opponentLookup'
import styles from './RaceLiveView.module.css'

/**
 * Renders the in-race canvas + stat bar. As of 0014-04 this component
 * no longer fires the start ceremony on mount — that responsibility
 * moved to the `raceLifecycle` reducer driven by `BereitScreen`. The
 * caller (e.g. `RaceFlow`) must only mount this view once the reducer
 * has transitioned to Ceremony(GO!) or Live.
 */
type Props = { liveState: LiveState; totalMeters: number }

export function RaceLiveView({ liveState, totalMeters }: Props) {
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

  const elapsedSec = liveState.stroke?.time_sec ?? 0
  const userDistanceM = liveState.stroke?.distance_m ?? 0
  const split = liveState.stroke?.pace_sec_per_500m ?? 120
  const watts = liveState.stroke?.power_w ?? 0
  const spm = liveState.stroke?.spm ?? 0

  const ghostGap = opps.ghost ? opponentLookup(opps.ghost.tSec, opps.ghost.distM, userDistanceM, elapsedSec) : null
  const pbGap = opps.pb ? opponentLookup(opps.pb.tSec, opps.pb.distM, userDistanceM, elapsedSec) : null

  const variant: 'phone' | 'tablet' = size.w >= 768 ? 'tablet' : 'phone'
  const canvasH = Math.max(0, size.h - 56)

  return (
    <div ref={ref} className={styles.view}>
      <div data-component="stat-bar"><StatBar
        variant={variant}
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
