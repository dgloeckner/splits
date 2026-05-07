// Race audio cues. Asset commissioning pending — module is a no-op
// stub so callers can wire to it now. Enable once /audio/race/start.mp3
// and /audio/race/finish.mp3 land in web/public/.

export const audioEnabled = false

export function startCue(): void {
  if (!audioEnabled) return
  void new Audio('/audio/race/start.mp3').play().catch(() => {})
}

export function finishCue(): void {
  if (!audioEnabled) return
  void new Audio('/audio/race/finish.mp3').play().catch(() => {})
}
