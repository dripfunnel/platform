/**
 * A typed percentage ("5", "7.5", "12,25") as basis points: to two places, and up to 100. `signed` allows a leading minus and no ceiling, for a price
 * adjustment. Null for anything else.
 */
export const bpsOf = (text: string, signed = false): number | null => {
  const trimmed = text.trim().replace(/^(-?\d+),(\d+)$/, '$1.$2')
  const found = /^(-?)(\d+(?:\.\d{1,2})?)$/.exec(trimmed)
  if (!found || (found[1] === '-' && !signed)) return null
  if (!signed && Number(found[2]) > 100) return null
  return Math.round(Number(trimmed) * 100)
}
