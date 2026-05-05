import type { CSSProperties, JSX } from 'react'
import type { RaceOpponent } from '../api/race'
import { BoatSprite } from './BoatSprite'
import { reconstructDistance, distanceAt } from './distance'
import styles from './RaceTile.module.css'

const LANE_PX_PER_METER = 4
const SPRITE_HALF_WIDTH = 12
const SPRITE_WIDTH = 24
const SPRITE_HEIGHT_RATIO = 24 / 72 // BoatSprite viewBox aspect

const LANE_COLORS: Record<'pb' | 'user' | 'ghost', string> = {
  pb: '#F59E0B',
  user: '#14B8A6',
  ghost: '#94A3B8',
}

type Props = {
  elapsedSec: number
  userDistanceM: number
  ghost: RaceOpponent | null
  pb: RaceOpponent | null
  paneWidthPx: number
  laneHeightPx: number
}

type LaneKind = 'pb' | 'user' | 'ghost'

function opponentDistanceAt(opp: RaceOpponent, elapsedSec: number): number {
  const distM = reconstructDistance({ tSec: opp.tSec, split: opp.split })
  if (opp.tSec.length === 0) return 0
  // distanceAt clamps to last value when t >= last tSec, which matches the
  // "ghost stops at its finish line" behaviour.
  return distanceAt({ tSec: opp.tSec, distM }, elapsedSec)
}

function formatChip(offsetMeters: number): string {
  const abs = Math.abs(offsetMeters)
  if (abs >= 5) {
    const m = Math.round(offsetMeters)
    return m > 0 ? `+${m}m` : `${m}m`
  }
  const seconds = offsetMeters * 0.24
  const formatted = seconds.toFixed(1)
  return seconds > 0 ? `+${formatted}s` : `${formatted}s`
}

export function RaceTile(props: Props): JSX.Element | null {
  const { elapsedSec, userDistanceM, ghost, pb, paneWidthPx, laneHeightPx } = props

  if (laneHeightPx < 20) return null
  const variant: 'full' | 'hull' = laneHeightPx >= 28 ? 'full' : 'hull'

  const lanes: LaneKind[] = []
  if (pb != null) lanes.push('pb')
  lanes.push('user')
  if (ghost != null) lanes.push('ghost')

  const centerX = paneWidthPx / 2
  const totalHeight = lanes.length * laneHeightPx
  const spriteHeight = SPRITE_WIDTH * SPRITE_HEIGHT_RATIO

  return (
    <div className={styles.tile} style={{ height: totalHeight }}>
      {lanes.map((kind) => {
        let oppDistanceM: number
        if (kind === 'user') {
          oppDistanceM = userDistanceM
        } else {
          const opp = kind === 'pb' ? pb! : ghost!
          oppDistanceM = opponentDistanceAt(opp, elapsedSec)
        }
        const offsetMeters = oppDistanceM - userDistanceM
        const offsetPx = offsetMeters * LANE_PX_PER_METER
        const spriteLeft = centerX + offsetPx - SPRITE_HALF_WIDTH
        const offScreen =
          kind !== 'user' &&
          Math.abs(offsetPx) > paneWidthPx / 2 - SPRITE_HALF_WIDTH

        const laneStyle: CSSProperties = {
          height: laneHeightPx,
          color: LANE_COLORS[kind],
        }
        const spriteStyle: CSSProperties = {
          left: spriteLeft,
          width: SPRITE_WIDTH,
          height: spriteHeight,
          marginTop: -spriteHeight / 2,
        }

        return (
          <div key={kind} className={styles.lane} data-lane={kind} style={laneStyle}>
            {!offScreen && (
              <div className={styles.sprite} style={spriteStyle}>
                <BoatSprite variant={variant} />
              </div>
            )}
            {offScreen && (
              <div
                className={`${styles.chip} ${offsetPx < 0 ? styles.chipLeft : styles.chipRight}`}
                data-testid={`chip-${kind}`}
              >
                {formatChip(offsetMeters)}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
