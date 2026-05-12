import { useEffect, useState } from 'react'
import styles from './FalschstartToast.module.css'

/**
 * Top-centre toast shown when the reducer enters Live(Falschstart).
 * Auto-dismisses ~2 s after first render. Drive timing via vitest fake
 * timers in tests.
 */
type Props = { visible: boolean }

export function FalschstartToast({ visible }: Props) {
  const [show, setShow] = useState(false)

  useEffect(() => {
    if (!visible) {
      setShow(false)
      return
    }
    setShow(true)
    const t = setTimeout(() => setShow(false), 2000)
    return () => clearTimeout(t)
  }, [visible])

  if (!show) return null
  return (
    <div className={styles.toast} role="alert" data-testid="falschstart-toast">
      Falschstart — Uhr läuft ab GO!
    </div>
  )
}
