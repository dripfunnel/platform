import type { BillingMoney } from '../../api/billing'

// The ?state= harness's sample, so each part of §11 can be seen before #201 gives it an API
// (designs/partner-data.js's figures). Never shown outside the harness.
const usd = (amount: number) => ({ amount, currency: 'USD' })

export const billingSample: BillingMoney = {
  failed: [{ storeId: 's1', storeName: 'Lumen Candle Co.', amount: usd(4900), why: 'Card declined', cardLast4: '1881', retryAt: '2026-09-30T13:00:00.000Z', attempt: 4, attempts: 4 }],
  payments: [
    { id: 'pay1', at: '2026-09-28T10:00:00.000Z', storeId: 's2', storeName: 'Harbor Coffee', amount: usd(9900), status: 'paid', note: null, cardLast4: '4242' },
    { id: 'pay2', at: '2026-09-27T10:00:00.000Z', storeId: 's1', storeName: 'Lumen Candle Co.', amount: usd(4900), status: 'failed', note: 'Card declined', cardLast4: '1881' },
    { id: 'pay3', at: '2026-09-20T10:00:00.000Z', storeId: 's3', storeName: 'Summit Supply', amount: usd(4900), status: 'refunded', note: 'Double charge', cardLast4: '5100' },
  ],
  nextPayout: { state: 'scheduled', date: '2026-10-01T00:00:00.000Z', soFar: usd(252240), toLast4: '1180' },
  payouts: [
    { month: '2026-08-01T00:00:00.000Z', collected: usd(426140), fee: usd(54000), adjustment: { amount: usd(-4900), note: 'Refund to Summit Supply for a double charge' }, payout: usd(367240), paidOn: '2026-09-01T00:00:00.000Z', status: 'paid', toLast4: '1180' },
  ],
  invoices: [{ id: 'INV-2026-0042', at: '2026-09-01T00:00:00.000Z', what: 'Priority support, September', amount: usd(29900), status: 'paid', pdfUrl: null }],
  staleSince: null,
  payoutAccountLast4: '1180',
}
