import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import { Sheet } from './Sheet'

describe('Sheet', () => {
  it('renders when open', () => {
    render(
      <Sheet open onClose={() => {}} title="Beispiel">
        <p>Inhalt</p>
      </Sheet>,
    )
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByText('Inhalt')).toBeInTheDocument()
    expect(screen.getByText('Beispiel')).toBeInTheDocument()
  })

  it('does not render when closed', () => {
    render(
      <Sheet open={false} onClose={() => {}} title="x">
        <p>Inhalt</p>
      </Sheet>,
    )
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('calls onClose when backdrop is clicked', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(
      <Sheet open onClose={onClose} title="x">
        <p>Inhalt</p>
      </Sheet>,
    )
    await user.click(screen.getByTestId('sheet-backdrop'))
    expect(onClose).toHaveBeenCalled()
  })

  it('calls onClose when Escape is pressed', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(
      <Sheet open onClose={onClose} title="x">
        <p>Inhalt</p>
      </Sheet>,
    )
    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalled()
  })
})
