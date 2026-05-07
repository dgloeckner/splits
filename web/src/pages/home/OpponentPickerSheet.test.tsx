import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import { OpponentPickerSheet } from './OpponentPickerSheet'

describe('OpponentPickerSheet', () => {
  it('shows ghost row enabled when prior session exists', () => {
    render(
      <OpponentPickerSheet
        open
        meters={2000}
        hasGhost
        hasPB
        onConfirm={() => {}}
        onClose={() => {}}
      />,
    )
    expect(screen.getByTestId('opt-ghost')).toBeEnabled()
    expect(screen.getByTestId('opt-pb')).toBeEnabled()
  })

  it('hides PB row when no PB exists', () => {
    render(
      <OpponentPickerSheet
        open
        meters={2000}
        hasGhost
        hasPB={false}
        onConfirm={() => {}}
        onClose={() => {}}
      />,
    )
    expect(screen.queryByTestId('opt-pb')).toBeNull()
  })

  it('shows synthesised ghost copy when no real ghost', () => {
    render(
      <OpponentPickerSheet
        open
        meters={2000}
        hasGhost={false}
        hasPB={false}
        onConfirm={() => {}}
        onClose={() => {}}
      />,
    )
    expect(screen.getByText(/Synthetischer Geist/)).toBeTruthy()
  })

  it('calls onConfirm with selected opponents', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn()
    render(
      <OpponentPickerSheet
        open
        meters={2000}
        hasGhost
        hasPB
        onConfirm={onConfirm}
        onClose={() => {}}
      />,
    )
    await user.click(screen.getByTestId('opt-pb'))
    await user.click(screen.getByTestId('opt-pb'))
    await user.click(screen.getByRole('button', { name: /Rennen starten/ }))
    expect(onConfirm).toHaveBeenCalledWith({ ghost: true, pb: true })
  })

  it('opens with ghost-only when hasPB=false', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn()
    render(
      <OpponentPickerSheet
        open
        meters={1000}
        hasGhost
        hasPB={false}
        onConfirm={onConfirm}
        onClose={() => {}}
      />,
    )
    await user.click(screen.getByRole('button', { name: /Rennen starten/ }))
    expect(onConfirm).toHaveBeenCalledWith({ ghost: true, pb: false })
  })
})
