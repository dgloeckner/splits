// @vitest-environment node
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect } from 'vitest'
import { liveReducer, initialLiveState } from './reducer'
import type { LiveState } from './reducer'
import type { LiveEvent } from './events'

// The golden JSONL files are the ADR-0017 contract with the Go suite
// (backend/internal/goldenstream). Regenerate via
// `cd backend && go test ./internal/goldenstream -update`.
const GOLDEN_DIR = join(__dirname, '../../../specs/int/fixtures/golden')

const BASE_MS = 1_700_000_000_000 // matches the Go harness clock base

type GoldenLine = { at_ms: number; event: string; id: number; data: Record<string, unknown> }

function readGolden(file: string): GoldenLine[] {
  return readFileSync(join(GOLDEN_DIR, file), 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as GoldenLine)
}

describe('golden replay through the live reducer (ADR-0017)', () => {
  const files = readdirSync(GOLDEN_DIR).filter((f) => f.endsWith('.jsonl'))

  it('has golden files to replay', () => {
    expect(files.length).toBeGreaterThan(0)
  })

  for (const file of files) {
    it(`replays ${file} deterministically with correct display invariants`, () => {
      const lines = readGolden(file)
      let state: LiveState = initialLiveState
      let lastSummary: Record<string, unknown> | null = null

      for (const line of lines) {
        const ev = { kind: line.event, id: line.id, data: line.data } as unknown as LiveEvent
        state = liveReducer(state, { type: 'event', event: ev, nowMs: BASE_MS + line.at_ms })

        if (line.event === 'stroke') {
          const d = line.data as {
            distance_m: number; phase?: string
            work_distance_m: number; phase_distance_m: number
          }
          expect(d.work_distance_m).toBeGreaterThanOrEqual(0)
          expect(d.work_distance_m).toBeLessThanOrEqual(d.distance_m)
          expect(d.phase_distance_m).toBeLessThanOrEqual(d.distance_m)
          if (d.phase) expect(state.phase).toBe(d.phase)
        }
        if (line.event === 'session_end') {
          lastSummary = (line.data as { summary: Record<string, unknown> }).summary
        }
      }
      // Final state carries the work-only summary verbatim.
      expect(state.summary).toEqual(lastSummary)
    })
  }
})
