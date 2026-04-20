import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import { Button } from './Button'
import styles from './Button.module.css'

describe('Button', () => {
  it('renders children as the accessible name', () => {
    render(<Button>Starten</Button>)
    expect(screen.getByRole('button', { name: 'Starten' })).toBeInTheDocument()
  })

  it("defaults to variant='primary'", () => {
    render(<Button>Go</Button>)
    const btn = screen.getByRole('button')
    expect(btn).toHaveClass(styles.button)
    expect(btn).toHaveClass(styles.primary)
  })

  it.each([
    ['primary', 'primary'],
    ['secondary', 'secondary'],
    ['tertiary', 'tertiary'],
  ] as const)('applies the %s variant class', (variant, expected) => {
    render(<Button variant={variant}>x</Button>)
    expect(screen.getByRole('button')).toHaveClass(styles[expected])
  })

  it('fires onClick', async () => {
    const user = userEvent.setup()
    const onClick = vi.fn()
    render(<Button onClick={onClick}>Go</Button>)
    await user.click(screen.getByRole('button'))
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('respects disabled and prevents click', async () => {
    const user = userEvent.setup()
    const onClick = vi.fn()
    render(
      <Button onClick={onClick} disabled>
        Go
      </Button>,
    )
    await user.click(screen.getByRole('button'))
    expect(onClick).not.toHaveBeenCalled()
  })
})
