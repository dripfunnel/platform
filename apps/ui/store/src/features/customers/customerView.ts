import type { ApiMoney } from '../../api/orders'
import type { Customer, CustomerAddress } from '../../api/customers'
import { fill, formatList, locale, messages } from '../../messages'
import { moneyText } from '../orders/orderView'

// How PortalOrders › Customers words a customer (FIRST-RELEASE §7): who may change what, what they've spent and their
// marketing consent. The API decides every figure; these only say them.

const words = messages.customers.detail

export interface CustomersAccess {
  canRead: boolean
  canEdit: boolean
  canExport: boolean
  /** What they've spent: never Staff's to see (PortalOrders `money`). */
  money: boolean
  readOnly: boolean
}

export const customersAccessOf = (acting: { role: string; permissions: readonly string[] }, readOnly: boolean): CustomersAccess => {
  const has = (p: string) => acting.permissions.includes(p)
  return { canRead: has('customers.read'), canEdit: has('customers.write') && !readOnly, canExport: has('customers.export'), money: acting.role !== 'staff', readOnly }
}

/** One figure a currency, as the API keeps them. */
export const spentText = (spent: readonly ApiMoney[]): string | null => (spent.length > 0 ? formatList(spent.map(moneyText)) : null)

export const dateText = (iso: string, timeZone: string): string => new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone }).format(new Date(iso))

export const defaultAddress = (customer: Customer): CustomerAddress | null => customer.addresses.find((a) => a.isDefault) ?? customer.addresses[0] ?? null

export const addressText = (a: CustomerAddress): string => [a.line1, a.line2, a.city, [a.region, a.postalCode].filter(Boolean).join(' '), a.country].filter((l): l is string => Boolean(l)).join(', ')

/** The consent box: what they agreed to, since when and where, and what the team may still record. */
export const consentOf = (customer: Customer, timeZone: string): { text: string; sub: string; yes: boolean } => {
  const { state, at, source, channels } = customer.consent
  const date = at ? dateText(at, timeZone) : ''
  const where = source === 'checkout' ? words.consent.where.checkout : source === 'email' ? words.consent.where.email : words.consent.where.other
  if (state === 'opted_in') return { text: channels.includes('sms') ? words.consent.opted_in_sms : words.consent.opted_in, sub: fill(words.consent.since, { date, where }), yes: true }
  if (state === 'stopped') return { text: words.consent.stopped, sub: fill(words.consent.stoppedOn, { date }), yes: false }
  if (state === 'declined') return { text: words.consent.declined, sub: fill(words.consent.since, { date, where }), yes: false }
  return { text: words.consent.not_asked, sub: source === 'added_by_hand' ? words.consent.byHand : words.consent.notAsked, yes: false }
}
