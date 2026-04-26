import type { LiveState } from '../live/reducer'
import type { Range } from '../live/segments'
import {
  useCountUp,
  useIsLivePaused,
  usePhasedDistance,
  usePhasedTime,
  useSmoothed,
} from '../live/useLiveDisplay'
import { smoothingConfig } from '../live/smoothing'
import { fmtInt } from '../util/format'
import { formatSplitRange, formatSpmRange } from './workout/intensityRanges'
import styles from './LiveHero.module.css'

export type TargetStatus = 'in' | 'below' | 'above' | 'over' | 'under' | 'none'

type Side = 'above' | 'below' | 'in' | 'none'

function sideOf(value: number | null | undefined, r: Range | undefined): Side {
  if (value == null || !r) return 'none'
  if (r.hi != null && value > r.hi) return 'above'
  if (value < r.lo) return 'below'
  return 'in'
}

/**
 * Maps a raw side to a positive/negative status per metric semantics.
 * - 'in' → in-range (positive)
 * - 'over' → off-range on the bad side (rendered warning)
 * - 'under' → off-range on the positive/effort side (rendered positive)
 *
 * For SPM, going above the target band is a positive effort signal, so
 * `above` maps to 'under'. For split (sec/500m, lower=faster), going
 * below the target band means faster-than-target — also positive.
 */
function splitStatus(value: number | null | undefined, r: Range | undefined): TargetStatus {
  const s = sideOf(value, r)
  if (s === 'none' || s === 'in') return s
  return s === 'below' ? 'under' : 'over'
}

function spmStatus(value: number | null | undefined, r: Range | undefined): TargetStatus {
  const s = sideOf(value, r)
  if (s === 'none' || s === 'in') return s
  return s === 'above' ? 'under' : 'over'
}

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

type Props = {
  state: LiveState
  target?: { split?: Range; spm?: Range } | null
}

export function LiveHero({ state, target }: Props) {
  const time = usePhasedTime(state)
  const distance = usePhasedDistance(state)
  const smoothed = useSmoothed(state)
  const paused = useIsLivePaused(state)

  const splitStat = splitStatus(state.smoothed?.paceSecPer500m ?? null, target?.split)
  const spmStat = spmStatus(state.smoothed?.spm ?? null, target?.spm)

  const blank = '—'
  const splitText = paused ? blank : smoothed.split
  const spmText = paused ? blank : smoothed.spm
  const wattsText = paused ? blank : smoothed.watts

  return (
    <section className={styles.hero} aria-label="Live-Daten">
      <div className={styles.split}>
        <span className={`label-sm ${styles.splitLabel}`}>Split</span>
        <div className={styles.splitRow}>
          <span
            className={`${styles.splitValue} tnum`}
            data-target-status={paused ? undefined : splitStat}
          >
            {splitText}
          </span>
        </div>
        {target?.split && (
          <span
            className={`label-sm ${styles.targetRange}`}
            data-target-status={splitStat}
            data-testid="split-target"
          >
            Ziel {formatSplitRange(target.split)}
          </span>
        )}
      </div>
      <div className={styles.secondary}>
        <HeroCell
          label="Zeit"
          value={paused ? blank : time.text}
          paused={time.paused}
        />
        <HeroCell
          label="Distanz"
          value={paused ? blank : distance.text}
          paused={distance.paused}
        />
        <HeroCell
          label="SPM"
          value={spmText}
          animate={!paused}
          targetText={target?.spm ? formatSpmRange(target.spm) : undefined}
          targetStatus={paused ? undefined : spmStat}
          testId="spm-cell"
        />
        <HeroCell label="Watt" value={wattsText} animate={!paused} />
      </div>
    </section>
  )
}

function HeroCell({
  label,
  value,
  paused,
  animate,
  targetText,
  targetStatus,
  testId,
}: {
  label: string
  value: string
  paused?: boolean
  animate?: boolean
  targetText?: string
  targetStatus?: TargetStatus
  testId?: string
}) {
  return (
    <div
      className={styles.secondaryCell}
      data-paused={paused ? 'true' : undefined}
      data-testid={testId}
    >
      <span className={`label-sm ${styles.secondaryLabel}`}>{label}</span>
      <span
        className={`${styles.secondaryValue} tnum`}
        data-target-status={targetStatus}
      >
        {animate ? <CountUpText value={value} /> : value}
      </span>
      {targetText && (
        <span
          className={`label-sm ${styles.targetRange}`}
          data-target-status={targetStatus}
        >
          {targetText}
        </span>
      )}
      {paused && <span className={styles.pausedChip}>Pause</span>}
    </div>
  )
}
