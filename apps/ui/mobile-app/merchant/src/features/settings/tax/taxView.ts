import type { TaxClass, TaxZone } from '../../../api/settingsTax'
import { locale } from '../../../messages'

/** What the home country calls its tax, and whether its stores usually type prices with it included; "tax" for a store with no country yet. */
export const taxWordsFor = (country: string | null): { name: 'gst' | 'salesTax' | 'vat' | 'tax'; usuallyIncluded: boolean } =>
  country === null ? { name: 'tax', usuallyIncluded: false } : country === 'IN' ? { name: 'gst', usuallyIncluded: true } : country === 'US' || country === 'CA' ? { name: 'salesTax', usuallyIncluded: false } : { name: 'vat', usuallyIncluded: true }

/** A US store's rates come from the shopper's state, so it adds and changes none here; any other store's are by category at home. */
export const ratesAtHome = (country: string | null): boolean => country !== null && country !== 'US'

/** The zone for the home country as a whole (no regions): the rate a category has at home. */
export const homeZone = (zones: readonly TaxZone[], country: string | null): TaxZone | null =>
  zones.find((zone) => country !== null && zone.countries.includes(country) && zone.regions.length === 0) ?? null

export const rateOf = (home: TaxZone | null, taxClass: TaxClass): number | null => home?.rates.find((rate) => rate.taxClassId === taxClass.id)?.rateBps ?? null

/** A rate in basis points as a percentage the way the API holds it: 1200 is "12%", 750 is "7.5%". */
export const percent = (bps: number): string => `${new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(bps / 100)}%`

/** What a category's menu offers: make it the default, change its rate at home, delete it (never the default, nor one a version uses). */
export const actionsFor = (taxClass: TaxClass, country: string | null): ('default' | 'rate' | 'delete')[] => [
  ...(taxClass.isDefault ? [] : (['default'] as const)),
  ...(ratesAtHome(country) ? (['rate'] as const) : []),
  ...(taxClass.isDefault || taxClass.versions > 0 ? [] : (['delete'] as const)),
]
