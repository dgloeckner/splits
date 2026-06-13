import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { OnboardingPage } from './OnboardingPage'

const createSpy = vi.fn(async (_input: unknown) => ({ id: 'a', name: 'Alice', color: '#ff6b6b', created_at: '2026-04-21T00:00:00Z' }))
const setActiveSpy = vi.fn(async (_id: unknown) => ({ id: 'a', name: 'Alice', color: '#ff6b6b', created_at: '2026-04-21T00:00:00Z' }))
const listSpy = vi.fn(async () => [] as unknown[])
const activeSpy = vi.fn(async () => null as unknown)

vi.mock('../api/rowers', () => ({
  createRower: (arg: unknown) => createSpy(arg),
  setActiveRower: (arg: unknown) => setActiveSpy(arg),
  listRowers: () => listSpy(),
  getActiveRower: () => activeSpy(),
}))

beforeEach(() => {
  listSpy.mockReset().mockResolvedValue([])
  activeSpy.mockReset().mockResolvedValue(null)
})

function wrap() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/onboarding']}>
        <Routes>
          <Route path="/onboarding" element={<OnboardingPage />} />
          <Route path="/" element={<div>HOME</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('OnboardingPage', () => {
  it('rejects empty name on submit', async () => {
    wrap()
    fireEvent.click(screen.getByRole('button', { name: /weiter/i }))
    expect(screen.getByText(/name erforderlich/i)).toBeInTheDocument()
  })

  it('redirects home when a rower already exists instead of trapping on the welcome form', async () => {
    const r = { id: 'r1', name: 'Daniel', color: '#5dd7e4', created_at: '2026-05-03T19:01:59Z' }
    listSpy.mockResolvedValue([r])
    activeSpy.mockResolvedValue(r)
    wrap()
    await waitFor(() => expect(screen.getByText('HOME')).toBeInTheDocument())
    expect(screen.queryByText(/willkommen/i)).not.toBeInTheDocument()
  })

  it('creates rower + sets active on valid submit', async () => {
    wrap()
    fireEvent.change(screen.getByLabelText(/name/i), { target: { value: 'Alice' } })
    fireEvent.click(screen.getByRole('button', { name: /weiter/i }))
    await waitFor(() => expect(createSpy).toHaveBeenCalled())
    await waitFor(() => expect(setActiveSpy).toHaveBeenCalledWith('a'))
    await waitFor(() => expect(screen.getByText('HOME')).toBeInTheDocument())
  })
})
