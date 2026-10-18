import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, act } from '@testing-library/react'
import { LiveSessionContext } from './LiveSessionContext'
import { ChannelReviver } from './ChannelReviver'
import { initialLiveState } from './reducer'
import type { ChannelStatus } from './channel'
import { setErgoStatus, _resetErgoStatusForTest } from '../offline/ergoStatus'

function mount(status: ChannelStatus, reconnect = vi.fn()) {
  render(
    <LiveSessionContext.Provider value={{ ...initialLiveState, status, reconnect }}>
      <ChannelReviver />
    </LiveSessionContext.Provider>,
  )
  return reconnect
}

describe('ChannelReviver', () => {
  beforeEach(() => _resetErgoStatusForTest())

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
})
