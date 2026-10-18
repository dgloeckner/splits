import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render } from '@testing-library/react'
import type { ReactNode } from 'react'
import { LiveSessionContext, type LiveSession } from '../live/LiveSessionContext'
import { initialLiveState } from '../live/reducer'

vi.mock('../app/toastBus', () => ({ showToast: vi.fn() }))
import { showToast } from '../app/toastBus'
import {
  _resetSwUpdateForTest,
  offerPendingUpdate,
  setSessionOpen,
  updateWaiting,
  useLiveViewHoldsUpdate,
  useOfferPendingUpdate,
  useSessionHoldsUpdate,
} from './swUpdate'

const toast = vi.mocked(showToast)

function LiveView() {
  useLiveViewHoldsUpdate()
  return null
}
function Home() {
  useOfferPendingUpdate()
  return null
}
function SessionWatcher() {
  useSessionHoldsUpdate()
  return null
}

function live(open: boolean): LiveSession {
  return {
    ...initialLiveState,
    session: open ? ({ session_id: 's1' } as LiveSession['session']) : null,
    summary: null,
    reconnect: () => {},
    dispatch: () => {},
  }
}
function withLive(value: LiveSession, children: ReactNode) {
  return <LiveSessionContext.Provider value={value}>{children}</LiveSessionContext.Provider>
}

beforeEach(() => {
  _resetSwUpdateForTest()
  toast.mockReset()
})

describe('swUpdate (ADR-0023 §5)', () => {
  it('offers a waiting build at once when idle; „Neu laden" applies it', () => {
    const apply = vi.fn()
    updateWaiting(apply)
    expect(toast).toHaveBeenCalledTimes(1)
    const [text, tone, action] = toast.mock.calls[0]
    expect(text).toBe('Neue Version verfügbar')
    expect(tone).toBe('info')
    expect(action?.label).toBe('Neu laden')
    expect(apply).not.toHaveBeenCalled()
    action!.onClick()
    expect(apply).toHaveBeenCalledTimes(1)
  })

  it('offers nothing when no build is waiting', () => {
    expect(offerPendingUpdate()).toBe(false)
    render(<Home />)
    expect(toast).not.toHaveBeenCalled()
  })

  it('defers while the Live view is mounted, offers on the next Home/Verlauf', () => {
    const view = render(<LiveView />)
    updateWaiting(vi.fn())
    expect(toast).not.toHaveBeenCalled()
    view.unmount()
    render(<Home />)
    expect(toast).toHaveBeenCalledTimes(1)
  })

  it('re-rendering the Live view keeps the hold', () => {
    const view = render(<LiveView />)
    view.rerender(<LiveView />)
    updateWaiting(vi.fn())
    expect(offerPendingUpdate()).toBe(false)
  })

  it('defers while a session is open, even away from Live', () => {
    const watcher = render(withLive(live(true), <SessionWatcher />))
    updateWaiting(vi.fn())
    render(<Home />)
    expect(toast).not.toHaveBeenCalled()
    // Session ends (summary arrives / session cleared): next visit offers.
    watcher.rerender(withLive(live(false), <SessionWatcher />))
    render(<Home />)
    expect(toast).toHaveBeenCalledTimes(1)
  })

  it('a session with its summary in is no longer open', () => {
    const ended = { ...live(true), summary: {} as LiveSession['summary'] }
    render(withLive(ended, <SessionWatcher />))
    updateWaiting(vi.fn())
    expect(toast).toHaveBeenCalledTimes(1)
  })

  it('one offer at a time: no stacked toasts, re-offered once the last one is gone', () => {
    vi.useFakeTimers()
    try {
      updateWaiting(vi.fn())
      render(<Home />)
      render(<Home />)
      expect(toast).toHaveBeenCalledTimes(1)
      vi.advanceTimersByTime(8_000)
      render(<Home />)
      expect(toast).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('setSessionOpen gates the offer directly', () => {
    setSessionOpen(true)
    updateWaiting(vi.fn())
    expect(offerPendingUpdate()).toBe(false)
    setSessionOpen(false)
    expect(offerPendingUpdate()).toBe(true)
  })
})
