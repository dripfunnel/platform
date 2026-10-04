import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { invoicePdf, loadBilling, setBillingMode } from './billing'

// The billing rules are the Platform API's (apps/api tests/platform-billing); these check the client.
const answer = vi.fn<(body: { query: string; variables?: Record<string, unknown> }) => unknown>()
beforeEach(() => {
  answer.mockReset()
  vi.stubGlobal('fetch', (_: string, init: RequestInit) => Promise.resolve(new Response(JSON.stringify(answer(JSON.parse(String(init.body)) as { query: string })))))
})
afterEach(() => void vi.unstubAllGlobals())

const pageInfo = { startCursor: null, endCursor: 'c1', hasPreviousPage: false, hasNextPage: true }
const usd = (amount: number) => ({ amount, currency: 'USD' })
const billing = {
  merchantPayments: { failed: [], items: [{ id: 'p1', at: '2026-10-01T00:00:00Z', storeId: 's1', storeName: 'Juniper', kind: 'subscription', amount: usd(4900), status: 'paid', note: null, cardLast4: '4242' }], pageInfo },
  nextPayout: { state: 'scheduled', date: '2026-11-01', soFar: usd(4410), toLast4: '1180' },
  payouts: { items: [], pageInfo },
  partnerInvoices: { items: [], pageInfo },
  billingSettings: { staleSince: null, payoutAccount: { bank: 'Chase', last4: '1180', status: 'verified', failure: null } },
}

describe('billing', () => {
  it('reads the four parts in one request, keeping the retrying block apart from the paged list', async () => {
    answer.mockReturnValueOnce({ data: billing })
    const money = await loadBilling()
    expect(answer).toHaveBeenCalledTimes(1)
    expect(money.payments.pageInfo.hasNextPage).toBe(true)
    expect(money.payments.items).toHaveLength(1)
    expect(money.nextPayout).toEqual({ state: 'scheduled', date: '2026-11-01', soFar: usd(4410), toLast4: '1180' })
  })

  it('refuses a scheduled payout without its date', async () => {
    answer.mockReturnValueOnce({ data: { ...billing, nextPayout: { state: 'scheduled', date: null, soFar: null, toLast4: null } } })
    await expect(loadBilling()).rejects.toMatchObject({ code: 'BAD_RESPONSE' })
  })

  it('words a known refusal and errors on one it doesn’t know', async () => {
    answer.mockReturnValueOnce({ data: { setBillingMode: { ok: false, reason: 'INVALID_INPUT' } } })
    expect(await setBillingMode('own')).toEqual({ ok: false, reason: 'INVALID_INPUT' })
    answer.mockReturnValueOnce({ data: { setBillingMode: { ok: false, reason: 'SOMETHING_NEW' } } })
    await expect(setBillingMode('own')).rejects.toMatchObject({ code: 'SOMETHING_NEW' })
  })

  it('opens only a Stripe link for an invoice PDF', async () => {
    answer.mockReturnValueOnce({ data: { downloadInvoice: { ok: true, reason: null, url: 'https://pay.stripe.com/invoice/x/pdf' } } })
    expect(await invoicePdf('i1')).toEqual({ ok: true, url: 'https://pay.stripe.com/invoice/x/pdf' })
    answer.mockReturnValueOnce({ data: { downloadInvoice: { ok: true, reason: null, url: 'https://evil.example/pdf' } } })
    await expect(invoicePdf('i1')).rejects.toMatchObject({ code: 'BAD_RESPONSE' })
    answer.mockReturnValueOnce({ data: { downloadInvoice: { ok: false, reason: 'NO_PDF', url: null } } })
    expect(await invoicePdf('i1')).toEqual({ ok: false, reason: 'NO_PDF' })
  })
})
