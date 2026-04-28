import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { PairingModal } from './PairingModal'

const realFetch = global.fetch

beforeEach(() => {
  ;(global as unknown as { fetch: typeof fetch }).fetch = realFetch
})
afterEach(() => {
  ;(global as unknown as { fetch: typeof fetch }).fetch = realFetch
})

function withProviders(node: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={qc}>{node}</QueryClientProvider>
}

describe('PairingModal', () => {
  it('shows two action choices', () => {
    ;(global as unknown as { fetch: typeof fetch }).fetch = (async () =>
      new Response(JSON.stringify({ rowers: [] }), { status: 200 })) as unknown as typeof fetch
    render(withProviders(<PairingModal open onClose={() => {}} activeRowerID="R1" />))
    expect(screen.getByText(/Neuer Ruderer/)).toBeTruthy()
    expect(screen.getByText(/Pairing-Link/)).toBeTruthy()
  })

  it('mint flow shows URL + QR after success', async () => {
    ;(global as unknown as { fetch: typeof fetch }).fetch = (async (url: RequestInfo) => {
      const u = String(url)
      if (u.includes('/pairing-tokens')) {
        return new Response(
          JSON.stringify({
            token: 'abc',
            url: 'https://h/pair#t=abc',
            qr_svg: '<svg data-testid="qr"></svg>',
            expires_at: '2026-04-29T00:00:00Z',
          }),
          { status: 200 },
        )
      }
      return new Response(JSON.stringify({ rowers: [{ id: 'R1', name: 'Alice', color: '#000', created_at: '' }] }), { status: 200 })
    }) as unknown as typeof fetch

    render(withProviders(<PairingModal open onClose={() => {}} activeRowerID="R1" />))
    fireEvent.click(screen.getByText(/Pairing-Link/))
    fireEvent.click(screen.getByRole('button', { name: /Link erzeugen/i }))
    await waitFor(() => expect(screen.getByText('https://h/pair#t=abc')).toBeTruthy())
  })

  it('create-rower flow posts to /api/v1/rowers and closes', async () => {
    const onClose = vi.fn()
    ;(global as unknown as { fetch: typeof fetch }).fetch = (async (url: RequestInfo, init?: RequestInit) => {
      const u = String(url)
      if (u === '/api/v1/rowers' && init?.method === 'POST') {
        return new Response(JSON.stringify({ id: 'R2', name: 'Bob', color: '#000', created_at: '' }), { status: 201 })
      }
      return new Response(JSON.stringify({ rowers: [] }), { status: 200 })
    }) as unknown as typeof fetch

    render(withProviders(<PairingModal open onClose={onClose} activeRowerID="R1" />))
    fireEvent.click(screen.getByText(/Neuer Ruderer/))
    fireEvent.change(screen.getByLabelText(/Name/i), { target: { value: 'Bob' } })
    fireEvent.click(screen.getByRole('button', { name: /^Anlegen$/i }))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
  })
})
