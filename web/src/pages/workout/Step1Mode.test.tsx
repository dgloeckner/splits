import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { WorkoutFlowProvider, useWorkoutFlow, type FlowMode } from './WorkoutFlowProvider'
import { Step1Mode } from './Step1Mode'

function Probe({ out }: { out: { step: unknown; mode?: FlowMode } }) {
  const { state } = useWorkoutFlow()
  out.step = state.step
  out.mode = state.mode
  return null
}

function render1(out: { step: unknown; mode?: FlowMode }, initial = '/workout/new') {
  return render(
    <MemoryRouter initialEntries={[initial]}>
      <Routes>
        <Route path="/workout/new" element={
          <WorkoutFlowProvider>
            <Step1Mode />
            <Probe out={out} />
          </WorkoutFlowProvider>
        } />
        <Route path="/" element={<div>HOME</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('Step1Mode', () => {
  it.each([
    ['Distanz', 'distance'],
    ['Zeit', 'time'],
    ['Intervalle', 'intervals'],
  ])('%s card dispatches SELECT_MODE(%s) and advances to step 2', async (label, mode) => {
    const out = { step: 1 as unknown, mode: undefined as FlowMode | undefined }
    render1(out)
    await userEvent.click(screen.getByRole('button', { name: label }))
    expect(out.step).toBe(2)
    expect(out.mode).toBe(mode)
  })

  it('Zurück navigates home', async () => {
    const out = { step: 1 as unknown }
    render1(out)
    await userEvent.click(screen.getByRole('button', { name: /zurück/i }))
    expect(screen.getByText('HOME')).toBeInTheDocument()
  })
})
