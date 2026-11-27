import type { BillingMoney } from '../../api/billing'
import type { Paged } from './Billing'

// Billing as the API answers it (designs/partner-data.js's figures), for the screen's tests only.
const pageInfo = { startCursor: null, endCursor: null, hasPreviousPage: false, hasNextPage: false }

export const billingMoney: BillingMoney = {
  invoices: { items: [{ id: 'i1', number: 'INV-2026-0042', at: '2026-09-01T00:00:00.000Z', what: 'Priority support, September', amount: { amount: 29900, currency: 'USD' }, status: 'paid' }], pageInfo },
  staleSince: null,
}

/** A list as the screen pages it, with nothing more to show unless asked. */
export const paged = <T,>(items: readonly T[], more = false): Paged<T> => ({ items, more: { show: more, busy: false, failed: false }, onMore: () => undefined })
