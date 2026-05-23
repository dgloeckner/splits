import { render, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { FinishOverlay } from './FinishOverlay'

describe('FinishOverlay', () => {
  it('renders final time mm:ss and final split', () => {
    const { getByTestId, getByText } = render(
      <FinishOverlay
        result={{ finalTimeS: 470, finalSplitS: 118.5, gaps: {}, crossSnapshot: { userDistanceM: 2000, watts: 0, spm: 0, split: 118.5 } }}
      />,
    )
    expect(getByTestId('finish-overlay')).toBeTruthy()
    // 470 s = 7:50
    expect(getByText('7:50')).toBeTruthy()
    // split 118.5 → 1:58.5 (mm:ss.t)
    expect(getByText(/1:58/)).toBeTruthy()
  })

  it('labels the race-average split as "Schnitt" (not "Split") — 0019-07', () => {
    const { getByTestId, queryByText } = render(
      <FinishOverlay
        result={{ finalTimeS: 470, finalSplitS: 117.5, gaps: {}, crossSnapshot: { userDistanceM: 2000, watts: 0, spm: 0, split: 117.5 } }}
      />,
    )
    // The cell carrying the race-average value must be labeled Schnitt.
    expect(queryByText('Schnitt')).toBeTruthy()
    // And must NOT be labeled "Split" — that label belongs to the
    // frozen StatBar's instantaneous cell (CONTEXT.md §Live split).
    expect(queryByText('Split')).toBeNull()
    // Sanity: value still renders under the testid.
    expect(getByTestId('finish-split').textContent).toMatch(/1:57\.5/)
  })

  it('does NOT render the ambient "Paddelst aus..." copy (0019-03)', () => {
    const { queryByText, getByTestId } = render(
      <FinishOverlay
        result={{ finalTimeS: 470, finalSplitS: 118.5, gaps: {}, crossSnapshot: { userDistanceM: 2000, watts: 0, spm: 0, split: 118.5 } }}
      />,
    )
    expect(queryByText(/Paddelst aus/i)).toBeNull()
    expect(getByTestId('finish-overlay').textContent ?? '').not.toMatch(/Paddelst aus/i)
  })

  it('renders signed gap for ghost when present', () => {
    const { getByTestId, queryByTestId } = render(
      <FinishOverlay
        result={{ finalTimeS: 470, finalSplitS: 118.5, gaps: { ghost: -10 }, crossSnapshot: { userDistanceM: 2000, watts: 0, spm: 0, split: 118.5 } }}
      />,
    )
    expect(getByTestId('finish-gap-ghost').textContent).toMatch(/-10\.0/)
    expect(queryByTestId('finish-gap-pb')).toBeNull()
  })

  it('renders signed gap for pb when present, with + sign for positive', () => {
    const { getByTestId, queryByTestId } = render(
      <FinishOverlay
        result={{ finalTimeS: 470, finalSplitS: 118.5, gaps: { pb: 3.4 }, crossSnapshot: { userDistanceM: 2000, watts: 0, spm: 0, split: 118.5 } }}
      />,
    )
    expect(getByTestId('finish-gap-pb').textContent).toMatch(/\+3\.4/)
    expect(queryByTestId('finish-gap-ghost')).toBeNull()
  })

  it('renders both gaps when both opponents present', () => {
    const { getByTestId } = render(
      <FinishOverlay
        result={{ finalTimeS: 470, finalSplitS: 118.5, gaps: { ghost: -10, pb: 30 }, crossSnapshot: { userDistanceM: 2000, watts: 0, spm: 0, split: 118.5 } }}
      />,
    )
    expect(getByTestId('finish-gap-ghost')).toBeTruthy()
    expect(getByTestId('finish-gap-pb')).toBeTruthy()
  })

  // 0019-03: explicit Fertig affordance
  it('renders a Fertig button (data-testid="finish-fertig") when given a result, enabled on mount', () => {
    const { getByTestId } = render(
      <FinishOverlay
        result={{ finalTimeS: 470, finalSplitS: 118.5, gaps: {}, crossSnapshot: { userDistanceM: 2000, watts: 0, spm: 0, split: 118.5 } }}
      />,
    )
    const btn = getByTestId('finish-fertig') as HTMLButtonElement
    expect(btn).toBeTruthy()
    expect(btn.tagName).toBe('BUTTON')
    expect(btn.disabled).toBe(false)
    expect(btn.textContent).toMatch(/Fertig/)
  })

  it('clicking Fertig invokes onFinish exactly once', () => {
    const onFinish = vi.fn()
    const { getByTestId } = render(
      <FinishOverlay
        result={{ finalTimeS: 470, finalSplitS: 118.5, gaps: {}, crossSnapshot: { userDistanceM: 2000, watts: 0, spm: 0, split: 118.5 } }}
        onFinish={onFinish}
      />,
    )
    fireEvent.click(getByTestId('finish-fertig'))
    expect(onFinish).toHaveBeenCalledTimes(1)
  })

  it('renders Fertig button even without an onFinish prop (parent may wire later)', () => {
    const { getByTestId } = render(
      <FinishOverlay
        result={{ finalTimeS: 470, finalSplitS: 118.5, gaps: {}, crossSnapshot: { userDistanceM: 2000, watts: 0, spm: 0, split: 118.5 } }}
      />,
    )
    // Tapping with no handler must not throw.
    expect(() => fireEvent.click(getByTestId('finish-fertig'))).not.toThrow()
  })
})
