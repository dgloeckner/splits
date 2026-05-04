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
