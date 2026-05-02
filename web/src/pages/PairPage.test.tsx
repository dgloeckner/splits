import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { PairPage } from './PairPage'

const realFetch = global.fetch

beforeEach(() => {
  ;(global as unknown as { fetch: typeof fetch }).fetch = realFetch
})
afterEach(() => {
  ;(global as unknown as { fetch: typeof fetch }).fetch = realFetch
})

function withProviders(initialEntry: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <Routes>
          <Route path="/pair" element={<PairPage />} />
          <Route path="/" element={<div>HOME</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  )
}

describe('PairPage', () => {
  it('exchanges token from fragment and navigates home on success', async () => {
    const fetchSpy = vi.fn(async (url: RequestInfo, init?: RequestInit) => {
      expect(String(url)).toBe('/api/v1/pair')
      expect(JSON.parse(String(init?.body))).toEqual({ token: 'abc' })
      return new Response('', { status: 200 })
    })
    ;(global as unknown as { fetch: typeof fetch }).fetch = fetchSpy as unknown as typeof fetch
    render(withProviders('/pair#t=abc'))
    await waitFor(() => expect(screen.getByText('HOME')).toBeTruthy())
  })

  it('shows German message on 410 stale token', async () => {
    ;(global as unknown as { fetch: typeof fetch }).fetch = (async () =>
      new Response('gone', { status: 410 })) as unknown as typeof fetch
    render(withProviders('/pair#t=stale'))
    await waitFor(() =>
      expect(screen.getAllByText(/Code nicht mehr gültig/i).length).toBeGreaterThan(0),
    )
  })

  it('shows malformed message when fragment has no t=', async () => {
    render(withProviders('/pair'))
    await waitFor(() =>
      expect(screen.getByText(/Pairing-Link ungültig/i)).toBeTruthy(),
    )
  })
})
