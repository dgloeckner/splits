import { render, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { BereitScreen } from './BereitScreen'

describe('BereitScreen', () => {
  it('renders distance and opponents summary', () => {
    const { getByTestId } = render(
      <BereitScreen distanceMeters={2000} opponentsLabel="Ghost · PB" onTap={() => {}} />,
    )
    const summary = getByTestId('bereit-summary')
    expect(summary.textContent).toContain('2000')
    expect(summary.textContent?.toLowerCase()).toContain('m')
    expect(summary.textContent).toContain('Ghost · PB')
  })

  it('renders large primary Bereit button with test-id', () => {
    const { getByTestId } = render(
      <BereitScreen distanceMeters={500} opponentsLabel="—" onTap={() => {}} />,
    )
    const btn = getByTestId('bereit-button')
    expect(btn.textContent).toContain('Bereit')
  })

  it('calls onTap when button pressed', () => {
    const onTap = vi.fn()
    const { getByTestId } = render(
      <BereitScreen distanceMeters={1000} opponentsLabel="—" onTap={onTap} />,
    )
    fireEvent.click(getByTestId('bereit-button'))
    expect(onTap).toHaveBeenCalledTimes(1)
  })
})
