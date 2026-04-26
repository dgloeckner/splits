import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { WorkoutFlowProvider, useWorkoutFlow, type FlowMode } from './WorkoutFlowProvider'
import { Step2Dimension } from './Step2Dimension'

function Harness({ out }: { out: { step: unknown; state: any } }) {
  const { state } = useWorkoutFlow()
  out.step = state.step
  out.state = state
  return <Step2Dimension />
}

function renderHarness(mode: FlowMode) {
  const out = { step: 0 as unknown, state: null as any }
  render(
    <MemoryRouter initialEntries={['/flow']}>
      <Routes>
        <Route
          path="/flow"
          element={
            <WorkoutFlowProvider mode={mode}>
              <Harness out={out} />
            </WorkoutFlowProvider>
          }
        />
        <Route path="/" element={<div>HOME</div>} />
      </Routes>
    </MemoryRouter>,
  )
  return out
}

describe('Step2Dimension – distance', () => {
  it('preset tap sets meters and advances to step 3', async () => {
    const out = renderHarness('distance')
    await userEvent.click(await screen.findByRole('button', { name: '5 km' }))
    expect(out.state.distanceMeters).toBe(5000)
    expect(out.step).toBe(3)
  })

  it('2 km preset sets correct meters', async () => {
    const out = renderHarness('distance')
    await userEvent.click(await screen.findByRole('button', { name: '2 km' }))
    expect(out.state.distanceMeters).toBe(2000)
    expect(out.step).toBe(3)
  })

  it('Eigene chip reveals stepper; + increments; Übernehmen dispatches and advances', async () => {
    const out = renderHarness('distance')
    await userEvent.click(await screen.findByRole('button', { name: /eigene/i }))
    // default 3000 m; + once → 3500 m
    const plus = screen.getByRole('button', { name: /^\+$/ })
    await userEvent.click(plus)
    await userEvent.click(screen.getByRole('button', { name: /übernehmen/i }))
    expect(out.state.distanceMeters).toBe(3500)
    expect(out.step).toBe(3)
  })

  it('Eigene stepper − decrements correctly', async () => {
    const out = renderHarness('distance')
    await userEvent.click(await screen.findByRole('button', { name: /eigene/i }))
    // default 3000 m; − once → 2500 m
    const minus = screen.getByRole('button', { name: /^−$/ })
    await userEvent.click(minus)
    await userEvent.click(screen.getByRole('button', { name: /übernehmen/i }))
    expect(out.state.distanceMeters).toBe(2500)
    expect(out.step).toBe(3)
  })

  it('Eigene stepper does not go below min (500 m)', async () => {
    const out = renderHarness('distance')
    await userEvent.click(await screen.findByRole('button', { name: /eigene/i }))
    // default 3000; click − many times → should clamp at 500
    const minus = screen.getByRole('button', { name: /^−$/ })
    for (let i = 0; i < 20; i++) await userEvent.click(minus)
    await userEvent.click(screen.getByRole('button', { name: /übernehmen/i }))
    expect(out.state.distanceMeters).toBe(500)
    expect(out.step).toBe(3)
  })
})

describe('Step2Dimension – time', () => {
  it('preset tap sets seconds and advances to step 3', async () => {
    const out = renderHarness('time')
    await userEvent.click(await screen.findByRole('button', { name: '30 min' }))
    expect(out.state.timeSeconds).toBe(1800)
    expect(out.step).toBe(3)
  })

  it('Eigene time flow: + increments by 5 min, Übernehmen dispatches', async () => {
    const out = renderHarness('time')
    await userEvent.click(await screen.findByRole('button', { name: /eigene/i }))
    // default 15 min = 900 s; + once → 1200 s
    await userEvent.click(screen.getByRole('button', { name: /^\+$/ }))
    await userEvent.click(screen.getByRole('button', { name: /übernehmen/i }))
    expect(out.state.timeSeconds).toBe(1200)
    expect(out.step).toBe(3)
  })

  it('Eigene time stepper does not go below 1 min', async () => {
    const out = renderHarness('time')
    await userEvent.click(await screen.findByRole('button', { name: /eigene/i }))
    const minus = screen.getByRole('button', { name: /^−$/ })
    for (let i = 0; i < 20; i++) await userEvent.click(minus)
    await userEvent.click(screen.getByRole('button', { name: /übernehmen/i }))
    expect(out.state.timeSeconds).toBe(60) // 1 min min
    expect(out.step).toBe(3)
  })
})

describe('Step2Dimension – intervals', () => {
  it('preset tap sets intervals and advances to step 3', async () => {
    const out = renderHarness('intervals')
    await userEvent.click(await screen.findByRole('button', { name: '4×2000 m' }))
    expect(out.state.intervals).toEqual({ reps: 4, length: { unit: 'm', value: 2000 }, rest_sec: 300 })
    expect(out.step).toBe(3)
  })

  it('8×500 m preset sets correct state', async () => {
    const out = renderHarness('intervals')
    await userEvent.click(await screen.findByRole('button', { name: '8×500 m' }))
    expect(out.state.intervals).toEqual({ reps: 8, length: { unit: 'm', value: 500 }, rest_sec: 120 })
    expect(out.step).toBe(3)
  })

  it('Eigene intervals: adjust rounds, length, rest, Übernehmen dispatches correct state', async () => {
    const out = renderHarness('intervals')
    await userEvent.click(await screen.findByRole('button', { name: /eigene/i }))

    // Rounds: default 4; + once → 5
    const [roundsPlus] = screen.getAllByRole('button', { name: /^\+$/ })
    await userEvent.click(roundsPlus)
    // Now rounds = 5

    // Length: default 500 m; + ten times → 1500 m (step 100)
    const allPlus = screen.getAllByRole('button', { name: /^\+$/ })
    const lengthPlus = allPlus[1]
    for (let i = 0; i < 10; i++) await userEvent.click(lengthPlus)
    // length = 1500 m

    // Rest: default 120 s; − once → 90 s (step 30)
    const allMinus = screen.getAllByRole('button', { name: /^−$/ })
    const restMinus = allMinus[2]
    await userEvent.click(restMinus)
    // rest = 90 s

    await userEvent.click(screen.getByRole('button', { name: /übernehmen/i }))
    expect(out.state.intervals).toEqual({ reps: 5, length: { unit: 'm', value: 1500 }, rest_sec: 90 })
    expect(out.step).toBe(3)
  })

  it('Eigene intervals: toggle to Minuten changes unit', async () => {
    const out = renderHarness('intervals')
    await userEvent.click(await screen.findByRole('button', { name: /eigene/i }))

    // Toggle to Minuten
    await userEvent.click(screen.getByRole('button', { name: /minuten/i }))

    // length default for min = 2; + once → 3
    const allPlus = screen.getAllByRole('button', { name: /^\+$/ })
    await userEvent.click(allPlus[1])

    await userEvent.click(screen.getByRole('button', { name: /übernehmen/i }))
    expect(out.state.intervals?.length.unit).toBe('min')
    expect(out.state.intervals?.length.value).toBe(3)
    expect(out.step).toBe(3)
  })
})

describe('Step2Dimension – back navigation', () => {
  it('back button navigates home', async () => {
    renderHarness('distance')
    await screen.findByRole('button', { name: /eigene/i })
    await userEvent.click(screen.getByRole('button', { name: /zurück/i }))
    expect(screen.getByText('HOME')).toBeInTheDocument()
  })
})
