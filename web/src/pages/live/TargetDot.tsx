import type { RangeStatus } from '../../live/targetRange'
import styles from './TargetDot.module.css'

export type Props = { status: RangeStatus; className?: string }

export function TargetDot({ status, className }: Props) {
  if (status === 'none') return null
  const kind = status === 'in' ? 'in' : 'out'
  return (
    <span
      className={`${styles.dot} ${styles[kind]} ${className ?? ''}`}
      data-testid="target-dot"
      data-status={status}
      aria-hidden
    />
  )
}
