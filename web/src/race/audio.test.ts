import { describe, it, expect, vi } from 'vitest'
import { startCue, finishCue, audioEnabled } from './audio'

describe('audio (asset-pending stub)', () => {
  it('audioEnabled is false until assets land', () => {
    expect(audioEnabled).toBe(false)
  })

  it('startCue and finishCue are no-ops while disabled', () => {
    const playSpy = vi.fn()
    ;(globalThis as any).Audio = vi.fn(() => ({ play: playSpy, pause() {}, currentTime: 0 }))
    startCue()
    finishCue()
    expect(playSpy).not.toHaveBeenCalled()
  })
})
