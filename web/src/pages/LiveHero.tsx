import type { LiveState } from '../live/reducer'
import {
  useCountUp,
  useDeadReckonedDistance,
  useDeadReckonedTime,
  useSmoothed,
} from '../live/useLiveDisplay'
import { smoothingConfig } from '../live/smoothing'
import { fmtInt } from '../util/format'
import { StrokePulse } from './StrokePulse'
import styles from './LiveHero.module.css'

/**
 * Tweens a purely numeric string toward the new target using the count-up
 * hook. When the incoming value isn't parseable (e.g. "—" or mm:ss),
 * renders it unchanged.
 */
function CountUpText({ value }: { value: string }) {
  const parsed = /^-?\d+(\.\d+)?$/.test(value) ? Number(value) : null
  const tweened = useCountUp(parsed, smoothingConfig.countUpMs)
  if (parsed === null || tweened === null) return <>{value}</>
  return <>{fmtInt(tweened)}</>
}

type Props = { state: LiveState }

export function LiveHero({ state }: Props) {
  const time = useDeadReckonedTime(state)
  const distance = useDeadReckonedDistance(state)
  const smoothed = useSmoothed(state)

  return (
    <section className={styles.hero} aria-label="Live-Daten">
      <div className={styles.split}>
        <div className={styles.pulseAnchor}>
          <StrokePulse state={state} />
        </div>
        <span className={`label-sm ${styles.splitLabel}`}>Split</span>
        <div className={styles.splitRow}>
          <span className={`${styles.splitValue} tnum`}>{smoothed.split}</span>
          <span className={styles.splitUnit}>/ 500m</span>
        </div>
      </div>
      <div className={styles.secondary}>
        <HeroCell
          label="Zeit"
          value={time.text}
          paused={time.paused}
        />
        <HeroCell
          label="Distanz"
          value={distance.text}
          paused={distance.paused}
        />
        <HeroCell label="SPM" value={smoothed.spm} animate />
        <HeroCell label="Watt" value={smoothed.watts} animate />
      </div>
    </section>
  )
}

function HeroCell({
  label,
  value,
  paused,
  animate,
}: {
  label: string
  value: string
  paused?: boolean
  animate?: boolean
}) {
  return (
    <div
      className={styles.secondaryCell}
      data-paused={paused ? 'true' : undefined}
    >
      <span className={`label-sm ${styles.secondaryLabel}`}>{label}</span>
      <span className={`${styles.secondaryValue} tnum`}>
        {animate ? <CountUpText value={value} /> : value}
      </span>
      {paused && <span className={styles.pausedChip}>Pause</span>}
    </div>
  )
}
