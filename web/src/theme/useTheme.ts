import { useCallback, useEffect, useState } from 'react'
import { STORAGE_KEY } from './preMountScript'

export type ThemeKind = 'system' | 'dark' | 'light'

type Resolved = 'dark' | 'light'

function readStored(): ThemeKind {
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    if (v === 'dark' || v === 'light') return v
  } catch {
    /* localStorage disabled */
  }
  return 'system'
}

function resolveSystem(): Resolved {
  try {
    if (window.matchMedia('(prefers-color-scheme: light)').matches) return 'light'
  } catch {
    /* matchMedia missing */
  }
  return 'dark'
}

function apply(resolved: Resolved) {
  document.documentElement.setAttribute('data-theme', resolved)
}

export function useTheme(): [ThemeKind, (t: ThemeKind) => void] {
  const [theme, setThemeState] = useState<ThemeKind>(() => readStored())

  useEffect(() => {
    if (theme !== 'system') return
    const mql = window.matchMedia('(prefers-color-scheme: light)')
    const onChange = () => apply(mql.matches ? 'light' : 'dark')
    mql.addEventListener?.('change', onChange)
    return () => mql.removeEventListener?.('change', onChange)
  }, [theme])

  const setTheme = useCallback((next: ThemeKind) => {
    try {
      if (next === 'system') {
        localStorage.removeItem(STORAGE_KEY)
        apply(resolveSystem())
      } else {
        localStorage.setItem(STORAGE_KEY, next)
        apply(next)
      }
    } catch {
      apply(next === 'system' ? resolveSystem() : next)
    }
    setThemeState(next)
  }, [])

  return [theme, setTheme]
}
