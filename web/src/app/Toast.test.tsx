import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, act, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider, QueryCache, useQuery } from '@tanstack/react-query'
import { ToastHost, showToast } from './Toast'
import { ApiError } from '../api/error'

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('ToastHost + showToast', () => {
  it('renders the German rate-limit toast text', () => {
    render(<ToastHost />)
    act(() => {
      showToast('Zu viele Anfragen — kurz warten.', 'warn')
    })
    expect(
      screen.getByText('Zu viele Anfragen — kurz warten.'),
    ).toBeInTheDocument()
  })

  it('auto-dismisses a toast after 4s', () => {
    render(<ToastHost />)
    act(() => {
      showToast('hallo', 'info')
    })
    expect(screen.getByText('hallo')).toBeInTheDocument()
    act(() => {
      vi.advanceTimersByTime(4000)
    })
    expect(screen.queryByText('hallo')).not.toBeInTheDocument()
  })
})

describe('QueryClient onError -> 429 toast', () => {
  it('fires the German toast when a query throws ApiError(429)', async () => {
    vi.useRealTimers()
    const qc = new QueryClient({
      queryCache: new QueryCache({
        onError: (error) => {
          if (error instanceof ApiError && error.status === 429) {
            showToast('Zu viele Anfragen — kurz warten.', 'warn')
          }
        },
      }),
      defaultOptions: {
        queries: {
          retry: (failureCount, error) => {
            if (error instanceof ApiError && error.status === 429) return false
            return failureCount < 2
          },
        },
      },
    })

    function Probe() {
      useQuery({
        queryKey: ['probe'],
        queryFn: async () => {
          throw new ApiError(429, '429 Too Many Requests')
        },
      })
      return null
    }

    render(
      <QueryClientProvider client={qc}>
        <Probe />
        <ToastHost />
      </QueryClientProvider>,
    )

    await waitFor(() => {
      expect(
        screen.getByText('Zu viele Anfragen — kurz warten.'),
      ).toBeInTheDocument()
    })
  })
})

describe('toast with an action (ADR-0021 §4)', () => {
  it('renders the action button, calls the handler and dismisses', () => {
    const onClick = vi.fn()
    render(<ToastHost />)
    act(() => {
      showToast('Ergo antwortet nicht — Offline-Modus?', 'warn', {
        label: 'Offline weiter',
        onClick,
      })
    })
    act(() => {
      screen.getByRole('button', { name: 'Offline weiter' }).click()
    })
    expect(onClick).toHaveBeenCalledTimes(1)
    expect(screen.queryByText('Ergo antwortet nicht — Offline-Modus?')).toBeNull()
  })

  it('stays 8 s instead of 4 s', () => {
    render(<ToastHost />)
    act(() => {
      showToast('mit Aktion', 'warn', { label: 'Los', onClick: () => {} })
    })
    act(() => {
      vi.advanceTimersByTime(4_100)
    })
    expect(screen.getByText('mit Aktion')).toBeInTheDocument()
    act(() => {
      vi.advanceTimersByTime(4_000)
    })
    expect(screen.queryByText('mit Aktion')).toBeNull()
  })
})
