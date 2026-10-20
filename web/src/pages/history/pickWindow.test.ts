import { describe, it, expect } from 'vitest'
import { pickWindowFor } from './pickWindow'

describe('pickWindowFor', () => {
  const to = new Date('2026-10-20T12:00:00').getTime()
  const at = (iso: string) => new Date(iso).getTime()

  it('within the last 365 days → Jahr', () => {
    expect(pickWindowFor(at('2026-09-01T12:00:00'), to)).toBe('365d')
  })

  it('365-day boundary: on it → Jahr, a minute before → Alles', () => {
    expect(pickWindowFor(at('2025-10-20T12:00:00'), to)).toBe('365d')
    expect(pickWindowFor(at('2025-10-20T11:59:00'), to)).toBe('all')
  })

  it('older than a year → Alles', () => {
    expect(pickWindowFor(at('2024-03-01T12:00:00'), to)).toBe('all')
  })
})
