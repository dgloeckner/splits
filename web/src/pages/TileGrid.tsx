import { useCallback, useEffect, useRef, useState } from 'react'
import { Tile } from '../tiles/Tile'
import {
  DEFAULT_LAYOUT,
  loadLayout,
  replaceSlot,
  saveLayout,
  type TileLayout,
} from '../tiles/layout'
import { TilePicker } from './TilePicker'
import type { LiveState } from '../live/reducer'
import styles from './TileGrid.module.css'

const LONG_PRESS_MS = 450

type Props = { state: LiveState }

export function TileGrid({ state }: Props) {
  const [layout, setLayout] = useState<TileLayout>(() => loadLayout())
  const [pickerFor, setPickerFor] = useState<number | null>(null)
  const timersRef = useRef<number[]>([])

  const sessionActive = state.session !== null && state.summary === null

  useEffect(() => {
    saveLayout(layout)
  }, [layout])

  const armPress = useCallback(
    (slotIndex: number) => {
      // Editing the board during an active session is a silent no-op.
      // The earlier "Nur zwischen Sessions editierbar" overlay was
      // confusing — it left users tapping the screen mid-row trying
      // to dismiss it. Now we just don't open the picker.
      if (sessionActive) return
      const t = window.setTimeout(() => {
        setPickerFor(slotIndex)
      }, LONG_PRESS_MS)
      timersRef.current.push(t)
    },
    [sessionActive],
  )

  const cancelPress = useCallback(() => {
    for (const t of timersRef.current) window.clearTimeout(t)
    timersRef.current = []
  }, [])

  const onSelect = (slotIndex: number, tileId: string) => {
    setLayout((prev) => replaceSlot(prev, slotIndex, tileId))
  }

  const resolvedLayout = layout.length === 6 ? layout : ([...DEFAULT_LAYOUT] as TileLayout)

  return (
    <>
      <div className={styles.grid}>
        {resolvedLayout.map((tileId, i) => (
          <div
            key={i}
            className={styles.slot}
            onPointerDown={() => armPress(i)}
            onPointerUp={cancelPress}
            onPointerLeave={cancelPress}
            onPointerCancel={cancelPress}
          >
            <Tile tileId={tileId} state={state} />
          </div>
        ))}
      </div>
      {pickerFor !== null && (
        <TilePicker
          open
          slotIndex={pickerFor}
          currentTileId={resolvedLayout[pickerFor]}
          onSelect={onSelect}
          onClose={() => setPickerFor(null)}
        />
      )}
    </>
  )
}
