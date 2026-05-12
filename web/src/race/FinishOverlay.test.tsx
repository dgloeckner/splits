import { render } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { FinishOverlay } from './FinishOverlay'

describe('FinishOverlay', () => {
  it('renders final time mm:ss, final split, and "Paddelst aus..." copy', () => {
    const { getByTestId, getByText } = render(
      <FinishOverlay
        result={{ finalTimeS: 470, finalSplitS: 118.5, gaps: {} }}
      />,
    )
    expect(getByTestId('finish-overlay')).toBeTruthy()
    // 470 s = 7:50
    expect(getByText('7:50')).toBeTruthy()
    // split 118.5 → 1:58.5 (mm:ss.t)
    expect(getByText(/1:58/)).toBeTruthy()
    expect(getByText(/Paddelst aus/i)).toBeTruthy()
  })

  it('renders signed gap for ghost when present', () => {
    const { getByTestId, queryByTestId } = render(
      <FinishOverlay
        result={{ finalTimeS: 470, finalSplitS: 118.5, gaps: { ghost: -10 } }}
      />,
    )
    expect(getByTestId('finish-gap-ghost').textContent).toMatch(/-10\.0/)
    expect(queryByTestId('finish-gap-pb')).toBeNull()
  })

  it('renders signed gap for pb when present, with + sign for positive', () => {
    const { getByTestId, queryByTestId } = render(
      <FinishOverlay
        result={{ finalTimeS: 470, finalSplitS: 118.5, gaps: { pb: 3.4 } }}
      />,
    )
    expect(getByTestId('finish-gap-pb').textContent).toMatch(/\+3\.4/)
    expect(queryByTestId('finish-gap-ghost')).toBeNull()
  })

  it('renders both gaps when both opponents present', () => {
    const { getByTestId } = render(
      <FinishOverlay
        result={{ finalTimeS: 470, finalSplitS: 118.5, gaps: { ghost: -10, pb: 30 } }}
      />,
    )
    expect(getByTestId('finish-gap-ghost')).toBeTruthy()
    expect(getByTestId('finish-gap-pb')).toBeTruthy()
  })
})
