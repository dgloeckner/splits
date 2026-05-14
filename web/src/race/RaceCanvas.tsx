import { useMemo } from 'react'
import type { CSSProperties } from 'react'
import type { RaceOpponent } from '../api/raceOpponents'
import { distanceAt, type DistanceSeries } from './distance'
import { BoatSprite } from './BoatSprite'
import styles from './RaceCanvas.module.css'

type Props = {
  elapsedSec: number
  userDistanceM: number
  totalMeters: number
  ghost: RaceOpponent | null
  pb: RaceOpponent | null
  viewportWidth: number
  viewportHeight: number
  reducedMotion: boolean
}

const LANE_PX_PER_METER = 4
const SPRITE_HALF_WIDTH = 12
const TABLET_WIDTH = 768
const TRAIL_OFFSETS_SEC = [-5, -10, -15]
const TRAIL_OPACITIES = [0.35, 0.20, 0.10]

export function RaceCanvas({
  elapsedSec, userDistanceM, totalMeters, ghost, pb,
  viewportWidth, viewportHeight, reducedMotion,
}: Props) {
  const lanes = useMemo(() => {
    const out: Array<{ kind: 'pb' | 'user' | 'ghost'; opp: RaceOpponent | null; color: string }> = []
    if (pb) out.push({ kind: 'pb', opp: pb, color: '#F59E0B' })
    out.push({ kind: 'user', opp: null, color: '#14B8A6' })
    if (ghost) out.push({ kind: 'ghost', opp: ghost, color: '#94A3B8' })
    return out
  }, [pb, ghost])

  const laneHeight = viewportHeight / lanes.length
  const centerX = viewportWidth / 2

  const isTablet = viewportWidth >= TABLET_WIDTH
  const markerStep = isTablet ? 100 : 250
  const markersFit = (totalMeters / markerStep) >= 6
  const markers = isTablet && markersFit
    ? Array.from({ length: Math.floor(totalMeters / markerStep) }, (_, i) => (i + 1) * markerStep)
    : []

  const showBanner = viewportWidth >= TABLET_WIDTH
  const finishOffsetPx = (totalMeters - userDistanceM) * LANE_PX_PER_METER

  return (
    <div className={styles.canvas} data-testid="race-canvas" style={{ width: viewportWidth, height: viewportHeight }}>
      {showBanner && <div className={styles.banner}>{totalMeters} m Rennen</div>}
      <div
        className={styles.water}
        data-water-animated={reducedMotion ? undefined : 'true'}
      />
      {lanes.map((lane) => (
        <Lane
          key={lane.kind}
          kind={lane.kind}
          opp={lane.opp}
          color={lane.color}
          height={laneHeight}
          centerX={centerX}
          paneWidth={viewportWidth}
          elapsedSec={elapsedSec}
          userDistanceM={userDistanceM}
        />
      ))}
      {markers.map((m) => {
        const offsetPx = (m - userDistanceM) * LANE_PX_PER_METER
        const x = centerX + offsetPx
        if (x < 0 || x > viewportWidth) return null
        return <div key={m} data-marker className={styles.marker} style={{ left: x }}>·{m}·</div>
      })}
      {finishOffsetPx >= -SPRITE_HALF_WIDTH && finishOffsetPx <= viewportWidth - centerX && (
        <>
          <div className={styles.finishLine} style={{ left: centerX + finishOffsetPx }} />
          {isTablet && (
            <div data-finish="flag" className={styles.finishFlag} style={{ left: centerX + finishOffsetPx }}>🏁</div>
          )}
        </>
      )}
    </div>
  )
}

function Lane({ kind, opp, color, height, centerX, paneWidth, elapsedSec, userDistanceM }: {
  kind: 'pb' | 'user' | 'ghost'
  opp: RaceOpponent | null
  color: string
  height: number
  centerX: number
  paneWidth: number
  elapsedSec: number
  userDistanceM: number
}) {
  const series: DistanceSeries | null = useMemo(() => {
    if (!opp) return null
    return { tSec: opp.tSec, distM: opp.distM }
  }, [opp])

  const oppDistanceM = series == null
    ? userDistanceM
    : (elapsedSec > series.tSec[series.tSec.length - 1]
        ? series.distM[series.distM.length - 1]
        : distanceAt(series, elapsedSec))

  const offsetMeters = oppDistanceM - userDistanceM
  const offsetPx = offsetMeters * LANE_PX_PER_METER
  const onScreen = Math.abs(offsetPx) <= paneWidth / 2 - SPRITE_HALF_WIDTH

  return (
    <div className={styles.lane} data-lane={kind} data-testid={`race-lane-${kind}`} style={{ height, color }}>
      {series && [0, 1, 2].map((i) => {
        const lookback = TRAIL_OFFSETS_SEC[i]
        const t = elapsedSec + lookback
        if (t < 0) return null
        const lastT = series.tSec[series.tSec.length - 1]
        const d = t > lastT
          ? series.distM[series.distM.length - 1]
          : distanceAt(series, t)
        const tx = centerX + (d - userDistanceM) * LANE_PX_PER_METER - SPRITE_HALF_WIDTH
        return (
          <span
            key={i}
            data-trail
            className={styles.sprite}
            style={{ left: tx, opacity: TRAIL_OPACITIES[i] }}
          >
            <BoatSprite variant="hull" />
          </span>
        )
      })}
      {onScreen && (
        <span
          className={styles.sprite}
          data-testid={`boat-${kind}`}
          style={{ left: centerX + offsetPx - SPRITE_HALF_WIDTH }}
        >
          <BoatSprite variant="full" />
        </span>
      )}
      {!onScreen && opp && (
        <span
          data-testid={`chip-${kind}`}
          className={styles.chip}
          style={{ [offsetPx > 0 ? 'right' : 'left']: 4 } as CSSProperties}
        >
          {formatChip(offsetMeters)}
        </span>
      )}
    </div>
  )
}

function formatChip(offsetMeters: number): string {
  const abs = Math.abs(offsetMeters)
  if (abs < 5) {
    const sec = offsetMeters * 0.24
    return `${sec >= 0 ? '+' : ''}${sec.toFixed(1)}s`
  }
  return `${offsetMeters >= 0 ? '+' : ''}${Math.round(offsetMeters)}m`
}
