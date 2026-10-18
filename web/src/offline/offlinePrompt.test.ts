import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ApiError, NetworkError } from '../api/error'
import { setErgoStatus, getErgoStatus, _resetErgoStatusForTest } from './ergoStatus'
import { recordBootstrapQuery, _resetBootstrapMirrorForTest } from './bootstrapMirror'

vi.mock('../app/toastBus', () => ({ showToast: vi.fn() }))
vi.mock('./reachability', () => ({ enterOfflineMode: vi.fn(), reportUnreachable: vi.fn() }))
import { showToast } from '../app/toastBus'
import { enterOfflineMode, reportUnreachable } from './reachability'
import {
  maybePromptOffline,
  showStartFailedToast,
  handleStartFailure,
  OFFLINE_PROMPT_DEBOUNCE_MS,
  promptOnQueryFailures,
  _resetOfflinePromptForTest,
} from './offlinePrompt'
import { QueryClient } from '@tanstack/react-query'

const rower = { id: 'r1', name: 'Daniel', color: '#5dd7e4', created_at: '2026-05-03T19:01:59Z' }
const netErr = () => new NetworkError('/api/v1/sessions', new DOMException('t', 'TimeoutError'))

function withLocalData() {
  recordBootstrapQuery(['rowers'], [rower])
  recordBootstrapQuery(['active-rower'], rower)
}

describe('offline prompt (ADR-0021 §4)', () => {
  beforeEach(() => {
    vi.mocked(showToast).mockReset()
    vi.mocked(enterOfflineMode).mockReset()
    _resetErgoStatusForTest()
    _resetOfflinePromptForTest()
    localStorage.clear()
    _resetBootstrapMirrorForTest()
    setErgoStatus({ reachable: true })
  })

  it('asks „Offline weiter“ on a network failure while the Ergo seems reachable', () => {
    withLocalData()
    expect(maybePromptOffline(netErr(), 1_000)).toBe(true)
    expect(showToast).toHaveBeenCalledWith('Ergo antwortet nicht — Offline-Modus?', 'warn', {
      label: 'Offline weiter',
      onClick: expect.any(Function),
    })
    vi.mocked(showToast).mock.calls[0][2]!.onClick()
    expect(enterOfflineMode).toHaveBeenCalledTimes(1)
  })

  it('also asks while reachability is still unknown', () => {
    setErgoStatus({ reachable: 'unknown' })
    expect(maybePromptOffline(netErr(), 1_000)).toBe(true)
  })

  it('debounces: at most one prompt per 30 s', () => {
    expect(maybePromptOffline(netErr(), 1_000)).toBe(true)
    expect(maybePromptOffline(netErr(), 1_000 + OFFLINE_PROMPT_DEBOUNCE_MS - 1)).toBe(false)
    expect(maybePromptOffline(netErr(), 1_000 + OFFLINE_PROMPT_DEBOUNCE_MS)).toBe(true)
    expect(showToast).toHaveBeenCalledTimes(2)
  })

  it('offers no action without local data', () => {
    maybePromptOffline(netErr(), 1_000)
    expect(showToast).toHaveBeenCalledWith(
      'Ergo antwortet nicht — Offline-Modus?',
      'warn',
      undefined,
    )
  })

  it('counts a packed bag as local data', () => {
    setErgoStatus({ packedAt: '2026-06-12T18:42:00Z' })
    maybePromptOffline(netErr(), 1_000)
    expect(vi.mocked(showToast).mock.calls[0][2]).toMatchObject({ label: 'Offline weiter' })
  })

  it('stays quiet when already unreachable, in offline mode, or for non-network errors', () => {
    setErgoStatus({ reachable: false })
    expect(maybePromptOffline(netErr(), 1_000)).toBe(false)
    setErgoStatus({ reachable: true, mode: 'offline' })
    expect(maybePromptOffline(netErr(), 1_000)).toBe(false)
    setErgoStatus({ mode: 'auto' })
    expect(maybePromptOffline(new ApiError(500, 'boom'), 1_000)).toBe(false)
    expect(showToast).not.toHaveBeenCalled()
  })

  it('the start-failed toast carries the action (not debounced)', () => {
    withLocalData()
    maybePromptOffline(netErr(), Date.now())
    showStartFailedToast()
    expect(showToast).toHaveBeenLastCalledWith(
      'Start fehlgeschlagen — Ergo nicht erreichbar?',
      'warn',
      { label: 'Offline weiter', onClick: expect.any(Function) },
    )
    expect(getErgoStatus().mode).toBe('auto')
  })
})

describe('promptOnQueryFailures', () => {
  beforeEach(() => {
    vi.mocked(showToast).mockReset()
    _resetErgoStatusForTest()
    _resetOfflinePromptForTest()
    setErgoStatus({ reachable: true })
  })

  it('asks at the first failed attempt, not after the retries', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: 1, retryDelay: 60_000 } } })
    const stop = promptOnQueryFailures(qc.getQueryCache())
    void qc.fetchQuery({ queryKey: ['x'], queryFn: () => Promise.reject(netErr()) }).catch(() => {})
    await vi.waitFor(() => expect(showToast).toHaveBeenCalledTimes(1))
    expect(qc.getQueryState(['x'])?.status).toBe('pending') // retry still pending
    stop()
    qc.clear()
  })

  it('also covers queries without retries', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const stop = promptOnQueryFailures(qc.getQueryCache())
    await qc.fetchQuery({ queryKey: ['y'], queryFn: () => Promise.reject(netErr()) }).catch(() => {})
    expect(showToast).toHaveBeenCalledTimes(1)
    stop()
  })
})

describe('handleStartFailure', () => {
  beforeEach(() => {
    vi.mocked(showToast).mockReset()
    vi.mocked(reportUnreachable).mockReset()
    _resetErgoStatusForTest()
  })

  it('a network failure is evidence: report unreachable, then the toast', () => {
    handleStartFailure(netErr())
    expect(reportUnreachable).toHaveBeenCalledTimes(1)
    expect(showToast).toHaveBeenCalledWith(
      'Start fehlgeschlagen — Ergo nicht erreichbar?',
      'warn',
      undefined,
    )
  })

  it('an HTTP error only toasts — the backend answered', () => {
    handleStartFailure(new ApiError(500, 'boom'))
    expect(reportUnreachable).not.toHaveBeenCalled()
    expect(showToast).toHaveBeenCalledTimes(1)
  })
})
