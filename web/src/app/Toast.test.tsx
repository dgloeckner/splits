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
