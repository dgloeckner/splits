import { useEffect, useRef, useState } from 'react'
import type { LiveState } from '../live/reducer'
import { RaceTile } from './RaceTile'
import { useRaceOpponents } from './useRaceOpponents'

type Props = { liveState: LiveState; disabled?: boolean }

export function RaceTileAdapter({ liveState, disabled }: Props) {
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

  // Pause-sync: the backend halts stroke emission while paused, so
  // stroke.time_sec freezes; ghost + PB position halt with it.
  const opps = useRaceOpponents({
    workoutId: liveState.session?.workout_id ?? null,
    rowerId: liveState.session?.rower_id ?? null,
  })

  if (disabled) return <div ref={ref} style={{ width: '100%', height: '100%' }} />

  // Hide tile when no opponent is eligible: spec acceptance criterion.
  if (!opps.ghost && !opps.pb) {
    return <div ref={ref} style={{ width: '100%', height: '100%' }} />
  }

  const laneCount = 1 + (opps.ghost ? 1 : 0) + (opps.pb ? 1 : 0)
  const laneHeightPx = size.h > 0 ? size.h / laneCount : 32

  return (
    <div ref={ref} style={{ width: '100%', height: '100%' }}>
      <RaceTile
        elapsedSec={liveState.stroke?.time_sec ?? 0}
        userDistanceM={liveState.stroke?.distance_m ?? 0}
        ghost={opps.ghost}
        pb={opps.pb}
        paneWidthPx={size.w}
        laneHeightPx={laneHeightPx}
      />
    </div>
  )
}
