import { useEffect, useRef, useState } from 'react'
import type { LiveState } from '../live/reducer'
import { StatBar } from './StatBar'
import { RaceCanvas } from './RaceCanvas'
import { RaceStartSequence } from './RaceStartSequence'
import { useRaceData } from './useRaceData'
import { useReducedMotion } from './reducedMotion'
import styles from './RaceLiveView.module.css'

type Props = { liveState: LiveState; totalMeters: number }

export function RaceLiveView({ liveState, totalMeters }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
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

  const ghostGap = opps.ghost ? gapAtTime(opps.ghost.tSec, opps.ghost.split, userDistanceM, elapsedSec) : null
  const pbGap = opps.pb ? gapAtTime(opps.pb.tSec, opps.pb.split, userDistanceM, elapsedSec) : null

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
      <div data-component="race-canvas"><RaceCanvas
        elapsedSec={elapsedSec}
        userDistanceM={userDistanceM}
        totalMeters={totalMeters}
        ghost={opps.ghost}
        pb={opps.pb}
        viewportWidth={size.w}
        viewportHeight={canvasH}
        reducedMotion={reducedMotion}
      /></div>
      <RaceStartSequence enabled={!reducedMotion} />
    </div>
  )
}

function gapAtTime(tSec: number[], split: number[], userDist: number, userTime: number): number {
  if (tSec.length < 2) return 0
  const distM: number[] = [0]
  for (let i = 1; i < tSec.length; i++) {
    const dt = tSec[i] - tSec[i - 1]
    const v = split[i] > 0 ? 500 / split[i] : 0
    distM.push(distM[i - 1] + v * dt)
  }
  if (userDist <= 0) return userTime - tSec[0]
  if (userDist >= distM[distM.length - 1]) return userTime - tSec[tSec.length - 1]
  let lo = 0, hi = distM.length - 1
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (distM[mid] <= userDist) lo = mid; else hi = mid
  }
  const span = distM[hi] - distM[lo]
  const oppTime = span <= 0 ? tSec[lo] : tSec[lo] + (userDist - distM[lo]) / span * (tSec[hi] - tSec[lo])
  return userTime - oppTime
}
