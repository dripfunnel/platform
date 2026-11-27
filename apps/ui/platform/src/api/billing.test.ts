import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { invoicePdf, loadBilling, loadBillingClientConfig, setPaymentMethod, setPayoutAccount } from './billing'

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
  partnerInvoices: { items: [{ id: 'i1', number: 'INV-1', at: '2026-10-01T00:00:00Z', what: 'Priority support', amount: usd(29900), status: 'paid' }], pageInfo },
  billingSettings: { staleSince: null },
}

describe('billing', () => {
  it('reads DripFunnel’s invoices and the stale strip in one request', async () => {
    answer.mockReturnValueOnce({ data: billing })
    const money = await loadBilling()
    expect(answer).toHaveBeenCalledTimes(1)
    expect(answer.mock.lastCall?.[0].query).not.toMatch(/merchantPayments|payouts/)
    expect(money.invoices.items).toHaveLength(1)
    expect(money.invoices.pageInfo.hasNextPage).toBe(true)
  })

  it('words a known refusal and errors on one it doesn’t know', async () => {
    answer.mockReturnValueOnce({ data: { setPaymentMethod: { ok: false, reason: 'INVALID_INPUT' } } })
    expect(await setPaymentMethod('pm_1Abc23')).toEqual({ ok: false, reason: 'INVALID_INPUT' })
    answer.mockReturnValueOnce({ data: { setPaymentMethod: { ok: false, reason: 'SOMETHING_NEW' } } })
    await expect(setPaymentMethod('pm_1Abc23')).rejects.toMatchObject({ code: 'SOMETHING_NEW' })
  })

  it('opens only a Stripe link for an invoice PDF', async () => {
    answer.mockReturnValueOnce({ data: { downloadInvoice: { ok: true, reason: null, url: 'https://pay.stripe.com/invoice/x/pdf' } } })
    expect(await invoicePdf('i1')).toEqual({ ok: true, url: 'https://pay.stripe.com/invoice/x/pdf' })
    answer.mockReturnValueOnce({ data: { downloadInvoice: { ok: true, reason: null, url: 'https://evil.example/pdf' } } })
    await expect(invoicePdf('i1')).rejects.toMatchObject({ code: 'BAD_RESPONSE' })
    answer.mockReturnValueOnce({ data: { downloadInvoice: { ok: false, reason: 'NO_PDF', url: null } } })
    expect(await invoicePdf('i1')).toEqual({ ok: false, reason: 'NO_PDF' })
  })

  it('reads the publishable key at runtime, null while the provider is off', async () => {
    answer.mockReturnValueOnce({ data: { billingClientConfig: { publishableKey: 'pk_test_a' } } })
    expect(await loadBillingClientConfig()).toBe('pk_test_a')
    answer.mockReturnValueOnce({ data: { billingClientConfig: { publishableKey: null } } })
    expect(await loadBillingClientConfig()).toBeNull()
  })

  it('sends a token alone to each setter, and words a known refusal', async () => {
    answer.mockReturnValueOnce({ data: { setPayoutAccount: { ok: true, reason: null } } })
    expect(await setPayoutAccount('btok_1Abc23')).toEqual({ ok: true })
    expect(answer.mock.lastCall?.[0]).toMatchObject({ variables: { token: 'btok_1Abc23' } })
    answer.mockReturnValueOnce({ data: { setPaymentMethod: { ok: false, reason: 'NOT_CONNECTED' } } })
    expect(await setPaymentMethod('pm_1Abc23')).toEqual({ ok: false, reason: 'NOT_CONNECTED' })
    expect(Object.keys((answer.mock.lastCall?.[0] as { variables: object }).variables)).toEqual(['token'])
  })
})
