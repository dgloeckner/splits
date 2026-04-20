import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import { TilePicker } from './TilePicker'
import { initialLiveState } from '../live/reducer'

describe('TilePicker', () => {
  it('renders every known tile as an entry', () => {
    render(
      <TilePicker
        open
        slotIndex={0}
        currentTileId="split-verlauf"
        state={initialLiveState}
        onSelect={vi.fn()}
        onClose={vi.fn()}
      />,
    )
    expect(screen.getByText('Split')).toBeInTheDocument()
    expect(screen.getByText('DPS')).toBeInTheDocument()
    expect(screen.getByText('Watt-Verlauf')).toBeInTheDocument()
    expect(screen.getByText('HF-Zone')).toBeInTheDocument()
  })

  it('fires onSelect with the chosen tile id', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    render(
      <TilePicker
        open
        slotIndex={2}
        currentTileId="oe-split"
        state={initialLiveState}
        onSelect={onSelect}
        onClose={vi.fn()}
      />,
    )
    await user.click(screen.getByRole('button', { name: /^DPS/ }))
    expect(onSelect).toHaveBeenCalledWith(2, 'dps')
  })

  it('HR-gated tiles are disabled buttons', () => {
    render(
      <TilePicker
        open
        slotIndex={0}
        currentTileId="split"
        state={initialLiveState}
        onSelect={vi.fn()}
        onClose={vi.fn()}
      />,
    )
    const hf = screen.getByRole('button', { name: /^Herzfrequenz/ })
    expect(hf).toBeDisabled()
  })
})
