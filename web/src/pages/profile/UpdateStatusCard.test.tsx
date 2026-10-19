import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { UpdateStatusCard } from './UpdateStatusCard'
import styles from './UpdateStatusCard.module.css'
import type { UpdateStatus } from '../../api/updateStatus'

afterEach(() => {
  vi.unstubAllGlobals()
})

function serve(body: Partial<UpdateStatus> | null, status = 200) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      expect(url).toBe('/api/v1/update-status')
      if (body === null) throw new TypeError('Failed to fetch')
      return new Response(JSON.stringify({ blocked: [], running: 'v0.4.1', available: true, ...body }), {
        status,
      })
    }),
  )
}

async function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={qc}>
      <UpdateStatusCard />
    </QueryClientProvider>,
  )
  return screen.findByTestId('update-status')
}

describe('UpdateStatusCard (ADR-0023 §4)', () => {
  it('current: installed version, aktuell, last check', async () => {
    serve({ state: 'current', installed: 'v0.4.1', latest: 'v0.4.1', checked_at: '2026-10-19T04:41:00' })
    const card = await mount()
    expect(card).toHaveAttribute('data-state', 'current')
    expect(screen.getByTestId('update-status-title')).toHaveTextContent('Installiert v0.4.1 · aktuell')
    expect(screen.getByTestId('update-status-detail')).toHaveTextContent(
      'Zuletzt geprüft 19. Oktober, 04:41',
    )
  })

  it('behind: names the new release and when it lands — informational, not an error', async () => {
    serve({ state: 'behind', installed: 'v0.4.1', latest: 'v0.4.2', result: 'busy' })
    const card = await mount()
    expect(screen.getByTestId('update-status-title')).toHaveTextContent('Installiert v0.4.1')
    expect(screen.getByTestId('update-status-detail')).toHaveTextContent(
      'Neu: v0.4.2 — wird heute Nacht installiert',
    )
    expect(card).toHaveClass(styles.info)
    expect(card).not.toHaveClass(styles.warn)
  })

  it('stuck: the failed tag and the version still running, styled as a warning', async () => {
    serve({ state: 'stuck', installed: 'v0.4.1', latest: 'v0.4.2', blocked: ['v0.4.2'], result: 'rolled-back' })
    const card = await mount()
    expect(screen.getByTestId('update-status-title')).toHaveTextContent(
      'Update auf v0.4.2 fehlgeschlagen — läuft weiter auf v0.4.1',
    )
    expect(card).toHaveClass(styles.warn)
    expect(card).not.toHaveClass(styles.info)
  })

  it('behind and stuck do not render alike', async () => {
    serve({ state: 'behind', installed: 'v0.4.1', latest: 'v0.4.2' })
    const behind = (await mount()).className
    document.body.innerHTML = ''
    serve({ state: 'stuck', installed: 'v0.4.1', latest: 'v0.4.2' })
    const stuck = (await mount()).className
    expect(behind).not.toBe(stuck)
  })

  it('off: says updates are off', async () => {
    serve({ state: 'off', installed: 'v0.4.1' })
    const card = await mount()
    expect(card).toHaveAttribute('data-state', 'off')
    expect(screen.getByTestId('update-status-title')).toHaveTextContent('Automatische Updates aus')
    expect(screen.getByTestId('update-status-detail')).toHaveTextContent('Installiert v0.4.1')
  })

  it('unknown: no state file yet, names the running version', async () => {
    serve({ available: false, state: 'unknown', running: 'v0.4.1' })
    const card = await mount()
    expect(card).toHaveAttribute('data-state', 'unknown')
    expect(screen.getByTestId('update-status-title')).toHaveTextContent('Update-Status unbekannt')
    expect(screen.getByTestId('update-status-detail')).toHaveTextContent('Läuft v0.4.1')
  })

  it('unknown: a hand-managed install says so', async () => {
    serve({ state: 'unknown', result: 'hand-managed', running: 'dev' })
    await mount()
    expect(screen.getByTestId('update-status-detail')).toHaveTextContent(
      'Manuell verwaltete Installation',
    )
  })

  it('unknown: an unreachable Ergo is unknown, without a detail', async () => {
    serve(null)
    const card = await mount()
    expect(card).toHaveAttribute('data-state', 'unknown')
    expect(screen.queryByTestId('update-status-detail')).toBeNull()
  })
})
