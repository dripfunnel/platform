import type { StoreCurrency, StoreInfo, StoreInfoInput, StoreLocale, Rounding } from '../../../api/settingsStore'
import { formatMoney } from '@dripfunnel/mobile-shared/format'
import { locale } from '../../../messages'

/** The details card as typed: the next order number stays text until saved, so it can be cleared and retyped. */
export type StoreForm = Omit<StoreInfoInput, 'nextOrderNumber'> & { nextOrderNumber: string }

export const formOf = (info: StoreInfo): StoreForm => ({
  name: info.name,
  legalName: info.legalName ?? '',
  description: info.description ?? '',
  logoAssetId: info.logoAssetId,
  address: { street: info.address?.street ?? '', city: info.address?.city ?? '', postal: info.address?.postal ?? '', region: info.address?.region ?? '' },
  contactEmail: info.contactEmail ?? '',
  contactPhone: info.contactPhone ?? '',
  taxId: info.taxId ?? '',
  timeZone: info.timeZone,
  unitSystem: info.unitSystem,
  orderPrefix: info.orderPrefix ?? '',
  nextOrderNumber: info.nextOrderNumber,
})

export const isDirty = (form: StoreForm, saved: StoreForm): boolean => JSON.stringify(form) !== JSON.stringify(saved)

export type InfoProblem = 'nameMissing' | 'nextMissing'

/** What can't be saved yet, said before the API would refuse it: a name, and an order number of 1 or more. */
export const problemOf = (form: StoreForm): InfoProblem | null => {
  if (form.name.trim() === '') return 'nameMissing'
  if (!/^\d{1,9}$/.test(form.nextOrderNumber.trim()) || Number(form.nextOrderNumber) < 1) return 'nextMissing'
  return null
}

/** The form as the API takes it: the prefix upper-case (letters, numbers and `-`) and the number as a number. */
export const inputOf = (form: StoreForm): StoreInfoInput => ({ ...form, orderPrefix: form.orderPrefix.toUpperCase(), nextOrderNumber: Number(form.nextOrderNumber) })

export const cleanPrefix = (text: string): string => text.toUpperCase().replace(/[^A-Z0-9-]/g, '')
export const cleanNumber = (text: string): string => text.replace(/\D/g, '')

/** Which wording the address and tax-id fields use: the home country's own words (SetStore), and one for any other. */
export const countryWords = (country: string | null): 'IN' | 'US' | 'other' => (country === 'IN' ? 'IN' : country === 'US' ? 'US' : 'other')

/** What the API sends of one currency: its code, whether it converts or is typed, and how it rounds. */
export const sameCurrencies = (a: readonly StoreCurrency[], b: readonly StoreCurrency[]): boolean =>
  JSON.stringify(a.map(({ code, mode, rounding }) => ({ code, mode, rounding }))) === JSON.stringify(b.map(({ code, mode, rounding }) => ({ code, mode, rounding })))

/** Currencies the store can add: every one the API has a reference rate for (converting needs one), but not the main one or those already added. */
export const addableCurrencies = (loc: StoreLocale, list: readonly StoreCurrency[]): string[] =>
  loc.examples
    .map((example) => example.currency)
    .filter((code, index, all) => all.indexOf(code) === index && code !== loc.pricingCurrency && !list.some((c) => c.code === code))
    .sort()

/** "₹100.00 → $1.99": the API's worked example for that currency and rounding. The app only formats it; it never works a rate out. */
export const exampleOf = (to: string, rounding: Rounding, examples: StoreLocale['examples']): { text: string; date: string | null } | null => {
  const found = examples.find((example) => example.currency === to)
  const result = found && (rounding === 'ends-99' ? found.ends99 : rounding === 'nearest' ? found.nearest : found.none)
  if (!found || !result) return null
  return { text: `${formatMoney({ amount: found.from.amount, currency: found.from.currency }, locale)} → ${formatMoney({ amount: result.amount, currency: to }, locale)}`, date: found.publishedOn }
}
