import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Wartung } from './Wartung'

const originalFetch = global.fetch
afterEach(() => {
  global.fetch = originalFetch
  vi.restoreAllMocks()
})

function renderWartung() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <Wartung rowerID="R1" />
    </QueryClientProvider>,
  )
}

describe('Wartung', () => {
  it('renders session count, footprint, and lifetime distance', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('/lifetime')) {
          return new Response(
            JSON.stringify({ total_sessions: 42, total_distance_m: 12500 }),
            { status: 200 },
          )
        }
        return new Response(JSON.stringify({ sessions: [] }), { status: 200 })
      }),
    )
    renderWartung()
    await waitFor(() => expect(screen.getByText('42')).toBeInTheDocument())
    expect(screen.getByText('12.5 km')).toBeInTheDocument()
    expect(screen.getByText(/~50 kB/)).toBeInTheDocument()
  })

  it('switches kB → MB at the 1024 boundary', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('/lifetime')) {
          return new Response(
            JSON.stringify({ total_sessions: 1000, total_distance_m: 0 }),
            { status: 200 },
          )
        }
        return new Response(JSON.stringify({ sessions: [] }), { status: 200 })
      }),
    )
    renderWartung()
    await waitFor(() => expect(screen.getByText(/~1\.2 MB/)).toBeInTheDocument())
  })
})
