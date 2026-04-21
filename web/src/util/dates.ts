const WEEKDAY_DE = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa']

function hhmm(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

export function formatSessionStart(isoStr: string, now: Date = new Date()): string {
  const d = new Date(isoStr)
  if (sameDay(d, now)) return `Heute ${hhmm(d)}`
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  if (sameDay(d, yesterday)) return `Gestern ${hhmm(d)}`

  const ageDays = Math.floor((now.getTime() - d.getTime()) / 86_400_000)
  if (ageDays < 7 && ageDays > 0) {
    return `${WEEKDAY_DE[d.getDay()]} ${hhmm(d)}`
  }

  return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()} ${hhmm(d)}`
}
