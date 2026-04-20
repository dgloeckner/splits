import { render, screen, act, waitFor } from '@testing-library/react'
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { LiveSessionProvider, useLiveSession } from './LiveSessionContext'
import { MockChannel } from './channel'

function Probe() {
  const s = useLiveSession()
  return (
    <div>
      <span data-testid="status">{s.status}</span>
      <span data-testid="rower">{s.session?.rower_name ?? 'none'}</span>
    </div>
  )
}

describe('LiveSessionProvider', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('exposes state to consumers via useLiveSession', async () => {
    const ch = new MockChannel()
    render(
      <LiveSessionProvider channel={ch}>
        <Probe />
      </LiveSessionProvider>,
    )

    expect(screen.getByTestId('status')).toHaveTextContent('idle')
    expect(screen.getByTestId('rower')).toHaveTextContent('none')

    act(() => ch.setStatus('open'))
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('open'))
  })

  it('throws a clear error if used outside the provider', () => {
    const Boom = () => {
      useLiveSession()
      return null
    }
    expect(() => render(<Boom />)).toThrow(/inside <LiveSessionProvider>/)
  })
})
