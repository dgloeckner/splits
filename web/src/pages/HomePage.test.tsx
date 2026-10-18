import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Routes, Route, useParams } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { HomePage } from './HomePage'
import { setErgoStatus, _resetErgoStatusForTest } from '../offline/ergoStatus'

vi.mock('../api/rowers', () => ({ getActiveRower: vi.fn(async () => null) }))
vi.mock('../app/toastBus', () => ({ showToast: vi.fn() }))
import { showToast } from '../app/toastBus'

const originalFetch = global.fetch
afterEach(() => {
  global.fetch = originalFetch
})

function FlowStub() {
  const { mode } = useParams()
  return <div>FLOW:{mode}</div>
}

function renderHome() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/live" element={<div>LIVE</div>} />
          <Route path="/workout/new/:mode" element={<FlowStub />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('HomePage', () => {
  beforeEach(() => {
    _resetErgoStatusForTest()
    setErgoStatus({ reachable: true })
  })

  it('renders the page heading', () => {
    renderHome()
    expect(screen.getByRole('heading', { name: /home/i })).toBeInTheDocument()
  })

  it('Nur rudern hero starts session and navigates to /live', async () => {
    let started = false
    global.fetch = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      if (String(url) === '/api/v1/session/start' && init?.method === 'POST') {
        started = true
        return new Response(null, { status: 200 })
      }
      return new Response('', { status: 404 })
    }) as typeof fetch
    renderHome()
    await userEvent.click(screen.getByRole('button', { name: /nur rudern/i }))
    await waitFor(() => expect(screen.getByText('LIVE')).toBeInTheDocument())
    expect(started).toBe(true)
  })

  it.each([
    ['Distanz', 'distance'],
    ['Zeit', 'time'],
    ['Intervalle', 'intervals'],
  ])('%s tile navigates to /workout/new/%s', async (label, mode) => {
    renderHome()
    await userEvent.click(screen.getByRole('button', { name: new RegExp(label, 'i') }))
    expect(await screen.findByText(`FLOW:${mode}`)).toBeInTheDocument()
  })

  it('renders Rennen chip and navigates to /workout/new/race', async () => {
    renderHome()
    await userEvent.click(screen.getByTestId('picker-race'))
    expect(await screen.findByText('FLOW:race')).toBeInTheDocument()
  })

  it('unreachable: hero card shown, start buttons disabled', async () => {
    setErgoStatus({ reachable: false, packedAt: '2026-06-12T18:42:00' })
    renderHome()
    expect(await screen.findByTestId('ergo-offline-hero')).toBeInTheDocument()
    expect(screen.getByTestId('picker-just-row')).toBeDisabled()
    expect(screen.getByTestId('picker-distance')).toBeDisabled()
  })

  it('reachable: no hero card', async () => {
    setErgoStatus({ reachable: true })
    renderHome()
    expect(screen.queryByTestId('ergo-offline-hero')).toBeNull()
  })

  // ADR-0021: until the first probe lands, starts are held neutrally —
  // no hero, no tap that runs into a timeout.
  it('unknown: starts held with „Suche Ergo…“, no hero', async () => {
    setErgoStatus({ reachable: 'unknown', packedAt: '2026-06-12T18:42:00' })
    renderHome()
    expect(screen.getByTestId('ergo-searching')).toHaveTextContent('Suche Ergo…')
    expect(screen.getByTestId('picker-just-row')).toBeDisabled()
    expect(screen.getByTestId('picker-race')).toBeDisabled()
    expect(screen.queryByTestId('ergo-offline-hero')).toBeNull()
    // Visibly held too, not just disabled in the DOM.
    expect(screen.getByTestId('picker-just-row').closest('section')!.className).toMatch(/startDimmed/)
  })

  it('reachable: starts enabled, no „Suche Ergo…“', async () => {
    setErgoStatus({ reachable: true })
    renderHome()
    expect(screen.getByTestId('picker-just-row')).toBeEnabled()
    expect(screen.queryByTestId('ergo-searching')).toBeNull()
  })

  it('shows a toast instead of hanging when session start fails', async () => {
    global.fetch = vi.fn(async () => {
      throw new TypeError('Load failed')
    }) as typeof fetch
    setErgoStatus({ packedAt: '2026-06-12T18:42:00' })
    renderHome()
    await userEvent.click(screen.getByRole('button', { name: /nur rudern/i }))
    await waitFor(() => expect(showToast).toHaveBeenCalled())
    // ADR-0021 §4: the start failure offers „Offline weiter“ when a
    // local snapshot exists (here: a packed bag).
    const [text, , action] = vi.mocked(showToast).mock.calls.at(-1)!
    expect(text).toBe('Start fehlgeschlagen — Ergo nicht erreichbar?')
    expect(action).toMatchObject({ label: 'Offline weiter' })
    expect(screen.queryByText('LIVE')).not.toBeInTheDocument()
  })
})
