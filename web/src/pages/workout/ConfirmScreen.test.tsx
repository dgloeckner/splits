import { describe, it, expect, vi, afterEach } from 'vitest'
import { useEffect, useRef } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { WorkoutFlowProvider, useWorkoutFlow } from './WorkoutFlowProvider'
import { ConfirmScreen } from './ConfirmScreen'

vi.mock('../../api/rowers', () => ({
  getActiveRower: vi.fn(async () => ({ id: 'R1', name: 'A', color: '#fff', created_at: '2026-04-23T00:00:00Z' })),
}))

const origFetch = global.fetch
type R = { body: string | null; status: number }
function mockRoutes(routes: Record<string, R | ((init?: RequestInit) => R)>) {
  global.fetch = vi.fn(async (url, init) => {
    const raw = String(url); const key = raw.split('?')[0]
    const v = routes[raw] ?? routes[key]
    if (!v) return new Response('nope', { status: 404 })
    const r = typeof v === 'function' ? v(init) : v
    return new Response(r.body, { status: r.status, headers: r.body ? { 'content-type': 'application/json' } : undefined })
  }) as typeof fetch
}
afterEach(() => { global.fetch = origFetch })

function Harness({ setup }: { setup: 'distance' | 'intervals' }) {
  const { state, dispatch } = useWorkoutFlow()
  const initialized = useRef(false)
  useEffect(() => {
    if (!initialized.current) {
      initialized.current = true
      if (setup === 'distance') {
        dispatch({ type: 'SELECT_MODE', mode: 'distance' })
        dispatch({ type: 'SET_DISTANCE', meters: 5000 })
      } else {
        dispatch({ type: 'SELECT_MODE', mode: 'intervals' })
        dispatch({ type: 'SET_INTERVALS', intervals: { reps: 4, length: { unit: 'm', value: 500 }, rest_sec: 60 } })
      }
      dispatch({ type: 'GO_TO_STEP3' })
      dispatch({ type: 'SET_INTENSITY', intensity: 'moderat' })
      dispatch({ type: 'GO_TO_CONFIRM' })
    }
  }, [setup, dispatch])
  return state.step === 'confirm' ? <ConfirmScreen /> : null
}

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route path="/" element={<WorkoutFlowProvider>{ui}</WorkoutFlowProvider>} />
          <Route path="/live" element={<div>LIVE</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('ConfirmScreen', () => {
  it('renders title for distance', async () => {
    mockRoutes({})
    wrap(<Harness setup="distance" />)
    expect(await screen.findByRole('heading', { name: /5 km · moderat/i })).toBeInTheDocument()
  })

  it('timeline shows intervals as alternating work/rest', async () => {
    mockRoutes({})
    wrap(<Harness setup="intervals" />)
    const tl = await screen.findByTestId('timeline')
    // warmup + (work,rest)×3 + work + cooldown = 1 + 7 + 1 = 9 blocks
    expect(tl.children.length).toBe(9)
  })

  it('Start POSTs workout + attach + navigates', async () => {
    let postedBody: any = null
    let attached = false
    mockRoutes({
      '/api/v1/workouts': (init) => {
        if (init?.method === 'POST') postedBody = JSON.parse(init.body as string)
        return { body: JSON.stringify({ id: 'W1', mode: 'distance', params: { meters: 5000 }, warmup_sec: 300, cooldown_sec: 300, created_at: '2026-04-23T00:00:00Z' }), status: 201 }
      },
      '/api/v1/session/start': () => { attached = true; return { body: null, status: 204 } },
    })
    wrap(<Harness setup="distance" />)
    await userEvent.click(await screen.findByRole('button', { name: /start/i }))
    await waitFor(() => expect(screen.getByText('LIVE')).toBeInTheDocument())
    expect(postedBody?.mode).toBe('distance')
    expect(postedBody?.warmup_sec).toBe(300)
    expect(attached).toBe(true)
  })

  it('save-as-favorite triggers createFavorite', async () => {
    let favBody: any = null
    mockRoutes({
      '/api/v1/workouts': () => ({ body: JSON.stringify({ id: 'W1', mode: 'distance', params: { meters: 5000 }, warmup_sec: 300, cooldown_sec: 300, created_at: '2026-04-23T00:00:00Z' }), status: 201 }),
      '/api/v1/session/start': () => ({ body: null, status: 204 }),
      '/api/v1/favorites': (init) => {
        if (init?.method === 'POST') favBody = JSON.parse(init.body as string)
        return { body: JSON.stringify({ id: 'F1', rower_id: 'R1', name: 'My 5k', mode: 'distance', params: { meters: 5000 }, warmup_sec: 0, cooldown_sec: 0, created_at: '2026-04-23T00:00:00Z' }), status: 201 }
      },
    })
    wrap(<Harness setup="distance" />)
    await userEvent.click(await screen.findByRole('checkbox', { name: /als favorit speichern/i }))
    await userEvent.type(await screen.findByRole('textbox', { name: /favoritenname/i }), 'My 5k')
    await userEvent.click(screen.getByRole('button', { name: /start/i }))
    await waitFor(() => expect(favBody?.name).toBe('My 5k'))
  })

  it('Zurück dispatches GO_BACK (returns to step 3)', async () => {
    mockRoutes({})
    wrap(<Harness setup="distance" />)
    await userEvent.click(await screen.findByRole('button', { name: /zurück|anpassen/i }))
    // After back, ConfirmScreen unmounts — so timeline disappears
    await waitFor(() => expect(screen.queryByTestId('timeline')).toBeNull())
  })
})
