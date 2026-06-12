import { get, set } from 'idb-keyval'

export type OfflineCursor = {
  rowerId: string
  statsVersion: number
  buildSha: string
  packedAt: string
  sessionIds: string[]
}

const CURSOR_KEY = 'splits:offline-cursor'

export async function loadCursor(): Promise<OfflineCursor | null> {
  try {
    const v = (await get(CURSOR_KEY)) as OfflineCursor | undefined
    if (
      !v ||
      typeof v !== 'object' ||
      typeof v.rowerId !== 'string' ||
      typeof v.statsVersion !== 'number' ||
      typeof v.buildSha !== 'string' ||
      typeof v.packedAt !== 'string' ||
      !Array.isArray(v.sessionIds)
    ) {
      return null
    }
    return v
  } catch {
    return null
  }
}

export async function saveCursor(c: OfflineCursor): Promise<void> {
  await set(CURSOR_KEY, c)
}
