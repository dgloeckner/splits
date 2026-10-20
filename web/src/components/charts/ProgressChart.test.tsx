import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { ProgressChart } from './ProgressChart'

const T = (iso: string) => new Date(iso).getTime()
const base = {
  metric: 'split' as const,
  fmt: (v: number) => v.toFixed(0),
  windowFromMs: T('2026-05-13T00:00:00'),
  windowToMs: T('2026-06-12T00:00:00'),
  rollingWindowDays: 14,
  onDotTap: vi.fn(),
}

describe('ProgressChart', () => {
  const line = [
    { t: T('2026-05-20T08:00:00'), y: 118, sessionId: 'a' },
    { t: T('2026-05-27T08:00:00'), y: 116, sessionId: 'b' },
    { t: T('2026-06-10T08:00:00'), y: 114, sessionId: 'c' },
  ]
  const ctx = [{ t: T('2026-06-01T08:00:00'), y: 130, sessionId: 'jr', label: 'Just Row' }]

  it('renders line dots, context dots, and Monday x-ticks', () => {
    render(<ProgressChart {...base} linePoints={line} contextDots={ctx} />)
    expect(screen.getAllByTestId('progress-line-dot')).toHaveLength(3)
    expect(screen.getAllByTestId('progress-context-dot')).toHaveLength(1)
    for (const tick of screen.getAllByTestId('progress-xtick')) {
      expect(tick.textContent).toMatch(/^\d+\.\d+\.$/)
    }
  })

  it('y gridlines exist', () => {
    render(<ProgressChart {...base} linePoints={line} contextDots={ctx} />)
    const labels = screen.getAllByTestId('progress-gridline')
    expect(labels.length).toBeGreaterThan(1)
  })

  it('draws the direct-labeled gold PB line when pbValue is set', () => {
    render(<ProgressChart {...base} linePoints={line} contextDots={[]} pbValue={112} pbLabel="PB 1:52" />)
    expect(screen.getByTestId('progress-pb-line')).toBeInTheDocument()
    expect(screen.getByText('PB 1:52')).toBeInTheDocument()
  })

  it('labels the rolling average at its right end', () => {
    render(<ProgressChart {...base} linePoints={line} contextDots={[]} />)
    expect(screen.getByText('Ø 14 T')).toBeInTheDocument()
  })

  it('strip delta speaks rower language', () => {
    render(<ProgressChart {...base} linePoints={line} contextDots={[]} />)
    expect(screen.getByTestId('progress-strip-delta').textContent).toMatch(/vs Ø 14 T$/)
  })

  it('keeps PB and Ø labels apart when their lines coincide', () => {
    const flat = line.map((q) => ({ ...q, y: 116 }))
    render(<ProgressChart {...base} linePoints={flat} contextDots={[]} pbValue={116} pbLabel="PB 1:56" />)
    const pbY = Number(screen.getByText('PB 1:56').getAttribute('y'))
    const avgY = Number(screen.getByText('Ø 14 T').getAttribute('y'))
    expect(Math.abs(pbY - avgY)).toBeGreaterThanOrEqual(10)
  })

  it('legend names the line and the context dots', () => {
    render(<ProgressChart {...base} linePoints={line} contextDots={ctx} lineLabel="5 k" />)
    const legend = screen.getByTestId('progress-legend')
    expect(legend.textContent).toContain('5 k')
    expect(legend.textContent).toContain('andere Sessions')
  })

  it('no legend without context dots', () => {
    render(<ProgressChart {...base} linePoints={line} contextDots={[]} lineLabel="5 k" />)
    expect(screen.queryByTestId('progress-legend')).toBeNull()
  })

  it('free rower: legend has only the grey swatch, labelled "Sessions"', () => {
    render(<ProgressChart {...base} linePoints={[]} contextDots={ctx} />)
    expect(screen.getByTestId('progress-legend').textContent).toBe('Sessions')
  })

  it('a context dot shows its workout chip in the strip and no delta', () => {
    render(<ProgressChart {...base} linePoints={line} contextDots={ctx} selectedSessionId="jr" />)
    expect(screen.getByTestId('progress-strip-shape').textContent).toBe('Just Row')
    expect(screen.queryByTestId('progress-strip-delta')).toBeNull()
  })

  it('a line dot shows the delta and no workout chip', () => {
    render(<ProgressChart {...base} linePoints={line} contextDots={ctx} selectedSessionId="b" />)
    expect(screen.queryByTestId('progress-strip-shape')).toBeNull()
    expect(screen.getByTestId('progress-strip-delta')).toBeInTheDocument()
  })
})
