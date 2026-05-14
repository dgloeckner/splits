import { PaceOverlayChart } from './PaceOverlayChart'
import type { RaceOpponent } from '../api/raceOpponents'
import styles from './RacePostScreen.module.css'

type Props = {
  totalMeters: number
  userTotalSec: number
  userTSec: number[]
  userSplit: number[]
  ghost: RaceOpponent | null
  pb: RaceOpponent | null
  vsGhostSec: number | null
  vsPbSec: number | null
  onRetry: () => void
  onShowDetail: () => void
}

function fmtMmSs(s: number): string {
  const m = Math.floor(s / 60)
  const r = Math.round(s - m * 60)
  return `${m}:${String(r).padStart(2, '0')}`
}

function fmtMeters(m: number): string {
  return m % 1000 === 0 && m >= 1000 ? `${m / 1000} km` : `${m} m`
}

function fmtGap(n: number): string {
  if (n === 0) return '0.0 s'
  const sign = n > 0 ? '+' : ''
  return `${sign}${n.toFixed(1)} s`
}

function splitFromDistance(tSec: number[], distM: number[]): number[] {
  // Derive per-sample split (s / 500m) from cumulative distance. The
  // first sample carries no prior step; copy the following step's split.
  const n = tSec.length
  const out = new Array<number>(n).fill(0)
  for (let i = 1; i < n; i++) {
    const dt = tSec[i] - tSec[i - 1]
    const dm = distM[i] - distM[i - 1]
    out[i] = dt > 0 && dm > 0 ? 500 * dt / dm : 0
  }
  if (n > 1) out[0] = out[1]
  return out
}

export function RacePostScreen(p: Props) {
  const series = [
    { color: '#14B8A6', label: 'Du', tSec: p.userTSec, split: p.userSplit },
    ...(p.pb ? [{ color: '#F59E0B', label: 'PB', tSec: p.pb.tSec, split: splitFromDistance(p.pb.tSec, p.pb.distM) }] : []),
    ...(p.ghost ? [{ color: '#94A3B8', label: 'Ghost', tSec: p.ghost.tSec, split: splitFromDistance(p.ghost.tSec, p.ghost.distM) }] : []),
  ]
  return (
    <div className={styles.screen} data-testid="race-post-screen">
      <h1 className={styles.title}>{fmtMeters(p.totalMeters)} Rennen</h1>
      <div className={styles.summary}>
        <div className={styles.cell}>
          <span className={styles.label}>Endzeit</span>
          <span className={styles.value} data-testid="post-endzeit">{fmtMmSs(p.userTotalSec)}</span>
        </div>
        {p.vsPbSec != null && (
          <div className={styles.cell}>
            <span className={styles.label}>vs. PB</span>
            <span className={styles.value} data-testid="post-vs-pb">{fmtGap(p.vsPbSec)}</span>
          </div>
        )}
        {p.vsGhostSec != null && (
          <div className={styles.cell}>
            <span className={styles.label}>vs. Ghost</span>
            <span className={styles.value} data-testid="post-vs-ghost">{fmtGap(p.vsGhostSec)}</span>
          </div>
        )}
      </div>
      <div className={styles.chart}>
        <PaceOverlayChart series={series} totalMeters={p.totalMeters} width={600} height={240} />
      </div>
      <div className={styles.actions}>
        <button type="button" onClick={p.onRetry}>Erneut rennen</button>
        <button type="button" onClick={p.onShowDetail}>Detail</button>
      </div>
    </div>
  )
}
