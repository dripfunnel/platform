// The European Central Bank's euro reference rates (CATALOG fact 26, O5): one fixed public URL, no key, published
// each working day. Only the date and each currency's rate are read; anything else in the file is ignored.

export interface ReferenceRates {
  /** The day the rates are for, YYYY-MM-DD. */
  publishedOn: string
  /** Units of each currency per euro, as the decimal strings published. */
  perEuro: Record<string, string>
}

export interface RatesSource {
  fetch: (signal: AbortSignal) => Promise<ReferenceRates>
}

const ratesUrl = 'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml'

/** The rates in the ECB's daily file, or null when it isn't the shape published. */
export const parseReferenceRates = (xml: string): ReferenceRates | null => {
  const day = /<Cube\s+time=['"](\d{4}-\d{2}-\d{2})['"]/.exec(xml)?.[1]
  if (!day) return null
  const perEuro: Record<string, string> = {}
  for (const match of xml.matchAll(/<Cube\s+currency=['"]([A-Z]{3})['"]\s+rate=['"](\d{1,10}(?:\.\d{1,12})?)['"]\s*\/>/g)) {
    const [, currency, rate] = match
    if (currency && rate) perEuro[currency] = rate
  }
  return Object.keys(perEuro).length > 0 ? { publishedOn: day, perEuro } : null
}

export const ecbRates = (fetchImpl: typeof fetch = fetch): RatesSource => ({
  fetch: async (signal) => {
    const response = await fetchImpl(ratesUrl, { headers: { accept: 'application/xml' }, signal })
    if (!response.ok) throw new Error(`reference rates answered ${response.status}`)
    const rates = parseReferenceRates(await response.text())
    if (!rates) throw new Error('reference rates answered in a shape we do not read')
    return rates
  },
})
