import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import { TilePicker } from './TilePicker'

describe('TilePicker', () => {
  it('renders every known tile as an entry', () => {
    render(
      <TilePicker
        open
        slotIndex={0}
        currentTileId="split-verlauf"
        onSelect={vi.fn()}
        onClose={vi.fn()}
      />,
    )
    // "Split" appears twice (numeric + sparkline) by design — use getAllByText.
    expect(screen.getAllByText('Split').length).toBeGreaterThanOrEqual(2)
    expect(screen.getByText('DPS')).toBeInTheDocument()
    // Sparkline tiles use the short name; type chip differentiates them.
    expect(screen.getAllByText('Watt').length).toBeGreaterThanOrEqual(2)
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
        onSelect={vi.fn()}
        onClose={vi.fn()}
      />,
    )
    const hf = screen.getByRole('button', { name: /^Herzfrequenz/ })
    expect(hf).toBeDisabled()
  })
})
