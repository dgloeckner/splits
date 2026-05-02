import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ThemeSwitcher } from './ThemeSwitcher'

const STORAGE_KEY = 'home-ergo:theme'

beforeEach(() => {
  localStorage.clear()
  document.documentElement.removeAttribute('data-theme')
})

afterEach(() => {
  localStorage.clear()
  document.documentElement.removeAttribute('data-theme')
})

describe('ThemeSwitcher', () => {
  it('renders three options', () => {
    render(<ThemeSwitcher />)
    expect(screen.getByRole('radio', { name: 'System' })).toBeTruthy()
    expect(screen.getByRole('radio', { name: 'Dunkel' })).toBeTruthy()
    expect(screen.getByRole('radio', { name: 'Hell' })).toBeTruthy()
  })

  it('defaults to "system" when no theme stored', () => {
    render(<ThemeSwitcher />)
    expect(screen.getByRole('radio', { name: 'System', checked: true })).toBeTruthy()
  })

  it('reflects stored "light" on mount', () => {
    localStorage.setItem(STORAGE_KEY, 'light')
    render(<ThemeSwitcher />)
    expect(screen.getByRole('radio', { name: 'Hell', checked: true })).toBeTruthy()
  })

  it('clicking Dunkel sets data-theme + persists', () => {
    render(<ThemeSwitcher />)
    fireEvent.click(screen.getByRole('radio', { name: 'Dunkel' }))
    expect(localStorage.getItem(STORAGE_KEY)).toBe('dark')
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
    expect(screen.getByRole('radio', { name: 'Dunkel', checked: true })).toBeTruthy()
  })

  it('clicking System clears the stored override', () => {
    localStorage.setItem(STORAGE_KEY, 'dark')
    render(<ThemeSwitcher />)
    fireEvent.click(screen.getByRole('radio', { name: 'System' }))
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull()
  })
})
