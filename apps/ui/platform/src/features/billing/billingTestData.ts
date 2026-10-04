import type { BillingMoney } from '../../api/billing'
import type { Paged } from './Billing'

// Billing as the API answers it (designs/partner-data.js's figures), for the screen's tests only.
const usd = (amount: number) => ({ amount, currency: 'USD' })
const pageInfo = { startCursor: null, endCursor: null, hasPreviousPage: false, hasNextPage: false }

export const billingMoney: BillingMoney = {
  failed: [{ id: 'c1', storeId: 's1', storeName: 'Lumen Candle Co.', amount: usd(4900), why: 'Card declined', cardLast4: '1881', retryAt: '2026-09-30T13:00:00.000Z', attempt: 4, attempts: 4 }],
  payments: {
    items: [
      { id: 'pay1', at: '2026-09-28T10:00:00.000Z', storeId: 's2', storeName: 'Harbor Coffee', kind: 'subscription', amount: usd(9900), status: 'paid', note: null, cardLast4: '4242' },
      { id: 'pay2', at: '2026-09-27T10:00:00.000Z', storeId: 's1', storeName: 'Lumen Candle Co.', kind: 'subscription', amount: usd(4900), status: 'failed', note: 'Card declined', cardLast4: '1881' },
      { id: 'pay3', at: '2026-09-20T10:00:00.000Z', storeId: 's3', storeName: 'Summit Supply', kind: 'refund', amount: usd(4900), status: 'refunded', note: 'Double charge', cardLast4: '5100' },
    ],
    pageInfo,
  },
  failedMore: false,
  nextPayout: { state: 'scheduled', date: '2026-10-01', soFar: usd(252240), toLast4: '1180' },
  payouts: {
    items: [
      { id: 'po1', month: '2026-08', collected: usd(426140), fee: usd(54000), adjustment: { amount: usd(-4900), note: 'Refund to Summit Supply for a double charge' }, payout: usd(367240), paidOn: '2026-09-01T00:00:00.000Z', status: 'paid', toLast4: '1180' },
    ],
    pageInfo,
  },
  invoices: { items: [{ id: 'i1', number: 'INV-2026-0042', at: '2026-09-01T00:00:00.000Z', what: 'Priority support, September', amount: usd(29900), status: 'paid' }], pageInfo },
  staleSince: null,
  payoutAccount: { bank: 'Chase', last4: '1180', status: 'verified', failure: null },
}

/** A list as the screen pages it, with nothing more to show unless asked. */
export const paged = <T,>(items: readonly T[], more = false): Paged<T> => ({ items, more: { show: more, busy: false, failed: false }, onMore: () => undefined })
