import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ProfilePage } from './ProfilePage'
import { setErgoStatus, _resetErgoStatusForTest } from '../offline/ergoStatus'

function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <ProfilePage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('ProfilePage offline status line', () => {
  beforeEach(() => _resetErgoStatusForTest())

  it('shows the Unterwegs-Daten line once a pack exists', async () => {
    setErgoStatus({ packedAt: '2026-06-12T18:42:00', packedSessions: 10 })
    mount()
    expect(await screen.findByTestId('offline-stand')).toHaveTextContent(
      'Unterwegs-Daten: Stand 12. Juni, 18:42 · 10 Sessions',
    )
  })

  it('hides the line before any pack', async () => {
    mount()
    expect(screen.queryByTestId('offline-stand')).toBeNull()
  })
})
