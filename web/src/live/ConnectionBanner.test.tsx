import { describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { LiveSessionProvider } from './LiveSessionContext'
import { ConnectionBanner } from './ConnectionBanner'
import { MockChannel } from './channel'

function renderWithChannel(channel: MockChannel) {
  return render(
    <LiveSessionProvider channel={channel}>
      <ConnectionBanner />
    </LiveSessionProvider>,
  )
}

describe('ConnectionBanner', () => {
  it('hidden in normal states', () => {
    const ch = new MockChannel()
    renderWithChannel(ch)
    act(() => ch.setStatus('open'))
    expect(screen.queryByText(/Verbindung verloren/)).toBeNull()
    expect(screen.queryByText(/Rudergerät nicht verbunden/)).toBeNull()
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

  it('shows yellow when device disconnected event arrives', () => {
    const ch = new MockChannel()
    renderWithChannel(ch)
    act(() => ch.setStatus('open'))
    act(() =>
      ch.push({ kind: 'device', id: null, data: { connected: false } }),
    )
    expect(screen.getByText(/Rudergerät nicht verbunden/)).toBeTruthy()
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
