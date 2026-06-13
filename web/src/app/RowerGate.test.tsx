import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { RowerGate } from './RowerGate'
import { listRowers, getActiveRower } from '../api/rowers'

vi.mock('../api/rowers', () => ({
  listRowers: vi.fn(async () => []),
  getActiveRower: vi.fn(async () => null),
}))

function wrap(initial: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[initial]}>
        <Routes>
          <Route path="/onboarding" element={<div>ONBOARD</div>} />
          <Route element={<RowerGate />}>
            <Route path="/" element={<div>HOME</div>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('RowerGate', () => {
  beforeEach(() => {
    vi.mocked(listRowers).mockReset().mockResolvedValue([])
    vi.mocked(getActiveRower).mockReset().mockResolvedValue(null)
  })

  it('redirects to /onboarding when no rower exists', async () => {
    wrap('/')
    await waitFor(() => expect(screen.getByText('ONBOARD')).toBeInTheDocument())
  })

  it('does not strand a registered user on onboarding from a stale empty persisted snapshot', async () => {
    const rower = { id: 'r1', name: 'Daniel', color: '#5dd7e4', created_at: '2026-05-03T19:01:59Z' }
    vi.mocked(listRowers).mockResolvedValue([rower as never])
    vi.mocked(getActiveRower).mockResolvedValue(rower as never)
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    // Hydrated from IndexedDB persistence: a stale empty snapshot. The
    // old updatedAt makes the mounted queries refetch and confirm the
    // real rower — the gate must wait for that, not flash onboarding.
    qc.setQueryData(['rowers'], [], { updatedAt: 1 })
    qc.setQueryData(['active-rower'], null, { updatedAt: 1 })
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={['/']}>
          <Routes>
            <Route path="/onboarding" element={<div>ONBOARD</div>} />
            <Route element={<RowerGate />}>
              <Route path="/" element={<div>HOME</div>} />
            </Route>
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )
    await waitFor(() => expect(screen.getByText('HOME')).toBeInTheDocument())
    expect(screen.queryByText('ONBOARD')).not.toBeInTheDocument()
  })

  it('shows bootstrap error screen with details instead of redirecting to /onboarding', async () => {
    const { NetworkError } = await import('../api/error')
    vi.mocked(listRowers).mockRejectedValue(new NetworkError('/api/v1/rowers', new TypeError('Load failed')))
    vi.mocked(getActiveRower).mockRejectedValue(new NetworkError('/api/v1/active-rower', new TypeError('Load failed')))
    wrap('/')
    await waitFor(() =>
      expect(screen.getByText('Backend nicht erreichbar')).toBeInTheDocument(),
    )
    expect(screen.queryByText('ONBOARD')).not.toBeInTheDocument()
    // Underlying error detail visible to tech user.
    expect(screen.getByText(/Load failed/)).toBeInTheDocument()
    expect(screen.getByText(/\/api\/v1\/rowers/)).toBeInTheDocument()
  })
})
