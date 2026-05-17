import styles from './StatBar.module.css'
import { fmtGap } from './fmtGap'

type Variant = 'phone' | 'tablet'

type Props = {
  variant: Variant
  elapsedSec: number
  splitSec: number
  distanceLeftM: number
  watts: number
  spm?: number
  vsPbSec: number | null
  vsGhostSec: number | null
}

function fmtSplit(s: number): string {
  const m = Math.floor(s / 60)
  const r = Math.round(s - m * 60)
  return `${m}:${String(r).padStart(2, '0')}`
}

function fmtElapsed(s: number): string {
  const safe = Math.max(0, Math.floor(s))
  const m = Math.floor(safe / 60)
  const r = safe - m * 60
  return `${m}:${String(r).padStart(2, '0')}`
}

function leaderGap(
  pb: number | null,
  ghost: number | null,
): { label: string; value: number } | null {
  const cands = [
    pb != null ? { label: 'PB', value: pb } : null,
    ghost != null ? { label: 'Ghost', value: ghost } : null,
  ].filter((x): x is { label: string; value: number } => x != null)
  if (cands.length === 0) return null
  const ahead = cands.filter((c) => c.value > 0)
  if (ahead.length > 0) {
    ahead.sort((a, b) => b.value - a.value)
    return ahead[0]
  }
  cands.sort((a, b) => b.value - a.value)
  return cands[0]
}

export function StatBar(p: Props) {
  if (p.variant === 'phone') {
    const lead = leaderGap(p.vsPbSec, p.vsGhostSec)
    return (
      <div className={styles.bar} data-variant="phone">
        <span className={styles.cell} data-testid="statbar-elapsed">{fmtElapsed(p.elapsedSec)}</span>
        <span className={styles.cell}>{p.distanceLeftM} m</span>
        <span className={styles.cell} data-testid="statbar-split">{fmtSplit(p.splitSec)}</span>
        <span className={styles.cell}>{p.watts} W</span>
        {lead && (
          <span
            className={styles.cell}
            data-testid={lead.label === 'Ghost' ? 'statbar-vs-ghost' : 'statbar-vs-pb'}
          >
            {lead.label} {fmtGap(lead.value)}
          </span>
        )}
      </div>
    )
  }
  return (
    <div className={styles.bar} data-variant="tablet">
      <span className={styles.cell} data-testid="statbar-elapsed">{fmtElapsed(p.elapsedSec)}</span>
      <span className={styles.cell}>{p.distanceLeftM} m</span>
      <span className={styles.cell} data-testid="statbar-split">{fmtSplit(p.splitSec)}</span>
      <span className={styles.cell}>{p.watts} W</span>
      {p.spm != null && <span className={styles.cell}>{p.spm}</span>}
      {p.vsPbSec != null && <span className={styles.cell} data-testid="statbar-vs-pb">PB {fmtGap(p.vsPbSec)}</span>}
      {p.vsGhostSec != null && <span className={styles.cell} data-testid="statbar-vs-ghost">Ghost {fmtGap(p.vsGhostSec)}</span>}
    </div>
  )
}
