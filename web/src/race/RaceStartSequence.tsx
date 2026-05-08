import { useEffect, useState } from 'react'
import styles from './RaceStartSequence.module.css'

type Phase = 'idle' | 'attention' | 'set' | 'go' | 'done'

const STEPS: Array<{ phase: Phase; delayMs: number }> = [
  { phase: 'attention', delayMs: 0 },
  { phase: 'set', delayMs: 1500 },
  { phase: 'go', delayMs: 3000 },
  { phase: 'done', delayMs: 4500 },
]

type Props = { enabled: boolean; onComplete?: () => void }

export function RaceStartSequence({ enabled, onComplete }: Props) {
  const [phase, setPhase] = useState<Phase>('idle')

  useEffect(() => {
    if (!enabled) {
      setPhase('done')
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
    <div className={styles.overlay} role="status" aria-live="assertive">
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
      <div className={styles.text} data-phase={phase}>
        {text}
      </div>
    </div>
  )
}
