import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { StatBar } from './StatBar'

describe('StatBar', () => {
  const base = { splitSec: 108, distanceLeftM: 780, watts: 285, spm: 24, vsPbSec: -3.2, vsGhostSec: 12 }

  it('phone portrait shows 4 cells with leader gap', () => {
    render(<StatBar variant="phone" {...base} />)
    expect(screen.getByText('1:48')).toBeTruthy()
    expect(screen.getByText('780 m')).toBeTruthy()
    expect(screen.getByText('285 W')).toBeTruthy()
    // vsPbSec=-3.2 (user faster than PB), vsGhostSec=+12 (user slower than ghost) → ghost leads
    expect(screen.getByText(/Ghost.*\+12/)).toBeTruthy()
  })

  it('tablet shows 6 cells with both gaps separately', () => {
    render(<StatBar variant="tablet" {...base} />)
    expect(screen.getByText('1:48')).toBeTruthy()
    expect(screen.getByText('780 m')).toBeTruthy()
    expect(screen.getByText('285 W')).toBeTruthy()
    expect(screen.getByText('24')).toBeTruthy()
    expect(screen.getByText(/-3\.2/)).toBeTruthy()
    expect(screen.getByText(/\+12/)).toBeTruthy()
  })

  it('phone falls back to ghost gap when pb is null', () => {
    render(<StatBar variant="phone" {...base} vsPbSec={null} />)
    expect(screen.getByText(/Ghost.*\+12/)).toBeTruthy()
  })

  it('phone shows pb gap when ghost is null', () => {
    render(<StatBar variant="phone" {...base} vsGhostSec={null} />)
    expect(screen.getByText(/PB/)).toBeTruthy()
  })
})
