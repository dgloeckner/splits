import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { HomePage } from './HomePage'

function renderHome() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/live" element={<div>LIVE</div>} />
        <Route path="/workout/new" element={<div>NEW WORKOUT</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('HomePage', () => {
  it('renders the page heading', () => {
    renderHome()
    expect(screen.getByRole('heading', { name: /home/i })).toBeInTheDocument()
  })

  it('Nur rudern tile navigates to /live', async () => {
    renderHome()
    await userEvent.click(screen.getByRole('button', { name: /nur rudern/i }))
    expect(screen.getByText('LIVE')).toBeInTheDocument()
  })

  it('Neues Workout tile navigates to /workout/new', async () => {
    renderHome()
    await userEvent.click(screen.getByRole('button', { name: /neues workout/i }))
    expect(screen.getByText('NEW WORKOUT')).toBeInTheDocument()
  })
})
