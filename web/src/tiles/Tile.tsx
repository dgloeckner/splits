import type { LiveState } from '../live/reducer'
import { NumericTile } from './NumericTile'
import { SparklineTile } from './SparklineTile'
import { ZoneBadgeTile } from './ZoneBadgeTile'
import { getTile } from './registry'

type Props = { tileId: string; state: LiveState; disabled?: boolean }

export function Tile({ tileId, state, disabled }: Props) {
  const def = getTile(tileId)
  if (!def) {
    return (
      <div style={{ padding: 'var(--space-2)', opacity: 0.6 }} className="label-sm">
        {tileId}
      </div>
    )
  }
  const isDisabled = disabled || def.gated === 'hr'
  switch (def.type) {
    case 'numeric':
      return <NumericTile def={def} state={state} disabled={isDisabled} />
    case 'sparkline':
      return <SparklineTile def={def} state={state} disabled={isDisabled} />
    case 'zone':
      return <ZoneBadgeTile def={def} state={state} disabled={isDisabled} />
    case 'race-boat':
      return <RaceTilePlaceholder state={state} disabled={isDisabled} />
  }
}

function RaceTilePlaceholder({
  state: _state,
  disabled: _disabled,
}: {
  state: LiveState
  disabled: boolean
}) {
  // T12 stub: full live-context wiring lives in T13 (RaceTileAdapter).
  // Until then the registry entry is selectable but renders an empty box.
  return null
}
