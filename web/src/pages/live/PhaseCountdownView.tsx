import { useEffect, useState } from 'react'
import styles from './PhaseCountdownView.module.css'

type Props = {
  phase: 'warmup' | 'cooldown'
  /** Remaining seconds in the current phase. `null` / `undefined` →
   *  the countdown renders `--:--` (no remaining info available yet). */
  remainingSec: number | null | undefined
  /** Wall-clock ms at which `remainingSec` was computed. When
   *  provided, the view ticks locally between stroke updates and
   *  displays `remainingSec - (now - anchorMs)/1000`, so the mm:ss
   *  countdown advances continuously even though strokes (and
   *  therefore `remainingSec` updates) only arrive every 2-4 s. */
  anchorMs?: number | null
}

const LABELS: Record<Props['phase'], string> = {
  warmup: 'Aufwärmen',
  cooldown: 'Ausrudern (Cooldown)',
}

const TICK_MS = 250

/**
 * PhaseCountdownView (FEAT-0015 Slice 1 / ADR-0010): a big mm:ss
 * remaining-time display + phase label, shown in place of dashboard
 * tiles while a structured workout is in its warmup or cooldown phase.
 * Idleness inside those phases is expected; the pause dialog is
 * suppressed (see PauseDialog) and the user instead sees this
 * countdown reach 0:00.
 */
export function PhaseCountdownView({ phase, remainingSec, anchorMs }: Props) {
  // Local wall-clock tick. Without this the countdown freezes between
  // strokes — locateSegment derives remainingSec from the stroke-emitted
  // time_sec, which only updates every 2-4 s. Skip the timer when there
  // is nothing to count down so idle hooks don't schedule work.
  const tickEnabled =
    anchorMs != null && remainingSec != null && remainingSec > 0
  const [nowMs, setNowMs] = useState(() => Date.now())
  useEffect(() => {
    if (!tickEnabled) return
    const id = window.setInterval(() => setNowMs(Date.now()), TICK_MS)
    return () => window.clearInterval(id)
  }, [tickEnabled])

  const displaySec =
    remainingSec === null || remainingSec === undefined
      ? null
      : anchorMs != null
        ? Math.max(0, remainingSec - (nowMs - anchorMs) / 1000)
        : Math.max(0, remainingSec)
  const text = displaySec === null ? '--:--' : formatMMSS(Math.floor(displaySec))

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
