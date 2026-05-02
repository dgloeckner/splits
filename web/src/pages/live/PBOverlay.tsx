import { useMemo, useState } from 'react'
import type { DistancePB, SessionPBBanners, WindowPB } from '../../api/client'
import { PBCard } from './PBCard'
import styles from './PBOverlay.module.css'

type Item =
  | { kind: 'distance'; pb: DistancePB }
  | { kind: 'window'; pb: WindowPB }

type Props = {
  banners: SessionPBBanners
  onDismiss: () => void
  onShowInRekorde: (item: Item) => void
  workoutLabel?: string
}

export function PBOverlay({ banners, onDismiss, onShowInRekorde, workoutLabel }: Props) {
  const items: Item[] = useMemo(
    () => [
      ...banners.distance.map((pb): Item => ({ kind: 'distance', pb })),
      ...banners.window.map((pb): Item => ({ kind: 'window', pb })),
    ],
    [banners],
  )
  const [idx, setIdx] = useState(0)

  if (items.length === 0) return null
  const current = items[idx]
  const isLast = idx === items.length - 1
  const advance = () => (isLast ? onDismiss() : setIdx(idx + 1))

  return (
    <div className={styles.scrim} role="dialog" aria-modal="true" data-testid="pb-overlay">
      <div className={styles.holder}>
        {workoutLabel && (
          <p className={styles.workoutLabel}>Workout abgeschlossen · {workoutLabel}</p>
        )}
        {items.length > 1 && (
          <div className={styles.dots} data-testid="pb-stack-dots">
            {items.map((_, i) => (
              <span key={i} className={i === idx ? styles.dotActive : styles.dot} />
            ))}
          </div>
        )}
        <PBCard {...current} />
        <div className={styles.actions}>
          <button type="button" className={styles.primary} onClick={advance}>
            Weiter
          </button>
          <button
            type="button"
            className={styles.secondary}
            onClick={() => onShowInRekorde(current)}
          >
            In Rekorden zeigen
          </button>
        </div>
      </div>
    </div>
  )
}

export type { Item as PBOverlayItem }
