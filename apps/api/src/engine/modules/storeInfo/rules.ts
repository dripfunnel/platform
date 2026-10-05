import type { StoreAddress, StoreInfoWrite } from '#db/scoped/storeInfo'
import { isUuid } from '#core/ids'

// What Settings › Store info may hold (SetStore; CATALOG fact 36): any country's address format, a real time
// zone, and the home country's tax id in its own shape.

export type StoreInfoRefusal = 'INVALID_INPUT' | 'INVALID_EMAIL' | 'INVALID_TIME_ZONE' | 'INVALID_TAX_ID'

export interface StoreInfoInput {
  name: string
  legalName?: string | null | undefined
  description?: string | null | undefined
  logoAssetId?: string | null | undefined
  address?: Partial<StoreAddress> | null | undefined
  contactEmail?: string | null | undefined
  contactPhone?: string | null | undefined
  taxId?: string | null | undefined
  timeZone: string
  unitSystem: string
  orderPrefix?: string | null | undefined
  nextOrderNumber: number
}

const isTimeZone = (zone: string): boolean => {
  try {
    new Intl.DateTimeFormat('en', { timeZone: zone })
    return true
  } catch {
    return false
  }
}

/** The tax id's kind by the home country's format (prototype: GSTIN; EIN or sales-tax permit; VAT number). */
export const taxIdOf = (country: string | null, raw: string): { kind: 'gst' | 'ein' | 'sales_tax_permit' | 'vat'; number: string } | null => {
  const value = raw.trim().toUpperCase().replaceAll(' ', '')
  if (country === 'IN') return /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(value) ? { kind: 'gst', number: value } : null
  if (country === 'US') return /^\d{2}-?\d{7}$/.test(value) ? { kind: 'ein', number: value } : /^[A-Z0-9-]{3,30}$/.test(value) ? { kind: 'sales_tax_permit', number: value } : null
  return /^[A-Z0-9-]{3,30}$/.test(value) ? { kind: 'vat', number: value } : null
}

const field = (value: string | null | undefined, max: number): string | null | false => {
  const text = (value ?? '').trim()
  return text.length > max ? false : text === '' ? null : text
}

export const cleanStoreInfo = (input: StoreInfoInput, country: string | null): (StoreInfoWrite & { legalName: string; taxId: ReturnType<typeof taxIdOf> }) | StoreInfoRefusal => {
  const name = input.name.trim()
  const description = (input.description ?? '').trim()
  if (name === '' || name.length > 80 || description.length > 120) return 'INVALID_INPUT'
  const legal = field(input.legalName, 200)
  const email = field(input.contactEmail, 320)
  const phone = field(input.contactPhone, 40)
  const street = field(input.address?.street, 200)
  const city = field(input.address?.city, 100)
  const postal = field(input.address?.postal, 20)
  const region = field(input.address?.region, 100)
  if ([legal, email, phone, street, city, postal, region].includes(false)) return 'INVALID_INPUT'
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return 'INVALID_EMAIL'
  if (!isTimeZone(input.timeZone)) return 'INVALID_TIME_ZONE'
  if (input.unitSystem !== 'metric' && input.unitSystem !== 'imperial') return 'INVALID_INPUT'
  const prefix = (input.orderPrefix ?? '').trim().toUpperCase()
  if (!/^[A-Z0-9-]{0,6}$/.test(prefix) || !Number.isInteger(input.nextOrderNumber) || input.nextOrderNumber < 1 || input.nextOrderNumber > 999_999_999) return 'INVALID_INPUT'
  const logo = input.logoAssetId ? input.logoAssetId.toLowerCase() : null
  if (logo !== null && !isUuid(logo)) return 'INVALID_INPUT'
  const rawTax = (input.taxId ?? '').trim()
  // A tax id is the home country's: a store with none set has nowhere to file it.
  const taxId = rawTax === '' || country === null ? null : taxIdOf(country, rawTax)
  if (rawTax !== '' && !taxId) return 'INVALID_TAX_ID'
  return {
    name,
    description,
    logoAssetId: logo,
    address: { street: street || '', city: city || '', postal: postal || '', region: region || '' },
    contactEmail: email || null,
    contactPhone: phone || null,
    timeZone: input.timeZone,
    unitSystem: input.unitSystem,
    orderPrefix: prefix,
    nextOrderNumber: input.nextOrderNumber,
    legalName: legal || '',
    taxId,
  }
}
