import { useEffect, useState } from 'react'
import styles from './RaceResultToast.module.css'

export type RaceResult = {
  /** negative = user faster than PB; null = no PB lane in race */
  vsPbSec: number | null
  /** negative = user faster than ghost; null = no ghost lane */
  vsGhostSec: number | null
}

type Props = { result: RaceResult | null }

const VISIBLE_MS = 6000

function formatGap(sec: number): string {
  // One decimal, explicit sign for non-zero, "0.0" for tie.
  // Use Number.toFixed(1) and manage sign manually (no Intl).
  const rounded = Math.round(sec * 10) / 10
  if (rounded === 0) return '0.0s'
  if (rounded > 0) return `+${rounded.toFixed(1)}s`
  // rounded < 0 — toFixed already includes '-'.
  return `${rounded.toFixed(1)}s`
}

export function RaceResultToast({ result }: Props) {
  const [shown, setShown] = useState<RaceResult | null>(result)

  useEffect(() => {
    setShown(result)
    if (result == null) return
    const handle = setTimeout(() => setShown(null), VISIBLE_MS)
    return () => clearTimeout(handle)
  }, [result])

  if (shown == null) return null
  const hasPb = shown.vsPbSec != null
  const hasGhost = shown.vsGhostSec != null
  if (!hasPb && !hasGhost) return null

  return (
    <div role="status" className={styles.toast}>
      {hasPb ? (
        <span className={styles.segment}>
          <span>vs. PB:</span>
          <span>{formatGap(shown.vsPbSec as number)}</span>
        </span>
      ) : null}
      {hasGhost ? (
        <span className={styles.segment}>
          <span>vs. Ghost:</span>
          <span>{formatGap(shown.vsGhostSec as number)}</span>
        </span>
      ) : null}
    </div>
  )
}
