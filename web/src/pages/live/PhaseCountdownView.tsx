import styles from './PhaseCountdownView.module.css'

type Props = {
  phase: 'warmup' | 'cooldown'
  /** Remaining seconds in the current phase. `null` / `undefined` →
   *  the countdown renders `--:--` (no remaining info available yet). */
  remainingSec: number | null | undefined
}

const LABELS: Record<Props['phase'], string> = {
  warmup: 'Aufwärmen',
  cooldown: 'Ausrudern (Cooldown)',
}

/**
 * PhaseCountdownView (FEAT-0015 Slice 1 / ADR-0010): a big mm:ss
 * remaining-time display + phase label, shown in place of dashboard
 * tiles while a structured workout is in its warmup or cooldown phase.
 * Idleness inside those phases is expected; the pause dialog is
 * suppressed (see PauseDialog) and the user instead sees this
 * countdown reach 0:00.
 */
export function PhaseCountdownView({ phase, remainingSec }: Props) {
  const text =
    remainingSec === null || remainingSec === undefined
      ? '--:--'
      : formatMMSS(Math.max(0, Math.floor(remainingSec)))
  return (
    <div className={styles.wrap} data-testid="phase-countdown" data-phase={phase}>
      <div className={styles.time} data-testid="phase-countdown-time">
        {text}
      </div>
      <div className={styles.label} data-testid="phase-countdown-label">
        {LABELS[phase]}
      </div>
    </div>
  )
}

function formatMMSS(totalSec: number): string {
  const m = Math.floor(totalSec / 60)
  const s = totalSec % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}
