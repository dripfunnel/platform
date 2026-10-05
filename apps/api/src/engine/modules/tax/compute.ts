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
  rateBps: number
  amount: bigint
}

export interface LineTax {
  id: string
  rateBps: number
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
  const central = tax / 2n
  return [
    { name: 'CGST', rateBps: rateBps / 2, amount: central },
    { name: 'SGST', rateBps: rateBps / 2, amount: tax - central },
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
