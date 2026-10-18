import { describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { LiveSessionProvider } from './LiveSessionProvider'
import { ConnectionBanner } from './ConnectionBanner'
import { MockChannel } from './channel'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { getErgoStatus, _resetErgoStatusForTest } from '../offline/ergoStatus'

function renderWithChannel(channel: MockChannel) {
  return render(
    <MemoryRouter initialEntries={['/live']}>
      <Routes>
        <Route path="/" element={<div>HOME</div>} />
        <Route
          path="/live"
          element={
            <LiveSessionProvider channel={channel}>
              <ConnectionBanner />
            </LiveSessionProvider>
          }
        />
      </Routes>
    </MemoryRouter>,
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

  // ADR-0021 §4: switch to the latched offline mode from the Live page.
  it('„Offline-Modus“ enters offline mode and goes Home', () => {
    _resetErgoStatusForTest()
    const ch = new MockChannel()
    renderWithChannel(ch)
    act(() => ch.setStatus('permanently_disconnected'))
    fireEvent.click(screen.getByRole('button', { name: 'Offline-Modus' }))
    expect(getErgoStatus()).toMatchObject({ mode: 'offline', reachable: false })
    expect(screen.getByText('HOME')).toBeInTheDocument()
  })
})
