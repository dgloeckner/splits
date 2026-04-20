import { renderHook, act } from '@testing-library/react'
import { describe, it, expect, beforeEach } from 'vitest'
import { useTheme } from './useTheme'
import { PRE_MOUNT_THEME_SCRIPT, STORAGE_KEY } from './preMountScript'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const indexHtmlPath = join(here, '..', '..', 'index.html')

describe('useTheme', () => {
  beforeEach(() => {
    localStorage.clear()
    document.documentElement.removeAttribute('data-theme')
  })

  it('reads initial theme from data-theme attribute (dark)', () => {
    document.documentElement.setAttribute('data-theme', 'dark')
    const { result } = renderHook(() => useTheme())
    expect(result.current[0]).toBe('system')
  })

  it("reports 'system' when localStorage is empty", () => {
    document.documentElement.setAttribute('data-theme', 'dark')
    const { result } = renderHook(() => useTheme())
    expect(result.current[0]).toBe('system')
  })

  it('reports stored override', () => {
    localStorage.setItem(STORAGE_KEY, 'light')
    document.documentElement.setAttribute('data-theme', 'light')
    const { result } = renderHook(() => useTheme())
    expect(result.current[0]).toBe('light')
  })

  it('writes setTheme to localStorage and data-theme', () => {
    document.documentElement.setAttribute('data-theme', 'dark')
    const { result } = renderHook(() => useTheme())
    act(() => result.current[1]('light'))
    expect(localStorage.getItem(STORAGE_KEY)).toBe('light')
    expect(document.documentElement.getAttribute('data-theme')).toBe('light')
  })

  it("setTheme('system') clears localStorage and resolves against prefers-color-scheme", () => {
    localStorage.setItem(STORAGE_KEY, 'light')
    document.documentElement.setAttribute('data-theme', 'light')
    const { result } = renderHook(() => useTheme())
    act(() => result.current[1]('system'))
    expect(localStorage.getItem(STORAGE_KEY)).toBe(null)
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
  })

  it('index.html inline script matches PRE_MOUNT_THEME_SCRIPT', () => {
    const html = readFileSync(indexHtmlPath, 'utf-8')
    const normalise = (s: string) => s.replace(/\s+/g, '')
    expect(normalise(html)).toContain(normalise(PRE_MOUNT_THEME_SCRIPT))
  })
})
