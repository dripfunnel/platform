import type { MessageKey } from '../platform/i18n/messages'

// The delivery address's fields by country (storefront ARCHITECTURE §2.1 `ui/headless` "address form (country-aware
// fields)"; DESIGN §6 "required fields per country"): which a country needs, what each is called, and the checks on them.

/** Where the shopper put the address on the map (#814); whole or not at all. */
export type Pin = { latitude: number; longitude: number }

export type AddressDraft = { name: string; line1: string; line2: string; city: string; region: string; postalCode: string; country: string; phone: string; pin?: Pin | null }
export type AddressField = Exclude<keyof AddressDraft, 'pin'>

/** The pin an address arrived with, when it has both halves. */
export const pinOf = (a: { latitude?: number | null | undefined; longitude?: number | null | undefined } | null | undefined): Pin | null =>
  typeof a?.latitude === 'number' && typeof a.longitude === 'number' ? { latitude: a.latitude, longitude: a.longitude } : null
export type FieldProblem = 'required' | 'invalid'

type Rules = { postal: { label: MessageKey; required: boolean; pattern: RegExp | null }; region: { label: MessageKey; required: boolean } }

const byCountry: Readonly<Record<string, Rules>> = {
  IN: { postal: { label: 'address.pin', required: true, pattern: /^\d{6}$/ }, region: { label: 'address.state', required: true } },
  US: { postal: { label: 'address.zip', required: true, pattern: /^\d{5}(?:-\d{4})?$/ }, region: { label: 'address.state', required: true } },
  GB: { postal: { label: 'address.postcode', required: true, pattern: /^[A-Z]{1,2}\d[A-Z\d]? ?\d[A-Z]{2}$/i }, region: { label: 'address.county', required: false } },
}
const otherwise: Rules = { postal: { label: 'address.postal', required: false, pattern: null }, region: { label: 'address.region', required: false } }

export const addressRules = (country: string): Rules => byCountry[country] ?? otherwise

/** The fields in the order a shopper fills them, each with its label and whether it may be left empty. */
export const addressFields = (country: string): { field: AddressField; label: MessageKey; optional: boolean; autoComplete: string }[] => {
  const rules = addressRules(country)
  return [
    { field: 'name', label: 'address.name', optional: false, autoComplete: 'shipping name' },
    { field: 'line1', label: 'address.line1', optional: false, autoComplete: 'shipping address-line1' },
    { field: 'line2', label: 'address.line2', optional: true, autoComplete: 'shipping address-line2' },
    { field: 'city', label: 'address.city', optional: false, autoComplete: 'shipping address-level2' },
    { field: 'region', label: rules.region.label, optional: !rules.region.required, autoComplete: 'shipping address-level1' },
    { field: 'postalCode', label: rules.postal.label, optional: !rules.postal.required, autoComplete: 'shipping postal-code' },
    { field: 'phone', label: 'address.phone', optional: true, autoComplete: 'shipping tel' },
  ]
}

// The same shape the API accepts (E.164), spaces, dashes, dots and brackets aside.
const phonePattern = /^\+[1-9]\d{6,14}$/
export const compact = (value: string) => value.trim().replaceAll(/[\s().-]/g, '')

/** What is missing or malformed; empty when the address can be sent. */
export const addressProblems = (a: AddressDraft): Partial<Record<AddressField, FieldProblem>> => {
  const problems: Partial<Record<AddressField, FieldProblem>> = {}
  const rules = addressRules(a.country)
  for (const f of addressFields(a.country)) if (!f.optional && !a[f.field].trim()) problems[f.field] = 'required'
  if (!a.country) problems.country = 'required'
  if (a.postalCode.trim() && rules.postal.pattern && !rules.postal.pattern.test(a.postalCode.trim())) problems.postalCode = 'invalid'
  if (a.phone.trim() && !phonePattern.test(compact(a.phone))) problems.phone = 'invalid'
  return problems
}

/** What Google says is at a pin, in the address form's terms. */
export type Place = { line1: string | null; city: string | null; region: string | null; postalCode: string | null; country: string }

const placeFields = ['line1', 'city', 'region', 'postalCode'] as const

/** What the map last wrote in each field, so a new pin may replace it while the shopper leaves it as it is. */
export type MapFilled = Partial<Record<(typeof placeFields)[number], string>>

/**
 * The pin's address in each field that is empty or still as the map last filled it; what the shopper typed is never
 * replaced, and nothing at all comes from another country.
 */
export const fillFromPlace = (a: AddressDraft, place: Place | null, countries: readonly string[], filled: MapFilled = {}): { draft: AddressDraft; filled: MapFilled } => {
  if (!place || (a.country ? a.country !== place.country : !countries.includes(place.country))) return { draft: a, filled }
  const draft = { ...a, country: a.country || place.country }
  const next: MapFilled = {}
  for (const f of placeFields) {
    if (a[f].trim() !== '' && a[f] !== filled[f]) continue
    draft[f] = place[f] ?? ''
    if (place[f]) next[f] = place[f]
  }
  return { draft, filled: next }
}

/** An address as the Shop API takes it (ShopAddressInput, ShopSavedAddressInput). */
export const addressInput = (a: AddressDraft) => ({
  name: a.name.trim(),
  line1: a.line1.trim(),
  line2: a.line2.trim() || null,
  city: a.city.trim(),
  region: a.region.trim() || null,
  postalCode: a.postalCode.trim() || null,
  country: a.country,
  phone: compact(a.phone) || null,
  latitude: a.pin?.latitude ?? null,
  longitude: a.pin?.longitude ?? null,
})

export const emailPattern =/^[^\s@]+@[^\s@]+\.[^\s@]+$/
export const isPhone = (value: string) => phonePattern.test(compact(value))
