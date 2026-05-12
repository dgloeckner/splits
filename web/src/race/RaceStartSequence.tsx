import { useEffect, useState } from 'react'
import styles from './RaceStartSequence.module.css'

type Phase = 'idle' | 'attention' | 'set' | 'go' | 'done'

const STEPS: Array<{ phase: Phase; delayMs: number }> = [
  { phase: 'attention', delayMs: 0 },
  { phase: 'set', delayMs: 1500 },
  { phase: 'go', delayMs: 3000 },
  { phase: 'done', delayMs: 4500 },
]

/**
 * `enabled` gates the ceremony as a whole (e.g. parent has not reached
 * Bereit-tap yet). `reducedMotion` keeps the ATTENTION/SET/GO text
 * transitions but suppresses the pulsing dot animations. The cue is
 * NEVER an empty render while a phase is active — regression fix vs
 * FEAT-0013 lines 132–133 (which hid the cue entirely under
 * reduced-motion).
 */
type Props = { enabled: boolean; reducedMotion?: boolean; onComplete?: () => void }

export function RaceStartSequence({ enabled, reducedMotion = false, onComplete }: Props) {
  const [phase, setPhase] = useState<Phase>('idle')

  useEffect(() => {
    if (!enabled) {
      setPhase('idle')
      return
    }
    const timers = STEPS.map((s) =>
      setTimeout(() => {
        setPhase(s.phase)
        if (s.phase === 'done') onComplete?.()
      }, s.delayMs),
    )
    return () => timers.forEach(clearTimeout)
  }, [enabled, onComplete])

  if (!enabled || phase === 'idle' || phase === 'done') return null

  const text = phase === 'attention' ? 'ATTENTION' : phase === 'set' ? 'SET' : 'GO!'

  return (
    <div
      className={styles.overlay}
      role="status"
      aria-live="assertive"
      data-reduced-motion={reducedMotion ? 'true' : 'false'}
    >
      {!reducedMotion && (
        <div className={styles.lights}>
          <span
            className={styles.dot}
            data-color="red"
            data-active={phase === 'attention' ? 'true' : 'false'}
          />
          <span
            className={styles.dot}
            data-color="amber"
            data-active={phase === 'set' ? 'true' : 'false'}
          />
          <span
            className={styles.dot}
            data-color="green"
            data-active={phase === 'go' ? 'true' : 'false'}
          />
        </div>
      )}
      <div className={styles.text} data-phase={phase}>
        {text}
      </div>
    </div>
  )
}
