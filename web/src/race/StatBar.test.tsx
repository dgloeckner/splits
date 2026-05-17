import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { StatBar } from './StatBar'

describe('StatBar', () => {
  const base = {
    elapsedSec: 98,
    splitSec: 108,
    distanceLeftM: 780,
    watts: 285,
    spm: 24,
    vsPbSec: -3.2,
    vsGhostSec: 12,
  }

  it('phone portrait shows elapsed first, then distance-to-go, split, watts, leader gap', () => {
    render(<StatBar variant="phone" {...base} />)
    // elapsed 98 → 1:38, split 108 → 1:48
    const elapsedCell = screen.getByTestId('statbar-elapsed')
    const splitCell = screen.getByTestId('statbar-split')
    expect(elapsedCell.textContent).toBe('1:38')
    expect(splitCell.textContent).toBe('1:48')
    expect(screen.getByText('780 m')).toBeTruthy()
    expect(screen.getByText('285 W')).toBeTruthy()
    expect(screen.getByText(/Ghost.*\+12/)).toBeTruthy()
  })

  it('phone read-order: elapsed, distance-to-go, split, watts', () => {
    const { container } = render(<StatBar variant="phone" {...base} />)
    const cells = Array.from(container.querySelectorAll('[data-variant="phone"] > span'))
    expect(cells[0].getAttribute('data-testid')).toBe('statbar-elapsed')
    expect(cells[1].textContent).toBe('780 m')
    expect(cells[2].getAttribute('data-testid')).toBe('statbar-split')
    expect(cells[3].textContent).toBe('285 W')
  })

  it('tablet shows elapsed cell first, with both gaps separately', () => {
    render(<StatBar variant="tablet" {...base} />)
    expect(screen.getByTestId('statbar-elapsed').textContent).toBe('1:38')
    expect(screen.getByTestId('statbar-split').textContent).toBe('1:48')
    expect(screen.getByText('780 m')).toBeTruthy()
    expect(screen.getByText('285 W')).toBeTruthy()
    expect(screen.getByText('24')).toBeTruthy()
    expect(screen.getByText(/-3\.2/)).toBeTruthy()
    expect(screen.getByText(/\+12/)).toBeTruthy()
  })

  it('tablet read-order: elapsed, distance-to-go, split, watts', () => {
    const { container } = render(<StatBar variant="tablet" {...base} />)
    const cells = Array.from(container.querySelectorAll('[data-variant="tablet"] > span'))
    expect(cells[0].getAttribute('data-testid')).toBe('statbar-elapsed')
    expect(cells[1].textContent).toBe('780 m')
    expect(cells[2].getAttribute('data-testid')).toBe('statbar-split')
    expect(cells[3].textContent).toBe('285 W')
  })

  it('phone falls back to ghost gap when pb is null', () => {
    render(<StatBar variant="phone" {...base} vsPbSec={null} />)
    expect(screen.getByText(/Ghost.*\+12/)).toBeTruthy()
  })

  it('phone shows pb gap when ghost is null', () => {
    render(<StatBar variant="phone" {...base} vsGhostSec={null} />)
    expect(screen.getByText(/PB/)).toBeTruthy()
  })

  it('elapsed formats m:ss with zero-pad and floors fractional seconds', () => {
    render(<StatBar variant="phone" {...base} elapsedSec={65.7} />)
    expect(screen.getByTestId('statbar-elapsed').textContent).toBe('1:05')
  })
})
