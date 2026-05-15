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

function Harness({
  setup,
  distanceMeters,
}: {
  setup: 'distance' | 'intervals' | 'race'
  distanceMeters?: number
}) {
  const { state, dispatch } = useWorkoutFlow()
  const initialized = useRef(false)
  useEffect(() => {
    if (!initialized.current) {
      initialized.current = true
      if (setup === 'distance') {
        dispatch({ type: 'SELECT_MODE', mode: 'distance' })
        dispatch({ type: 'SET_DISTANCE', meters: distanceMeters ?? 5000 })
      } else if (setup === 'race') {
        dispatch({ type: 'SELECT_MODE', mode: 'race' })
        dispatch({ type: 'SET_DISTANCE', meters: distanceMeters ?? 2000 })
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

  it('renders title for race with km label', async () => {
    mockRoutes({})
    wrap(<Harness setup="race" />)
    expect(await screen.findByRole('heading', { name: /2 km Rennen/i })).toBeInTheDocument()
  })

  // F11: HM/Marathon dropped — household rowers don't use those
  // distances. Tests for those labels removed.

  // F3: custom Eigene meters that are not exact km multiples used to
  // fall through to raw metres on Confirm ("3500 m") even though
  // Step2 shows the value as "3.5 km". Same value, two labels. Now
  // unified via the shared formatDistanceLabel helper.
  it('renders Eigene custom 3500 m as "3.5 km" (parity with Step2)', async () => {
    mockRoutes({})
    wrap(<Harness setup="distance" distanceMeters={3500} />)
    expect(await screen.findByRole('heading', { name: /3\.5 km · moderat/i })).toBeInTheDocument()
  })

  it('race mode header reads "Übersicht" (not "Bereit")', async () => {
    mockRoutes({})
    wrap(<Harness setup="race" />)
    expect(await screen.findByRole('heading', { name: /Übersicht/i })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: /^Bereit$/i })).toBeNull()
  })

  it('race mode shows inline opponent toggles (synth-ghost + PB) with no separate sheet', async () => {
    mockRoutes({})
    wrap(<Harness setup="race" />)
    await screen.findByRole('heading', { name: /Übersicht/i })
    expect(
      screen.getByRole('checkbox', { name: /Synthetischer Geist nach Härte/i }),
    ).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: /Bestzeit/i })).toBeInTheDocument()
    // No standalone picker sheet is mounted.
    expect(screen.queryByRole('button', { name: /Rennen starten/i })).toBeNull()
  })

  it('race mode opponent toggles default to checked', async () => {
    mockRoutes({})
    wrap(<Harness setup="race" />)
    const ghost = await screen.findByRole('checkbox', { name: /Synthetischer Geist nach Härte/i })
    const pb = screen.getByRole('checkbox', { name: /Bestzeit/i })
    expect((ghost as HTMLInputElement).checked).toBe(true)
    expect((pb as HTMLInputElement).checked).toBe(true)
  })

  it('toggling synth-ghost off shows "Intensität wirkt sich nicht aus." note; on hides it', async () => {
    mockRoutes({})
    wrap(<Harness setup="race" />)
    const ghost = await screen.findByRole('checkbox', { name: /Synthetischer Geist nach Härte/i })
    expect(screen.queryByText(/Intensität wirkt sich nicht aus\./i)).toBeNull()
    await userEvent.click(ghost)
    expect(screen.getByText(/Intensität wirkt sich nicht aus\./i)).toBeInTheDocument()
    await userEvent.click(ghost)
    expect(screen.queryByText(/Intensität wirkt sich nicht aus\./i)).toBeNull()
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

  it('race Start: no picker sheet, calls workout-create + startSession once, writes selection, navigates', async () => {
    let postCount = 0
    let started = 0
    mockRoutes({
      '/api/v1/workouts': (init) => {
        if (init?.method === 'POST') postCount++
        return { body: JSON.stringify({ id: 'W1', mode: 'race', params: { meters: 2000 }, warmup_sec: 0, cooldown_sec: 0, created_at: '2026-04-23T00:00:00Z' }), status: 201 }
      },
      '/api/v1/session/start': () => { started++; return { body: null, status: 204 } },
    })
    sessionStorage.removeItem('race-opp-selection')
    wrap(<Harness setup="race" />)
    await screen.findByRole('heading', { name: /Übersicht/i })
    // Toggle PB off so we can verify the persisted selection matches user state.
    await userEvent.click(screen.getByRole('checkbox', { name: /Bestzeit/i }))
    await userEvent.click(screen.getByRole('button', { name: /^start$/i }))
    await waitFor(() => expect(screen.getByText('LIVE')).toBeInTheDocument())
    expect(postCount).toBe(1)
    expect(started).toBe(1)
    // No picker sheet opened during the Start path.
    expect(screen.queryByRole('button', { name: /Rennen starten/i })).toBeNull()
    const stored = sessionStorage.getItem('race-opp-selection')
    expect(stored).not.toBeNull()
    expect(JSON.parse(stored!)).toEqual({ ghost: true, pb: false })
  })

  it('does not create a favorite for race mode even if checkbox is on', async () => {
    let favCalled = false
    mockRoutes({
      '/api/v1/workouts': () => ({ body: JSON.stringify({ id: 'W1', mode: 'race', params: { meters: 2000 }, warmup_sec: 0, cooldown_sec: 0, created_at: '2026-04-23T00:00:00Z' }), status: 201 }),
      '/api/v1/session/start': () => ({ body: null, status: 204 }),
      '/api/v1/favorites': (init) => {
        if (init?.method === 'POST') favCalled = true
        return { body: JSON.stringify({}), status: 201 }
      },
    })
    sessionStorage.removeItem('race-opp-selection')
    wrap(<Harness setup="race" />)
    await userEvent.click(await screen.findByRole('checkbox', { name: /als favorit speichern/i }))
    await userEvent.type(await screen.findByRole('textbox', { name: /favoritenname/i }), 'My Race')
    await userEvent.click(screen.getByRole('button', { name: /^start$/i }))
    await waitFor(() => expect(screen.getByText('LIVE')).toBeInTheDocument())
    expect(favCalled).toBe(false)
  })

  it('hides warmup and cooldown toggles for race mode', async () => {
    mockRoutes({})
    wrap(<Harness setup="race" />)
    await screen.findByRole('heading', { name: /2 km Rennen/i })
    expect(screen.queryByRole('checkbox', { name: /warm-up/i })).toBeNull()
    expect(screen.queryByRole('checkbox', { name: /cool-down/i })).toBeNull()
  })

  it('shows warmup and cooldown toggles for non-race mode', async () => {
    mockRoutes({})
    wrap(<Harness setup="distance" />)
    await screen.findByRole('heading', { name: /5 km/i })
    expect(screen.getByRole('checkbox', { name: /warm-up/i })).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: /cool-down/i })).toBeInTheDocument()
  })

  it('race submission forces warmup_sec=0 and cooldown_sec=0', async () => {
    let postedBody: any = null
    mockRoutes({
      '/api/v1/workouts': (init) => {
        if (init?.method === 'POST') postedBody = JSON.parse(init.body as string)
        return { body: JSON.stringify({ id: 'W1', mode: 'race', params: { meters: 2000 }, warmup_sec: 0, cooldown_sec: 0, created_at: '2026-04-23T00:00:00Z' }), status: 201 }
      },
      '/api/v1/workouts/W1/opponents': () => ({
        body: JSON.stringify({ ghost: null, pb: null }),
        status: 200,
      }),
      '/api/v1/session/start': () => ({ body: null, status: 204 }),
    })
    sessionStorage.removeItem('race-opp-selection')
    wrap(<Harness setup="race" />)
    await userEvent.click(await screen.findByRole('button', { name: /^start$/i }))
    await waitFor(() => expect(postedBody).not.toBeNull())
    expect(postedBody?.mode).toBe('race')
    expect(postedBody?.warmup_sec).toBe(0)
    expect(postedBody?.cooldown_sec).toBe(0)
  })

  // Back-nav moved to WorkoutFlowPage's unified flow header
  // (F1+F2). Covered by WorkoutFlowPage.test.tsx.
})
