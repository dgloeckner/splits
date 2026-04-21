import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { RowerGate } from './RowerGate'

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
  it('redirects to /onboarding when no rower exists', async () => {
    wrap('/')
    await waitFor(() => expect(screen.getByText('ONBOARD')).toBeInTheDocument())
  })
})
