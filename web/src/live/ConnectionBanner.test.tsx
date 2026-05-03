import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { LiveSessionProvider } from './LiveSessionContext'
import { ConnectionBanner } from './ConnectionBanner'
import { MockChannel } from './channel'

function renderWithChannel(channel: MockChannel) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchInterval: false } },
  })
  return render(
    <QueryClientProvider client={qc}>
      <LiveSessionProvider channel={channel}>
        <ConnectionBanner />
      </LiveSessionProvider>
    </QueryClientProvider>,
  )
}

describe('ConnectionBanner', () => {
  beforeEach(() => {
    // Default: device endpoint reports connected — no banner from
    // device path interferes with these SSE-status tests.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ connected: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    )
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('hidden in normal states', () => {
    const ch = new MockChannel()
    renderWithChannel(ch)
    act(() => ch.setStatus('open'))
    expect(screen.queryByText(/Verbindung verloren/)).toBeNull()
    act(() => ch.setStatus('reconnecting'))
    expect(screen.queryByText(/Verbindung verloren/)).toBeNull()
  })

  it('shows when status is permanently_disconnected', () => {
    const ch = new MockChannel()
    renderWithChannel(ch)
    act(() => ch.setStatus('permanently_disconnected'))
    expect(screen.getByText(/Verbindung verloren/)).toBeTruthy()
    expect(screen.getByRole('button', { name: /Erneut verbinden/i })).toBeTruthy()
  })

  it('clicking the button calls channel.reconnect', () => {
    const ch = new MockChannel()
    const reconnect = vi.fn()
    ;(ch as MockChannel & { reconnect?: () => void }).reconnect = reconnect
    renderWithChannel(ch)
    act(() => ch.setStatus('permanently_disconnected'))
    fireEvent.click(screen.getByRole('button', { name: /Erneut verbinden/i }))
    expect(reconnect).toHaveBeenCalled()
  })
})
