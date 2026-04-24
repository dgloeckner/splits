// Tile registry — canonical source for what the user can put on the
// live dashboard. See specs/feat/0001a-tile-catalogue.md.

export type TileType = 'numeric' | 'sparkline' | 'zone'

export type TileDef = {
  id: string
  label: string
  subtitle?: string
  type: TileType
  unit?: string
  gated?: 'hr'
  category: 'zahlen' | 'verlaeufe' | 'bewertung'
}

export const TILES: TileDef[] = [
  { id: 'zeit', label: 'Zeit', type: 'numeric', category: 'zahlen' },
  { id: 'distanz', label: 'Distanz', type: 'numeric', unit: 'm', category: 'zahlen' },
  {
    id: 'split',
    label: 'Split',
    subtitle: 'Zeit pro 500 m Intervall',
    type: 'numeric',
    category: 'zahlen',
  },
  {
    id: 'dps',
    label: 'DPS',
    subtitle: 'Distanz pro Schlag in Metern',
    type: 'numeric',
    unit: 'm',
    category: 'zahlen',
  },
  { id: 'spi', label: 'SPI', type: 'numeric', category: 'zahlen' },
  { id: 'spm', label: 'SPM', type: 'numeric', category: 'zahlen' },
  { id: 'watt', label: 'Watt', type: 'numeric', unit: 'W', category: 'zahlen' },
  {
    id: 'oe-split',
    label: 'Ø Split',
    subtitle: 'Session-Durchschnitt',
    type: 'numeric',
    category: 'zahlen',
  },
  {
    id: 'kalorien',
    label: 'Kalorien',
    subtitle: 'Energieverbrauch (kcal/h)',
    type: 'numeric',
    unit: 'kcal/h',
    category: 'zahlen',
  },
  {
    id: 'herzfrequenz',
    label: 'Herzfrequenz',
    subtitle: 'Aktuelle Herzfrequenz (BPM)',
    type: 'numeric',
    unit: 'bpm',
    gated: 'hr',
    category: 'zahlen',
  },
  {
    id: 'split-verlauf',
    label: 'Split',
    type: 'sparkline',
    category: 'verlaeufe',
  },
  {
    id: 'watt-verlauf',
    label: 'Watt',
    type: 'sparkline',
    category: 'verlaeufe',
  },
  {
    id: 'hf-verlauf',
    label: 'HF',
    type: 'sparkline',
    gated: 'hr',
    category: 'verlaeufe',
  },
  {
    id: 'hf-zone',
    label: 'HF-Zone',
    type: 'zone',
    gated: 'hr',
    category: 'bewertung',
  },
]

const BY_ID = Object.fromEntries(TILES.map((t) => [t.id, t]))

export function getTile(id: string): TileDef | undefined {
  return BY_ID[id]
}

export function tilesByCategory(): Record<TileDef['category'], TileDef[]> {
  const out: Record<TileDef['category'], TileDef[]> = {
    zahlen: [],
    verlaeufe: [],
    bewertung: [],
  }
  for (const t of TILES) out[t.category].push(t)
  return out
}
