import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider, onlineManager } from '@tanstack/react-query'
import { queryDefaults } from '../api/queryDefaults'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { RowerGate } from './RowerGate'
import { listRowers, getActiveRower } from '../api/rowers'
import { setErgoStatus, _resetErgoStatusForTest } from '../offline/ergoStatus'
import { recordBootstrapQuery, _resetBootstrapMirrorForTest } from '../offline/bootstrapMirror'

vi.mock('../api/rowers', () => ({
  listRowers: vi.fn(async () => []),
  getActiveRower: vi.fn(async () => null),
}))

function wrap(initial: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[initial]}>
        <Routes>
          <Route path="/onboarding" element={<div>ONBOARD</div>} />
          <Route element={<RowerGate />}>
            <Route path="/" element={<div>HOME</div>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('RowerGate', () => {
  beforeEach(() => {
    _resetErgoStatusForTest()
    vi.mocked(listRowers).mockReset().mockResolvedValue([])
    vi.mocked(getActiveRower).mockReset().mockResolvedValue(null)
  })

  it('redirects to /onboarding when no rower exists', async () => {
    wrap('/')
    await waitFor(() => expect(screen.getByText('ONBOARD')).toBeInTheDocument())
  })

  it('does not strand a registered user on onboarding from a stale empty persisted snapshot', async () => {
    const rower = { id: 'r1', name: 'Daniel', color: '#5dd7e4', created_at: '2026-05-03T19:01:59Z' }
    vi.mocked(listRowers).mockResolvedValue([rower as never])
    vi.mocked(getActiveRower).mockResolvedValue(rower as never)
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    // Hydrated from IndexedDB persistence: a stale empty snapshot. The
    // old updatedAt makes the mounted queries refetch and confirm the
    // real rower — the gate must wait for that, not flash onboarding.
    qc.setQueryData(['rowers'], [], { updatedAt: 1 })
    qc.setQueryData(['active-rower'], null, { updatedAt: 1 })
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={['/']}>
          <Routes>
            <Route path="/onboarding" element={<div>ONBOARD</div>} />
            <Route element={<RowerGate />}>
              <Route path="/" element={<div>HOME</div>} />
            </Route>
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )
    await waitFor(() => expect(screen.getByText('HOME')).toBeInTheDocument())
    expect(screen.queryByText('ONBOARD')).not.toBeInTheDocument()
  })

  it('shows bootstrap error screen with details instead of redirecting to /onboarding', async () => {
    setErgoStatus({ reachable: true })
    const { NetworkError } = await import('../api/error')
    vi.mocked(listRowers).mockRejectedValue(new NetworkError('/api/v1/rowers', new TypeError('Load failed')))
    vi.mocked(getActiveRower).mockRejectedValue(new NetworkError('/api/v1/active-rower', new TypeError('Load failed')))
    wrap('/')
    await waitFor(() =>
      expect(screen.getByText('Backend nicht erreichbar')).toBeInTheDocument(),
    )
    expect(screen.queryByText('ONBOARD')).not.toBeInTheDocument()
    // Underlying error detail visible to tech user.
    expect(screen.getByText(/Load failed/)).toBeInTheDocument()
    expect(screen.getByText(/\/api\/v1\/rowers/)).toBeInTheDocument()
  })

  it('shows the friendly offline screen (not the raw error) when the ergo is unreachable', async () => {
    setErgoStatus({ reachable: false })
    const { NetworkError } = await import('../api/error')
    vi.mocked(listRowers).mockRejectedValue(
      new NetworkError('/api/v1/rowers', new TypeError('Load failed')),
    )
    vi.mocked(getActiveRower).mockRejectedValue(
      new NetworkError('/api/v1/active-rower', new TypeError('Load failed')),
    )
    wrap('/')
    await waitFor(() =>
      expect(screen.getByText('Ergo nicht erreichbar')).toBeInTheDocument(),
    )
    // No developer diagnostics on the away-from-home path.
    expect(screen.queryByText(/Load failed/)).not.toBeInTheDocument()
    expect(screen.queryByText(/\/api\/v1\/rowers/)).not.toBeInTheDocument()
    // Manual reconnect trigger is present.
    expect(screen.getByRole('button', { name: 'Erneut verbinden' })).toBeInTheDocument()
    expect(screen.queryByText('ONBOARD')).not.toBeInTheDocument()
  })

  it('keeps the diagnostic screen when the backend is reachable but failing', async () => {
    setErgoStatus({ reachable: true })
    const { NetworkError } = await import('../api/error')
    vi.mocked(listRowers).mockRejectedValue(
      new NetworkError('/api/v1/rowers', new TypeError('Load failed')),
    )
    vi.mocked(getActiveRower).mockRejectedValue(
      new NetworkError('/api/v1/active-rower', new TypeError('Load failed')),
    )
    wrap('/')
    await waitFor(() =>
      expect(screen.getByText('Backend nicht erreichbar')).toBeInTheDocument(),
    )
    expect(screen.getByText(/Load failed/)).toBeInTheDocument()
  })
})

// Issue #4 / ADR-0021: in airplane mode react-query's default
// networkMode 'online' pauses the bootstrap queries — the queryFn (and
// with it the SW cache) is never asked and the gate spins forever.
describe('RowerGate in airplane mode (navigator.onLine === false)', () => {
  beforeEach(() => {
    _resetErgoStatusForTest()
    onlineManager.setOnline(false)
  })
  afterEach(() => onlineManager.setOnline(true))

  function wrapWithAppDefaults() {
    const qc = new QueryClient({ defaultOptions: { queries: { ...queryDefaults, retry: false } } })
    return render(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={['/']}>
          <Routes>
            <Route path="/onboarding" element={<div>ONBOARD</div>} />
            <Route element={<RowerGate />}>
              <Route path="/" element={<div>HOME</div>} />
            </Route>
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )
  }

  it('runs the bootstrap queries so a SW cache hit renders the app', async () => {
    const rower = { id: 'r1', name: 'Daniel', color: '#5dd7e4', created_at: '2026-05-03T19:01:59Z' }
    vi.mocked(listRowers).mockResolvedValue([rower as never])
    vi.mocked(getActiveRower).mockResolvedValue(rower as never)
    wrapWithAppDefaults()
    await waitFor(() => expect(screen.getByText('HOME')).toBeInTheDocument())
  })

  it('shows the friendly offline screen on a cache miss, not an endless loader', async () => {
    const { NetworkError } = await import('../api/error')
    vi.mocked(listRowers).mockRejectedValue(new NetworkError('/api/v1/rowers', new TypeError('offline')))
    vi.mocked(getActiveRower).mockRejectedValue(
      new NetworkError('/api/v1/active-rower', new TypeError('offline')),
    )
    setErgoStatus({ reachable: false })
    wrapWithAppDefaults()
    await waitFor(() => expect(screen.getByText('Ergo nicht erreichbar')).toBeInTheDocument())
    expect(screen.queryByText('Verbinde zum Backend…')).not.toBeInTheDocument()
  })
})

describe('RowerGate — local-first boot (ADR-0021)', () => {
  const rower = { id: 'r1', name: 'Daniel', color: '#5dd7e4', created_at: '2026-05-03T19:01:59Z' }

  beforeEach(() => {
    _resetErgoStatusForTest()
    localStorage.clear()
    _resetBootstrapMirrorForTest()
  })

  it('renders the app from the mirror when both bootstrap fetches fail', async () => {
    const { NetworkError } = await import('../api/error')
    recordBootstrapQuery(['rowers'], [rower])
    recordBootstrapQuery(['active-rower'], rower)
    vi.mocked(listRowers).mockRejectedValue(new NetworkError('/api/v1/rowers', new TypeError('x')))
    vi.mocked(getActiveRower).mockRejectedValue(
      new NetworkError('/api/v1/active-rower', new TypeError('x')),
    )
    setErgoStatus({ reachable: false })
    wrap('/')
    expect(screen.getByText('HOME')).toBeInTheDocument() // first render, no loader
    await waitFor(() => expect(vi.mocked(listRowers)).toHaveBeenCalled())
    await new Promise((r) => setTimeout(r, 20))
    expect(screen.getByText('HOME')).toBeInTheDocument()
    expect(screen.queryByTestId('bootstrap-offline')).not.toBeInTheDocument()
  })

  it('shows the loader, not the diagnostic, for a failure while reachability is unknown', async () => {
    const { NetworkError } = await import('../api/error')
    vi.mocked(listRowers).mockRejectedValue(new NetworkError('/api/v1/rowers', new TypeError('x')))
    vi.mocked(getActiveRower).mockRejectedValue(
      new NetworkError('/api/v1/active-rower', new TypeError('x')),
    )
    wrap('/')
    await waitFor(() => expect(vi.mocked(listRowers)).toHaveBeenCalled())
    await new Promise((r) => setTimeout(r, 20))
    expect(screen.queryByText('Backend nicht erreichbar')).not.toBeInTheDocument()
    expect(screen.queryByTestId('bootstrap-offline')).not.toBeInTheDocument()
    expect(screen.getByText('Verbinde zum Backend…')).toBeInTheDocument()
  })

  it('a never-paired device away from home gets the honest first-run copy', async () => {
    const { NetworkError } = await import('../api/error')
    vi.mocked(listRowers).mockRejectedValue(new NetworkError('/api/v1/rowers', new TypeError('x')))
    vi.mocked(getActiveRower).mockRejectedValue(
      new NetworkError('/api/v1/active-rower', new TypeError('x')),
    )
    setErgoStatus({ reachable: false })
    wrap('/')
    expect(await screen.findByTestId('bootstrap-offline')).toHaveTextContent(
      'Noch keine Unterwegs-Daten — einmal im Heimnetz öffnen',
    )
  })
})
