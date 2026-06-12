import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { HistoryPage } from './HistoryPage'

function mockFetch() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString()
      if (url.includes('/api/v1/active-rower')) {
        return new Response(
          JSON.stringify({ id: 'R', name: 'A', color: '#fff', created_at: '2026-04-21T00:00:00Z' }),
          { status: 200 },
        )
      }
      return new Response(JSON.stringify({}), { status: 200 })
    }),
  )
}

function wrap(initialPath = '/historie') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[initialPath]}>
        <Routes>
          <Route path="/historie" element={<HistoryPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('HistoryPage shell', () => {
  it('renders the sub-nav with Verlauf and Rekorde links', () => {
    mockFetch()
    wrap()
    expect(screen.getByRole('link', { name: 'Verlauf' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Rekorde' })).toBeInTheDocument()
  })
})
