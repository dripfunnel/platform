import type { MessageKey } from '../../messages'
import { compact, isPhone } from '../account/validation'

// An address's fields by country, as the website's form has them (storefront-core checkout/address.ts, DESIGN §6): which
// a country needs, what each is called, and the checks on them. The API checks again. A copy, kept equal by rules.parity.test.ts.
export type Draft = { name: string; line1: string; line2: string; city: string; region: string; postalCode: string; country: string; phone: string }
export type Field = Exclude<keyof Draft, 'country'>
export type Problem = 'required' | 'invalid'

type Rules = { postal: { label: MessageKey; required: boolean; pattern: RegExp | null }; region: { label: MessageKey; required: boolean } }

const byCountry: Readonly<Record<string, Rules>> = {
  IN: { postal: { label: 'address.pin', required: true, pattern: /^\d{6}$/ }, region: { label: 'address.state', required: true } },
  US: { postal: { label: 'address.zip', required: true, pattern: /^\d{5}(?:-\d{4})?$/ }, region: { label: 'address.state', required: true } },
  GB: { postal: { label: 'address.postcode', required: true, pattern: /^[A-Z]{1,2}\d[A-Z\d]? ?\d[A-Z]{2}$/i }, region: { label: 'address.county', required: false } },
}
const otherwise: Rules = { postal: { label: 'address.postal', required: false, pattern: null }, region: { label: 'address.region', required: false } }

export const addressRules = (country: string): Rules => byCountry[country] ?? otherwise

/** The fields in the order they are filled, each with its label and whether it may be left empty. */
export const addressFields = (country: string): { field: Field; label: MessageKey; optional: boolean; autoComplete: 'name' | 'address-line1' | 'address-line2' | 'postal-address-locality' | 'postal-address-region' | 'postal-code' | 'tel' }[] => {
  const rules = addressRules(country)
  return [
    { field: 'name', label: 'address.name', optional: false, autoComplete: 'name' },
    { field: 'line1', label: 'address.line1', optional: false, autoComplete: 'address-line1' },
    { field: 'line2', label: 'address.line2', optional: true, autoComplete: 'address-line2' },
    { field: 'city', label: 'address.city', optional: false, autoComplete: 'postal-address-locality' },
    { field: 'region', label: rules.region.label, optional: !rules.region.required, autoComplete: 'postal-address-region' },
    { field: 'postalCode', label: rules.postal.label, optional: !rules.postal.required, autoComplete: 'postal-code' },
    { field: 'phone', label: 'address.phone', optional: true, autoComplete: 'tel' },
  ]
}

/** What is missing or malformed; empty when the address can be sent. */
export const addressProblems = (a: Draft): Partial<Record<Field | 'country', Problem>> => {
  const problems: Partial<Record<Field | 'country', Problem>> = {}
  const rules = addressRules(a.country)
  for (const f of addressFields(a.country)) if (!f.optional && !a[f.field].trim()) problems[f.field] = 'required'
  if (!a.country) problems.country = 'required'
  if (a.postalCode.trim() && rules.postal.pattern && !rules.postal.pattern.test(a.postalCode.trim())) problems.postalCode = 'invalid'
  if (a.phone.trim() && !isPhone(compact(a.phone))) problems.phone = 'invalid'
  return problems
}
