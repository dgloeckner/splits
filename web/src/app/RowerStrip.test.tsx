import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { RowerStrip } from './RowerStrip'

const originalFetch = global.fetch

function mockFetchSequence(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString()
    return handler(url, init)
  }) as typeof fetch
}

function wrap() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <RowerStrip />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

const rowers = [
  { id: 'a', name: 'Alice', color: '#f00', created_at: '2026-04-21T00:00:00Z' },
  { id: 'b', name: 'Bob', color: '#0f0', created_at: '2026-04-21T00:00:00Z' },
]

afterEach(() => {
  global.fetch = originalFetch
})

describe('RowerStrip', () => {
  beforeEach(() => {
    global.fetch = originalFetch
  })

  it('shows pairing-required hint on 403 from active-rower PUT', async () => {
    mockFetchSequence((url, init) => {
      if (url === '/api/v1/rowers' && (!init || !init.method || init.method === 'GET')) {
        return new Response(JSON.stringify({ rowers }), { status: 200 })
      }
      if (url === '/api/v1/active-rower' && (!init || !init.method || init.method === 'GET')) {
        return new Response(JSON.stringify(rowers[0]), { status: 200 })
      }
      if (url === '/api/v1/active-rower' && init?.method === 'PUT') {
        return new Response(JSON.stringify({ error: 'forbidden' }), { status: 403 })
      }
      return new Response('not found', { status: 404 })
    })

    wrap()
    const bobBtn = await screen.findByRole('button', { name: 'Aktivieren: Bob' })
    await userEvent.click(bobBtn)
    await waitFor(() =>
      expect(
        screen.getByText('Dieses Profil ist nicht mit diesem Gerät verbunden.'),
      ).toBeInTheDocument(),
    )
  })

  it('shows generic error on 500 from active-rower PUT', async () => {
    mockFetchSequence((url, init) => {
      if (url === '/api/v1/rowers' && (!init || !init.method || init.method === 'GET')) {
        return new Response(JSON.stringify({ rowers }), { status: 200 })
      }
      if (url === '/api/v1/active-rower' && (!init || !init.method || init.method === 'GET')) {
        return new Response(JSON.stringify(rowers[0]), { status: 200 })
      }
      if (url === '/api/v1/active-rower' && init?.method === 'PUT') {
        return new Response('boom', { status: 500 })
      }
      return new Response('not found', { status: 404 })
    })

    wrap()
    const bobBtn = await screen.findByRole('button', { name: 'Aktivieren: Bob' })
    await userEvent.click(bobBtn)
    await waitFor(() =>
      expect(screen.getByText('Profilwechsel fehlgeschlagen.')).toBeInTheDocument(),
    )
    expect(
      screen.queryByText('Dieses Profil ist nicht mit diesem Gerät verbunden.'),
    ).not.toBeInTheDocument()
  })
})
