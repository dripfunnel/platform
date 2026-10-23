const units = [
  ['day', 86_400],
  ['hour', 3_600],
  ['minute', 60],
  ['second', 1],
] as const

// The two largest units are enough to read a wait ("2 days 1 hr", "6 min 12 sec").
export const formatDuration = (seconds: number, locale: string): string => {
  let rest = Math.max(0, Math.floor(seconds))
  const first = units.findIndex(([, size]) => rest >= size)
  const shown = first === -1 ? units.slice(-1) : units.slice(first, first + 2)
  const parts = shown.flatMap(([unit, size], index) => {
    const value = Math.floor(rest / size)
    rest %= size
    if (index > 0 && value === 0) return []
    return [new Intl.NumberFormat(locale, { style: 'unit', unit, unitDisplay: 'short' }).format(value)]
  })
  return new Intl.ListFormat(locale, { type: 'unit', style: 'narrow' }).format(parts)
}
