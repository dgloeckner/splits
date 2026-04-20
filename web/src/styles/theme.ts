// TS-side re-export of token names. Use this in components that need a
// token name as a string (e.g. to pass to an SVG style attribute).
// Components setting static CSS properties should use the CSS variable
// directly in a .module.css file instead.

export type ThemeKind = 'system' | 'dark' | 'light'

export const TOKENS = {
  colorSurface: 'var(--color-surface)',
  colorSurfaceContainerLow: 'var(--color-surface-container-low)',
  colorSurfaceContainer: 'var(--color-surface-container)',
  colorSurfaceContainerHigh: 'var(--color-surface-container-high)',
  colorSurfaceContainerHighest: 'var(--color-surface-container-highest)',
  colorOnSurface: 'var(--color-on-surface)',
  colorOnSurfaceVariant: 'var(--color-on-surface-variant)',
  colorPrimary: 'var(--color-primary)',
  colorPrimaryContainer: 'var(--color-primary-container)',
  colorOnPrimary: 'var(--color-on-primary)',
  colorTertiary: 'var(--color-tertiary)',
  colorError: 'var(--color-error)',
  radiusCard: 'var(--radius-card)',
  radiusButton: 'var(--radius-button)',
} as const
