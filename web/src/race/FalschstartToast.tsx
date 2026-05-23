import { useEffect, useRef, useState } from 'react'
import styles from './FalschstartToast.module.css'

/**
 * Top-centre toast shown on the Ceremony(ATTENTION|SET) → Live
 * (Falschstart) transition. Triggered by a one-shot `triggeredAtMs`
 * latch from the lifecycle reducer (`state.falschstartShownAtMs`) so
 * the visibility window is decoupled from the reducer's `phase`.
 *
 * Under fast-fixture replay the reducer can transition Falschstart →
 * Live → Finished inside one render frame; a naive `visible` prop
 * gated on `phase === 'Live'` would flip true→false in microseconds
 * and the toast would never paint long enough to be observable.
 *
 * Contract:
 *   - `triggeredAtMs === null` → not shown.
 *   - First transition to a non-null value → shown for `TOAST_MS`,
 *     then auto-dismissed. Subsequent prop changes (including the
 *     value reverting to null, or repeating the same value) are
 *     ignored for the active timer.
 *   - A genuinely new value (different from the last seen one) would
 *     re-trigger the toast — in practice the reducer never updates
 *     the latch after the first Falschstart, so this is a defensive
 *     no-op in the current flow.
 *
 * Drive timing via vitest fake timers in tests.
 */
type Props = { triggeredAtMs: number | null }

export const FALSCHSTART_TOAST_MS = 2000

export function FalschstartToast({ triggeredAtMs }: Props) {
  const [show, setShow] = useState(false)
  const lastSeenAtMs = useRef<number | null>(null)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Trigger the dismissal timer once per genuinely-new triggeredAtMs.
  // Cleanup is intentionally NOT a per-effect clearTimeout — that
  // would let a parent re-render with `triggeredAtMs={null}` cancel
  // the dismissal mid-display, which is exactly the fast-fixture
  // race we're guarding against (reducer transitions away from
  // Falschstart before the toast finishes). Cleanup lives in the
  // separate unmount-only effect below.
  useEffect(() => {
    if (triggeredAtMs == null) return
    if (triggeredAtMs === lastSeenAtMs.current) return
    lastSeenAtMs.current = triggeredAtMs

    setShow(true)
    if (timeoutRef.current) clearTimeout(timeoutRef.current)
    timeoutRef.current = setTimeout(() => setShow(false), FALSCHSTART_TOAST_MS)
  }, [triggeredAtMs])

  // Unmount-only cleanup so a stuck timer doesn't outlive the component.
  useEffect(
    () => () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current)
    },
    [],
  )

  if (!show) return null
  return (
    <div className={styles.toast} role="alert" data-testid="falschstart-toast">
      Falschstart — Uhr läuft ab GO!
    </div>
  )
}
