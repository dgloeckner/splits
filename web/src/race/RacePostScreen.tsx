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

export function RacePostScreen(p: Props) {
  const series = [
    { color: '#14B8A6', label: 'Du', tSec: p.userTSec, split: p.userSplit },
    ...(p.pb ? [{ color: '#F59E0B', label: 'PB', tSec: p.pb.tSec, split: p.pb.split }] : []),
    ...(p.ghost ? [{ color: '#94A3B8', label: 'Ghost', tSec: p.ghost.tSec, split: p.ghost.split }] : []),
  ]
  return (
    <div className={styles.screen}>
      <h1 className={styles.title}>{fmtMeters(p.totalMeters)} Rennen</h1>
      <div className={styles.summary}>
        <div className={styles.cell}>
          <span className={styles.label}>Endzeit</span>
          <span className={styles.value}>{fmtMmSs(p.userTotalSec)}</span>
        </div>
        {p.vsPbSec != null && (
          <div className={styles.cell}>
            <span className={styles.label}>vs. PB</span>
            <span className={styles.value}>{fmtGap(p.vsPbSec)}</span>
          </div>
        )}
        {p.vsGhostSec != null && (
          <div className={styles.cell}>
            <span className={styles.label}>vs. Ghost</span>
            <span className={styles.value}>{fmtGap(p.vsGhostSec)}</span>
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
