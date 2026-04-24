// Persists the 2×3 live dashboard tile layout to localStorage. A layout
// is an array of six tile ids (row-major: r1c1, r1c2, r1c3, r2c1, …).

const STORAGE_KEY = 'home-ergo:tile-layout:v1'

export type TileLayout = [string, string, string, string, string, string]

export const DEFAULT_LAYOUT: TileLayout = [
  'split-verlauf',
  'watt-verlauf',
  'dps',
  'spi',
  'oe-split',
  'hf-zone',
]

export function loadLayout(): TileLayout {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return [...DEFAULT_LAYOUT] as TileLayout
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed) || parsed.length !== 6) return [...DEFAULT_LAYOUT] as TileLayout
    if (!parsed.every((x) => typeof x === 'string')) return [...DEFAULT_LAYOUT] as TileLayout
    return parsed as TileLayout
  } catch {
    return [...DEFAULT_LAYOUT] as TileLayout
  }
}

export function saveLayout(layout: TileLayout): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(layout))
  } catch {
    /* ignore */
  }
}

export function replaceSlot(layout: TileLayout, slotIndex: number, tileId: string): TileLayout {
  const next = [...layout] as TileLayout
  next[slotIndex] = tileId
  return next
}
