import type { Entitlements, PartnerContract, PlanVersionPrice } from '#db/scoped/plans'

// The prototype's plan catalogue (designs/partner-data.js DFMAX and PLANS), keyed by the seed's
// partner key and plan name. Amounts are minor units.
export const ceilings = { products: 20000, staff: 25, suppliers: 50, languages: 5, currencies: 5, publish_now: 300, ai_prompts: 1000 } as const

export const contracts: Record<string, Omit<PartnerContract, 'partnerId'>> = {
  ns: { feeCurrency: 'USD', poweredByRemovable: true, poweredByNote: 'contract', rates: { CAD: '1.351351' } },
  // "Must stay on for the first year" (Kaufladen's contract in the prototype).
  kl: { feeCurrency: 'EUR', poweredByRemovable: false, poweredByNote: 'firstYear', rates: {} },
}

interface CatalogueEntry {
  trialDays: number
  prices: PlanVersionPrice[]
  feeMinor: number
  entitlements: Entitlements
}

const e = (
  [customDomain, offers, suppliersEnabled, poweredBy, aplus, sizeCharts]: readonly boolean[],
  [products, staff, suppliers, languages, currencies, publish, ai]: readonly number[],
): Entitlements => ({
  custom_domain: customDomain ?? false,
  offers: offers ?? false,
  suppliers_enabled: suppliersEnabled ?? false,
  powered_by_removal: poweredBy ?? false,
  aplus: aplus ?? false,
  size_charts: sizeCharts ?? false,
  products: products ?? 0,
  staff: staff ?? 0,
  suppliers: suppliers ?? 0,
  languages: languages ?? 0,
  currencies: currencies ?? 0,
  publish_now: publish ?? 0,
  ai_prompts: ai ?? 0,
})

const usdCad = (usd: [number, number], cad: [number, number]): PlanVersionPrice[] => [
  { currency: 'USD', monthly: usd[0], yearly: usd[1] },
  { currency: 'CAD', monthly: cad[0], yearly: cad[1] },
]
const unpricedEur: PlanVersionPrice[] = [{ currency: 'EUR', monthly: null, yearly: null }]

export const catalogue: Record<string, CatalogueEntry> = {
  'ns:Starter': { trialDays: 14, prices: usdCad([2900, 29000], [3900, 39000]), feeMinor: 1200, entitlements: e([false, false, false, false, false, true], [500, 2, 0, 1, 1, 20, 50]) },
  'ns:Growth': { trialDays: 14, prices: usdCad([4900, 49000], [6500, 65000]), feeMinor: 1800, entitlements: e([true, true, true, false, true, true], [5000, 5, 5, 2, 2, 60, 200]) },
  'ns:Pro': { trialDays: 14, prices: usdCad([9900, 99000], [12900, 129000]), feeMinor: 3500, entitlements: e([true, true, true, true, true, true], [10000, 15, 20, 4, 3, 150, 500]) },
  // The prototype's "Basic (2024)".
  'ns:Launch (retired)': { trialDays: 0, prices: usdCad([1900, 19000], [2500, 25000]), feeMinor: 1000, entitlements: e([false, false, false, false, false, false], [200, 1, 0, 1, 1, 10, 0]) },
  // Kaufladen's three plans are unpriced; the third is the prototype's "Profi".
  'kl:Basis': { trialDays: 14, prices: unpricedEur, feeMinor: 1100, entitlements: e([false, false, false, false, false, true], [500, 2, 0, 2, 1, 20, 50]) },
  'kl:Plus': { trialDays: 14, prices: unpricedEur, feeMinor: 1700, entitlements: e([true, true, true, false, true, true], [5000, 5, 5, 2, 1, 60, 200]) },
  'kl:Enterprise': { trialDays: 14, prices: unpricedEur, feeMinor: 3200, entitlements: e([true, true, true, false, true, true], [10000, 15, 20, 2, 1, 150, 500]) },
}

/** A plan the prototype does not price: its #32 limits, nothing else switched on. */
export const fallbackEntitlements = (maxProducts: number | null, maxStaff: number | null): Entitlements =>
  e([false, false, false, false, false, false], [maxProducts ?? ceilings.products, maxStaff ?? ceilings.staff, 0, 1, 1, 0, 0])
