import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { ErgoStandNotice } from './ErgoStandNotice'
import { setErgoStatus, _resetErgoStatusForTest } from './ergoStatus'

vi.mock('./reachability', () => ({ leaveOfflineMode: vi.fn() }))
import { leaveOfflineMode } from './reachability'

function renderNotice(variant: 'banner' | 'hero') {
  return render(
    <MemoryRouter>
      <ErgoStandNotice variant={variant} />
    </MemoryRouter>,
  )
}

describe('ErgoStandNotice', () => {
  beforeEach(() => _resetErgoStatusForTest())

  it('renders nothing while the Ergo is reachable', () => {
    setErgoStatus({ reachable: true, packedAt: '2026-06-12T18:42:00' })
    renderNotice('banner')
    expect(screen.queryByTestId('ergo-stand-banner')).toBeNull()
  })

  // ADR-0021: 'unknown' renders neutrally — no flash of the hero at home.
  it('renders nothing while reachability is still unknown', () => {
    setErgoStatus({ packedAt: '2026-06-12T18:42:00' })
    renderNotice('hero')
    renderNotice('banner')
    expect(screen.queryByTestId('ergo-offline-hero')).toBeNull()
    expect(screen.queryByTestId('ergo-stand-banner')).toBeNull()
  })

  it('banner shows the canonical copy with the Stand', () => {
    setErgoStatus({ reachable: false, packedAt: '2026-06-12T18:42:00', packedSessions: 10 })
    renderNotice('banner')
    expect(screen.getByTestId('ergo-stand-banner').textContent).toBe(
      'Ergo nicht erreichbar · Stand: 12. Juni, 18:42',
    )
  })

  it('banner degrades without a Stand (never packed)', () => {
    setErgoStatus({ reachable: false })
    renderNotice('banner')
    expect(screen.getByTestId('ergo-stand-banner').textContent).toBe('Ergo nicht erreichbar')
  })

  it('hero shows title, Stand and the Verlauf CTA', () => {
    setErgoStatus({ reachable: false, packedAt: '2026-06-12T18:42:00', packedSessions: 10 })
    renderNotice('hero')
    expect(screen.getByTestId('ergo-offline-hero')).toBeInTheDocument()
    expect(screen.getByText('Ergo nicht erreichbar')).toBeInTheDocument()
    expect(screen.getByText('Stand: 12. Juni, 18:42')).toBeInTheDocument()
    expect(screen.getByTestId('ergo-offline-cta')).toHaveAttribute('href', '/historie')
  })

  // ADR-0021 §4: „Erneut verbinden“ leaves the latched offline mode
  // (and probes at once).
  it('hero reconnect button leaves offline mode', async () => {
    setErgoStatus({ reachable: false, mode: 'offline' })
    renderNotice('hero')
    await userEvent.click(screen.getByTestId('ergo-reconnect'))
    expect(leaveOfflineMode).toHaveBeenCalledTimes(1)
  })

  it('the Stand banner offers „Erneut verbinden“ too', async () => {
    vi.mocked(leaveOfflineMode).mockClear()
    setErgoStatus({ reachable: false, mode: 'offline', packedAt: '2026-06-12T18:42:00' })
    renderNotice('banner')
    expect(screen.getByTestId('ergo-stand-banner')).toHaveTextContent(
      'Ergo nicht erreichbar · Stand: 12. Juni, 18:42',
    )
    await userEvent.click(screen.getByTestId('ergo-banner-reconnect'))
    expect(leaveOfflineMode).toHaveBeenCalledTimes(1)
  })
})
