import type { MessageKey } from '../platform/i18n/messages'

// The delivery address's fields by country (storefront ARCHITECTURE §2.1 `ui/headless` "address form (country-aware
// fields)"; DESIGN §6 "required fields per country"): which a country needs, what each is called, and the checks on them.

export type AddressDraft = { name: string; line1: string; line2: string; city: string; region: string; postalCode: string; country: string; phone: string }
export type AddressField = keyof AddressDraft
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

export const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
export const isPhone = (value: string) => phonePattern.test(compact(value))
