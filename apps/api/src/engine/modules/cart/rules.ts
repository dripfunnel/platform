import { isCountry } from '#core/countries'
import { isE164 } from '#core/sms'
import type { Money } from '#core/money'
import type { CartAddress } from '#db/scoped/cart'

// The pure rules of a cart (PLATFORM-PROMPT §5.4 Cart and checkout): what an address and a contact must hold, what each
// line may be bought as, and what stands between the cart and payment.

export const maxCartLines = 100
export const maxQuantity = 999
export const cartLifeMs = 30 * 86_400_000

export interface AddressInput {
  name: string
  line1: string
  line2?: string | null | undefined
  city: string
  region?: string | null | undefined
  postalCode?: string | null | undefined
  country: string
  phone?: string | null | undefined
}

const text = (value: string | null | undefined): string | null => value?.trim() || null

/** An address as the cart keeps it; null when a required part is missing or anything is too long or malformed. */
export const cleanAddress = (input: AddressInput): CartAddress | null => {
  const fields = [input.name, input.line1, input.line2, input.city, input.region, input.postalCode, input.phone]
  if (fields.some((f) => (f?.trim().length ?? 0) > 200) || (input.postalCode?.trim().length ?? 0) > 20) return null
  const country = input.country.trim().toUpperCase()
  const phone = text(input.phone)?.replaceAll(/[\s-]/g, '') ?? null
  const address: CartAddress = {
    name: text(input.name) ?? '',
    line1: text(input.line1) ?? '',
    line2: text(input.line2),
    city: text(input.city) ?? '',
    region: text(input.region),
    postalCode: text(input.postalCode),
    country,
    phone,
  }
  if (address.name === '' || address.line1 === '' || address.city === '' || !isCountry(country) || (phone !== null && !isE164(phone))) return null
  return address
}

const email = /^[^\s@]{1,64}@[^\s@]{1,253}\.[^\s@]{2,}$/

export const cleanContact = (input: { email?: string | null | undefined; phone?: string | null | undefined }): { email: string | null; phone: string | null } | null => {
  const e = input.email?.trim().toLowerCase() || null
  const p = input.phone?.trim().replaceAll(/[\s-]/g, '') || null
  if ((e !== null && (e.length > 254 || !email.test(e))) || (p !== null && !isE164(p))) return null
  return { email: e, phone: p }
}

export type LineProblem = 'unavailable' | 'not_sold_here' | 'not_priced' | 'short'

export interface PricedLine {
  versionId: string
  quantity: number
  unitPrice: Money | null
  lineTotal: Money | null
  available: number | null
  problem: LineProblem | null
}

export interface LineFacts {
  versionId: string
  quantity: number
  /** Null when the shopper can't see the version any more. */
  item: { price: Money | null; available: number | null; inStock: boolean; continueSelling: boolean; soldHere: boolean } | null
}

/** Each line at today's price, or what stops it being bought: gone, not sold here, unpriced, or more than is left. */
export const priceLine = (l: LineFacts): PricedLine => {
  const base = { versionId: l.versionId, quantity: l.quantity, available: l.item?.available ?? null }
  if (!l.item) return { ...base, unitPrice: null, lineTotal: null, problem: 'unavailable' }
  if (!l.item.soldHere) return { ...base, unitPrice: l.item.price, lineTotal: null, problem: 'not_sold_here' }
  if (!l.item.price) return { ...base, unitPrice: null, lineTotal: null, problem: 'not_priced' }
  const short = l.item.available !== null && !l.item.continueSelling && l.quantity > l.item.available
  const lineTotal = { amount: l.item.price.amount * BigInt(l.quantity), currency: l.item.price.currency }
  return { ...base, unitPrice: l.item.price, lineTotal, problem: short ? 'short' : null }
}

export type CheckoutProblem = 'EMPTY' | 'LINE_PROBLEM' | 'NO_CONTACT' | 'NO_ADDRESS' | 'NO_SHIPPING' | 'SHIPPING_UNAVAILABLE' | 'TAX_UNAVAILABLE'

export interface CheckoutFacts {
  lines: readonly PricedLine[]
  hasContact: boolean
  /** Whether anything in it is sent: a download, a service and a gift card are not (CATALOG T14). */
  needsShipping: boolean
  shippingOption: 'courier' | 'flat' | 'pickup' | null
  hasShippingAddress: boolean
  /** Whether the chosen option is among the options offered now. */
  optionOffered: boolean
  taxKnown: boolean
}

/** What stands between the cart and payment, in the order a checkout asks for it; empty when it can be paid. */
export const checkoutProblems = (f: CheckoutFacts): CheckoutProblem[] => {
  const problems: CheckoutProblem[] = []
  if (f.lines.length === 0) problems.push('EMPTY')
  if (f.lines.some((l) => l.problem !== null)) problems.push('LINE_PROBLEM')
  if (!f.hasContact) problems.push('NO_CONTACT')
  if (f.needsShipping) {
    if (f.shippingOption !== 'pickup' && !f.hasShippingAddress) problems.push('NO_ADDRESS')
    if (f.shippingOption === null) problems.push('NO_SHIPPING')
    else if (!f.optionOffered) problems.push('SHIPPING_UNAVAILABLE')
  }
  if (!f.taxKnown) problems.push('TAX_UNAVAILABLE')
  return problems
}
