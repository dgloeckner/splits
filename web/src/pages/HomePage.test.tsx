import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Routes, Route, useParams } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { HomePage } from './HomePage'

vi.mock('../api/rowers', () => ({ getActiveRower: vi.fn(async () => null) }))

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
})
