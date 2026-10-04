import { describe, expect, it } from 'vitest'
import { stripeClient, StripeRefused, StripeUnavailable } from './api'

const answering = (status: number, json: unknown, seen: Request[] = []) =>
  (async (input: RequestInfo | URL, init?: RequestInit) => {
    seen.push(new Request(input, init))
    return Response.json(json, { status })
  }) as typeof fetch

describe('Stripe client', () => {
  it('sends the restricted key, form encoding and an idempotency key when making an account', async () => {
    const seen: Request[] = []
    const api = stripeClient({ secretKey: 'rk_test_abc', fetchImpl: answering(200, { id: 'acct_123' }, seen) })
    expect(await api.createAccount({ partnerId: 'p1', country: 'US', email: null })).toEqual({ id: 'acct_123' })
    const request = seen[0]
    expect(request?.headers.get('authorization')).toBe('Bearer rk_test_abc')
    expect(request?.headers.get('idempotency-key')).toBe('connect-account:p1')
    expect(await request?.text()).toContain('capabilities%5Btransfers%5D%5Brequested%5D=true')
  })

  it("reads a connected account's payout with its Stripe-Account header", async () => {
    const seen: Request[] = []
    const api = stripeClient({ secretKey: 'rk_test_abc', fetchImpl: answering(200, { id: 'po_1', amount: 100, currency: 'usd', arrival_date: 1, status: 'paid' }, seen) })
    await api.payout('acct_9', 'po_1')
    expect(seen[0]?.headers.get('stripe-account')).toBe('acct_9')
  })

  it("names Stripe's refusal by its code, and a 5xx, a 429 or an odd shape as unavailable", async () => {
    await expect(stripeClient({ secretKey: 'rk_test_a', fetchImpl: answering(402, { error: { code: 'card_declined', type: 'card_error' } }) }).attachCard('cus_1', 'pm_1')).rejects.toEqual(new StripeRefused('card_declined'))
    await expect(stripeClient({ secretKey: 'rk_test_a', fetchImpl: answering(503, {}) }).invoice('in_1')).rejects.toBeInstanceOf(StripeUnavailable)
    await expect(stripeClient({ secretKey: 'rk_test_a', fetchImpl: answering(429, {}) }).invoice('in_1')).rejects.toBeInstanceOf(StripeUnavailable)
    await expect(stripeClient({ secretKey: 'rk_test_a', fetchImpl: answering(200, { nope: true }) }).invoice('in_1')).rejects.toBeInstanceOf(StripeUnavailable)
  })

  it('treats no answer at all as unavailable', async () => {
    const failing = (async () => {
      throw new TypeError('network')
    }) as typeof fetch
    await expect(stripeClient({ secretKey: 'rk_test_a', fetchImpl: failing }).charge('ch_1')).rejects.toBeInstanceOf(StripeUnavailable)
  })
})
