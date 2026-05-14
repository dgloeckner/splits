import { render, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { AbortControl } from './AbortControl'

describe('AbortControl', () => {
  it('renders an "Abbrechen" pill', () => {
    const { getByTestId } = render(<AbortControl onConfirmAbort={() => {}} />)
    const pill = getByTestId('abort-pill')
    expect(pill.textContent).toContain('Abbrechen')
  })

  it('does not render the confirmation sheet initially', () => {
    const { queryByTestId } = render(<AbortControl onConfirmAbort={() => {}} />)
    expect(queryByTestId('abort-confirm-sheet')).toBeNull()
  })

  it('opens the confirmation sheet when the pill is tapped', () => {
    const { getByTestId } = render(<AbortControl onConfirmAbort={() => {}} />)
    fireEvent.click(getByTestId('abort-pill'))
    expect(getByTestId('abort-confirm-sheet')).toBeTruthy()
    expect(getByTestId('abort-confirm-confirm')).toBeTruthy()
    expect(getByTestId('abort-confirm-cancel')).toBeTruthy()
  })

  it('tapping confirm calls onConfirmAbort exactly once', () => {
    const onConfirmAbort = vi.fn()
    const { getByTestId } = render(<AbortControl onConfirmAbort={onConfirmAbort} />)
    fireEvent.click(getByTestId('abort-pill'))
    fireEvent.click(getByTestId('abort-confirm-confirm'))
    expect(onConfirmAbort).toHaveBeenCalledTimes(1)
  })

  it('tapping cancel does NOT call onConfirmAbort and closes the sheet', () => {
    const onConfirmAbort = vi.fn()
    const { getByTestId, queryByTestId } = render(
      <AbortControl onConfirmAbort={onConfirmAbort} />,
    )
    fireEvent.click(getByTestId('abort-pill'))
    expect(queryByTestId('abort-confirm-sheet')).not.toBeNull()
    fireEvent.click(getByTestId('abort-confirm-cancel'))
    expect(onConfirmAbort).not.toHaveBeenCalled()
    expect(queryByTestId('abort-confirm-sheet')).toBeNull()
  })

  it('re-tapping the pill after cancel re-opens the sheet', () => {
    const { getByTestId, queryByTestId } = render(
      <AbortControl onConfirmAbort={() => {}} />,
    )
    fireEvent.click(getByTestId('abort-pill'))
    fireEvent.click(getByTestId('abort-confirm-cancel'))
    expect(queryByTestId('abort-confirm-sheet')).toBeNull()
    fireEvent.click(getByTestId('abort-pill'))
    expect(queryByTestId('abort-confirm-sheet')).not.toBeNull()
  })
})
