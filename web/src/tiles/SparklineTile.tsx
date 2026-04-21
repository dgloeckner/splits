import { useEffect, useState } from 'react'
import { selectSparkline } from './selectors'
import type { TileDef } from './registry'
import type { LiveState } from '../live/reducer'
import { Sparkline } from '../components/Sparkline/Sparkline'
import { smoothingConfig } from '../live/smoothing'
import styles from './SparklineTile.module.css'

type Props = { def: TileDef; state: LiveState; disabled?: boolean }

function useIsTablet(): boolean {
  const [tablet, setTablet] = useState(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function')
      return false
    return window.matchMedia('(min-width: 768px)').matches
  })
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const mq = window.matchMedia('(min-width: 768px)')
    const handler = (e: MediaQueryListEvent) => setTablet(e.matches)
    if (mq.addEventListener) mq.addEventListener('change', handler)
    else mq.addListener(handler)
    return () => {
      if (mq.removeEventListener) mq.removeEventListener('change', handler)
      else mq.removeListener(handler)
    }
  }, [])
  return tablet
}

export function SparklineTile({ def, state, disabled }: Props) {
  const { points } = selectSparkline(state, def.id)
  const tablet = useIsTablet()
  const windowSeconds = tablet
    ? smoothingConfig.sparkline.windowSeconds.tablet
    : smoothingConfig.sparkline.windowSeconds.phone
  const cls = [styles.tile, disabled && styles.disabled].filter(Boolean).join(' ')
  return (
    <div className={cls}>
      <span className={`label-sm ${styles.label}`}>{def.label}</span>
      <div className={styles.canvas}>
        <Sparkline points={points} windowSeconds={windowSeconds} />
      </div>
    </div>
  )
}
