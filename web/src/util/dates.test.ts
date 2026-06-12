import { describe, it, expect } from 'vitest'
import { formatSessionStart, formatStand } from './dates'

const now = new Date('2026-04-21T15:00:00Z')

describe('formatSessionStart', () => {
  it('today formats as "Heute <HH:MM>"', () => {
    expect(formatSessionStart('2026-04-21T10:30:00Z', now)).toBe('Heute 10:30')
  })

  it('yesterday formats as "Gestern <HH:MM>"', () => {
    expect(formatSessionStart('2026-04-20T08:00:00Z', now)).toBe('Gestern 08:00')
  })

  it('within the last 7 days formats as "<Weekday> <HH:MM>"', () => {
    // 2026-04-21 is a Tuesday → 2026-04-18 is Saturday.
    expect(formatSessionStart('2026-04-18T11:00:00Z', now)).toMatch(/^(Mo|Di|Mi|Do|Fr|Sa|So) 11:00$/)
  })

  it('older than 7 days formats as DD.MM.YYYY HH:MM', () => {
    expect(formatSessionStart('2025-12-25T14:05:00Z', now)).toBe('25.12.2025 14:05')
  })
})

describe('formatStand', () => {
  it('renders day, long month, comma, hh:mm', () => {
    expect(formatStand('2026-06-12T18:42:00')).toBe('12. Juni, 18:42')
  })
  it('pads minutes and hours', () => {
    expect(formatStand('2026-01-03T08:05:00')).toBe('3. Januar, 08:05')
  })
})
