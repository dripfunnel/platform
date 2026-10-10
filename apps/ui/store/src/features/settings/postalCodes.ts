// "Upload list" (SetOps "Where you deliver"): the codes in a CSV or text file, in the shape the API keeps for the
// store's country (apps/api/src/engine/modules/shipping/rules.ts `normalisePostal`), so one stray cell can't refuse the list.

/** The most codes a store's list may hold (the API's `maxPostalCodes`). */
export const maxPostalCodes = 50_000

const shapes: Record<string, RegExp> = { IN: /^[1-9]\d{5}$/, US: /^\d{5}(?:-?\d{4})?$/ }
const anyShape = /^(?=.*\d)[A-Z0-9]{3,10}$/

export type PostalRead = { kind: 'codes'; codes: string[] } | { kind: 'notText' } | { kind: 'none' } | { kind: 'tooMany' }

export const readPostalCodes = (fileName: string, text: string, country: string | null): PostalRead => {
  if (!/\.(csv|txt)$/i.test(fileName)) return { kind: 'notText' }
  const shape = (country ? shapes[country] : undefined) ?? anyShape
  const codes = [...new Set(text.split(/[\s,;"]+/).map((cell) => cell.trim().toUpperCase()).filter((cell) => shape.test(cell)))]
  if (codes.length === 0) return { kind: 'none' }
  if (codes.length > maxPostalCodes) return { kind: 'tooMany' }
  return { kind: 'codes', codes }
}
