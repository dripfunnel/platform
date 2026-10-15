import type { Customer, CustomerAddress, CustomerSummary } from '../../api/customers'
import { formatDateTime, formatList, formatMoney, type Money } from '../../format'
import { locale, t } from '../../messages'
import { dotted } from '../settings/dotted'

/** What they've spent, one figure a currency as the API keeps them; null when nothing is paid yet. */
export const spentText = (spent: readonly Money[]): string | null => (spent.length > 0 ? formatList(spent.map((money) => formatMoney(money, locale)), locale) : null)

/** A row's second line: city and tags, or the email when it has neither. */
export const rowSub = (row: CustomerSummary): string => dotted([row.city, ...row.tags]) || (row.email ?? '')

export const defaultAddress = (customer: Customer): CustomerAddress | null => customer.addresses.find((a) => a.isDefault) ?? customer.addresses[0] ?? null

export const addressText = (a: CustomerAddress): string => [a.line1, a.line2, a.city, [a.region, a.postalCode].filter(Boolean).join(' '), a.country].filter((line): line is string => Boolean(line)).join(', ')

/** The consent box: what they agreed to, since when and where, and what the team may still record (only the shopper opts in). */
export const consentOf = (customer: Customer, timeZone: string): { text: string; sub: string; optedIn: boolean } => {
  const { state, at, source, channels } = customer.consent
  const date = at ? formatDateTime(at, locale, timeZone) : ''
  const where = source === 'checkout' ? t('customers.detail.consent.where.checkout') : source === 'email' ? t('customers.detail.consent.where.email') : t('customers.detail.consent.where.other')
  if (state === 'opted_in') return { text: channels.includes('sms') ? t('customers.detail.consent.optedInSms') : t('customers.detail.consent.optedIn'), sub: t('customers.detail.consent.since', { date, where }), optedIn: true }
  if (state === 'stopped') return { text: t('customers.detail.consent.stopped'), sub: t('customers.detail.consent.stoppedOn', { date }), optedIn: false }
  if (state === 'declined') return { text: t('customers.detail.consent.declined'), sub: t('customers.detail.consent.since', { date, where }), optedIn: false }
  return { text: t('customers.detail.consent.notAsked'), sub: source === 'added_by_hand' ? t('customers.detail.consent.byHand') : t('customers.detail.consent.notAskedSub'), optedIn: false }
}

export type OrderStatus = 'toShip' | 'partly' | 'shipped' | 'refunded' | 'cancelled'

/** The merchant's word for an order, from its three states (the Orders list words it the same way). */
export const orderStatusOf = (state: string, paymentState: string | null, fulfilmentState: string | null): OrderStatus =>
  state === 'cancelled' ? 'cancelled' : paymentState === 'refunded' ? 'refunded' : fulfilmentState === 'fulfilled' ? 'shipped' : fulfilmentState === 'partly_fulfilled' ? 'partly' : 'toShip'
