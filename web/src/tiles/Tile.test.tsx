import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Tile } from './Tile'
import { initialLiveState, liveReducer, type LiveState } from '../live/reducer'
import { LiveSessionContext } from '../live/LiveSessionContext'

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return (
    <QueryClientProvider client={qc}>
      <LiveSessionContext.Provider value={initialLiveState}>
        {children}
      </LiveSessionContext.Provider>
    </QueryClientProvider>
  )
}

function stateWithStroke(): LiveState {
  return liveReducer(initialLiveState, {
    type: 'event',
    event: {
      kind: 'stroke',
      id: 1,
      data: {
        session_id: 'S',
        stroke: 1,
        time_sec: 10,
        distance_m: 42,
        spm: 25,
        power_w: 210,
        cal_per_hr: 800,
        level: 3,
        dps: 8.2,
        stroke_cycle_sec: 2.4,
        pace_sec_per_500m: 125,
        energy_joules: 500,
      },
    },
  })
}

describe('Tile', () => {
  it('renders a numeric tile', () => {
    render(<Tile tileId="watt" state={stateWithStroke()} />, { wrapper })
    expect(screen.getByText('Watt')).toBeInTheDocument()
    expect(screen.getByText('210')).toBeInTheDocument()
  })

  it('renders a sparkline tile with a "sammle Daten…" placeholder on single point', () => {
    const { container } = render(<Tile tileId="watt-verlauf" state={stateWithStroke()} />, { wrapper })
    expect(screen.getByText('Watt')).toBeInTheDocument()
    expect(container.textContent).toContain('sammle Daten')
  })

  it('HR-gated tile renders in a disabled appearance', () => {
    const { container } = render(<Tile tileId="herzfrequenz" state={stateWithStroke()} />, { wrapper })
    const root = container.firstElementChild as HTMLElement
    expect(root.className).toMatch(/disabled/)
  })

  it('falls back for unknown tile ids', () => {
    render(<Tile tileId="bogus-metric" state={stateWithStroke()} />, { wrapper })
    expect(screen.getByText('bogus-metric')).toBeInTheDocument()
  })
})
