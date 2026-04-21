import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { OnboardingPage } from './OnboardingPage'

const createSpy = vi.fn(async () => ({ id: 'a', name: 'Alice', color: '#ff6b6b', created_at: '2026-04-21T00:00:00Z' }))
const setActiveSpy = vi.fn(async () => ({ id: 'a', name: 'Alice', color: '#ff6b6b', created_at: '2026-04-21T00:00:00Z' }))

vi.mock('../api/rowers', () => ({
  createRower: (...args: unknown[]) => createSpy(...args),
  setActiveRower: (...args: unknown[]) => setActiveSpy(...args),
}))

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

  it('creates rower + sets active on valid submit', async () => {
    wrap()
    fireEvent.change(screen.getByLabelText(/name/i), { target: { value: 'Alice' } })
    fireEvent.click(screen.getByRole('button', { name: /weiter/i }))
    await waitFor(() => expect(createSpy).toHaveBeenCalled())
    await waitFor(() => expect(setActiveSpy).toHaveBeenCalledWith('a'))
    await waitFor(() => expect(screen.getByText('HOME')).toBeInTheDocument())
  })
})
