import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, act } from '@testing-library/react'
import { LiveSessionContext } from './LiveSessionContext'
import { ChannelReviver } from './ChannelReviver'
import { initialLiveState } from './reducer'
import type { ChannelStatus } from './channel'
import { setErgoStatus, _resetErgoStatusForTest } from '../offline/ergoStatus'

vi.mock('../offline/reachability', () => ({ reportUnreachable: vi.fn() }))
import { reportUnreachable } from '../offline/reachability'

function tree(status: ChannelStatus, reconnect: () => void) {
  return (
    <LiveSessionContext.Provider value={{ ...initialLiveState, status, reconnect }}>
      <ChannelReviver />
    </LiveSessionContext.Provider>
  )
}

function mount(status: ChannelStatus, reconnect = vi.fn()) {
  render(tree(status, reconnect))
  return reconnect
}

describe('ChannelReviver', () => {
  beforeEach(() => {
    _resetErgoStatusForTest()
    vi.mocked(reportUnreachable).mockReset()
  })

  it('reconnects a permanently disconnected channel when the ergo is reachable', () => {
    setErgoStatus({ reachable: true })
    const reconnect = mount('permanently_disconnected')
    expect(reconnect).toHaveBeenCalledTimes(1)
  })

  it('does nothing while unreachable', () => {
    setErgoStatus({ reachable: false })
    const reconnect = mount('permanently_disconnected')
    expect(reconnect).not.toHaveBeenCalled()
  })

  it('reconnects when reachability returns after mount', () => {
    setErgoStatus({ reachable: false })
    const reconnect = mount('permanently_disconnected')
    expect(reconnect).not.toHaveBeenCalled()
    act(() => setErgoStatus({ reachable: true }))
    expect(reconnect).toHaveBeenCalledTimes(1)
  })

  it('waits for the first probe while reachability is unknown', () => {
    const reconnect = mount('permanently_disconnected')
    expect(reconnect).not.toHaveBeenCalled()
  })

  it('never tears down a healthy channel', () => {
    setErgoStatus({ reachable: true })
    const reconnect = mount('open')
    expect(reconnect).not.toHaveBeenCalled()
  })

  // ADR-0021 §3: an exhausted channel is evidence the Ergo went away.
  it('reports unreachable once per transition into permanently_disconnected', () => {
    setErgoStatus({ reachable: true })
    const reconnect = vi.fn()
    const { rerender } = render(tree('open', reconnect))
    rerender(tree('reconnecting', reconnect))
    rerender(tree('permanently_disconnected', reconnect))
    rerender(tree('permanently_disconnected', reconnect))
    expect(reportUnreachable).toHaveBeenCalledTimes(1)
    expect(reconnect).not.toHaveBeenCalled() // wait for the probe instead of looping
    rerender(tree('open', reconnect))
    rerender(tree('permanently_disconnected', reconnect))
    expect(reportUnreachable).toHaveBeenCalledTimes(2)
  })

  it('a channel already dead at mount is revived, not reported (coming home)', () => {
    setErgoStatus({ reachable: true })
    mount('permanently_disconnected')
    expect(reportUnreachable).not.toHaveBeenCalled()
  })
})
