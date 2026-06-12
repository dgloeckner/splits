import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { ErgoStandNotice } from './ErgoStandNotice'
import { setErgoStatus, _resetErgoStatusForTest } from './ergoStatus'

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
    renderNotice('banner')
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
})
