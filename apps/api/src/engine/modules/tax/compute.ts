// Tax on a cart's lines from the store's own rates (CATALOG facts 37–38; PLATFORM-PROMPT §5.4 Tax): class × the
// shopper's zone, prices including tax or not (fact 6). India's GST splits into CGST and SGST within the store's
// own state and is IGST across states; a US store without Stripe charges its own state rates (decided on #337).

export interface TaxableLine {
  id: string
  /** The line's amount in the cart's currency, in minor units: what the shopper pays before tax is added, or with it. */
  amount: bigint
  /** The version's class, or null for the store's default. */
  taxClassId: string | null
}

export interface StoreRate {
  taxClassId: string
  countries: readonly string[]
  /** Regions within the countries; none is the whole of each. */
  regions: readonly string[]
  rateBps: number
}

export interface TaxSetting {
  inclusive: boolean
  defaultClassId: string | null
  /** Where the store is: its country, and its region for India's in-state split. */
  storeCountry: string | null
  storeRegion: string | null
  rates: readonly StoreRate[]
}

export interface ShipTo {
  country: string
  region: string | null
}

export interface TaxComponent {
  name: 'CGST' | 'SGST' | 'IGST' | 'Tax'
  /** Null from Stripe Tax, whose rate varies by jurisdiction and is answered as an amount. */
  rateBps: number | null
  amount: bigint
}

export interface LineTax {
  id: string
  rateBps: number | null
  amount: bigint
  components: TaxComponent[]
}

const same = (a: string | null, b: string | null) => a !== null && b !== null && a.trim().toLowerCase() === b.trim().toLowerCase()

/** The rate for a class where the shopper is: a zone naming their region beats one for their whole country. */
export const rateFor = (classId: string | null, shipTo: ShipTo, rates: readonly StoreRate[]): number => {
  if (classId === null) return 0
  const here = rates.filter((r) => r.taxClassId === classId && r.countries.includes(shipTo.country))
  const regional = here.find((r) => r.regions.length > 0 && r.regions.some((region) => same(region, shipTo.region)))
  return (regional ?? here.find((r) => r.regions.length === 0))?.rateBps ?? 0
}

/**
 * Whether two zones would both answer for one place and class, so rateFor couldn't choose: they share a country,
 * a class has a rate in both, and both are country-wide or both name a region in common (a region beats a country).
 */
export const zonesClash = (a: { countries: readonly string[]; regions: readonly string[]; classIds: readonly string[] }, b: typeof a): boolean => {
  if (!a.countries.some((c) => b.countries.includes(c)) || !a.classIds.some((c) => b.classIds.includes(c))) return false
  if (a.regions.length === 0 || b.regions.length === 0) return a.regions.length === b.regions.length
  return a.regions.some((r) => b.regions.some((other) => same(r, other)))
}

/** The tax in an amount: carved out of it when prices include tax, added on top when they don't. */
export const taxIn = (amount: bigint, rateBps: number, inclusive: boolean): bigint => {
  if (rateBps === 0 || amount === 0n) return 0n
  if (!inclusive) return (amount * BigInt(rateBps) + 5_000n) / 10_000n
  // The pre-tax part rounded half up, so the shopper's price is never what moves.
  const net = (amount * 20_000n + BigInt(10_000 + rateBps)) / (BigInt(10_000 + rateBps) * 2n)
  return amount - net
}

const splitGst = (tax: bigint, rateBps: number, inState: boolean): TaxComponent[] => {
  if (!inState) return [{ name: 'IGST', rateBps, amount: tax }]
  // Halves in whole basis points and minor units, the state's share taking any odd one, so they add up.
  const central = tax / 2n
  const centralRate = Math.floor(rateBps / 2)
  return [
    { name: 'CGST', rateBps: centralRate, amount: central },
    { name: 'SGST', rateBps: rateBps - centralRate, amount: tax - central },
  ]
}

export const computeTax = (lines: readonly TaxableLine[], shipTo: ShipTo, setting: TaxSetting): { lines: LineTax[]; total: bigint } => {
  const gst = setting.storeCountry === 'IN' && shipTo.country === 'IN'
  const inState = gst && same(setting.storeRegion, shipTo.region)
  const taxed = lines.map((line): LineTax => {
    const rateBps = rateFor(line.taxClassId ?? setting.defaultClassId, shipTo, setting.rates)
    const amount = taxIn(line.amount, rateBps, setting.inclusive)
    const components = amount === 0n ? [] : gst ? splitGst(amount, rateBps, inState) : [{ name: 'Tax' as const, rateBps, amount }]
    return { id: line.id, rateBps, amount, components }
  })
  return { lines: taxed, total: taxed.reduce((sum, l) => sum + l.amount, 0n) }
}
