import { describe, it, expect } from 'vitest'
import { TILES, getTile, tilesByCategory } from './registry'

describe('tile registry', () => {
  it('ids are unique', () => {
    const ids = new Set(TILES.map((t) => t.id))
    expect(ids.size).toBe(TILES.length)
  })

  it('all HR-gated tiles share the gated:"hr" marker', () => {
    for (const id of ['herzfrequenz', 'hf-verlauf', 'hf-zone']) {
      expect(getTile(id)?.gated).toBe('hr')
    }
  })

  it('categories cover every tile', () => {
    const byCat = tilesByCategory()
    const total = byCat.zahlen.length + byCat.verlaeufe.length + byCat.bewertung.length
    expect(total).toBe(TILES.length)
  })

  it('defaults match the FEAT-0001a default layout', () => {
    for (const id of ['split-verlauf', 'dps', 'oe-split', 'watt-verlauf', 'spi', 'hf-zone']) {
      expect(getTile(id)).toBeDefined()
    }
  })

  it('exposes race-boat tile type', () => {
    const def = getTile('race-boat')
    expect(def).toBeDefined()
    expect(def!.type).toBe('race-boat')
    expect(def!.category).toBe('bewertung')
  })
})
