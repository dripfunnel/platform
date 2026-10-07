import { describe, expect, it } from 'vitest'
import { PaymentRefused, PaymentUnavailable } from '#core/payments'
import { stripePayments } from './payments'

const account = { mode: 'test' as const, externalAccountId: 'acct_merchant', credentials: {} }
const request = { attemptId: '7f1c1f0e-0000-4000-8000-000000000001', orderId: 'o1', amount: { amount: 2599n, currency: 'USD' }, customer: { email: 'a@example.com', phone: null }, returnUrl: 'https://shop.example/checkout/complete?order=o1' }

describe('Stripe payments on a connected account', () => {
  it('starts a PaymentIntent on the merchant’s account in the checkout’s mode, once per attempt', async () => {
    let asked: { url: string; headers: Headers; body: URLSearchParams } | null = null
    const gateway = stripePayments({
      keys: { test: { secretKey: 'sk_test_platform', publishableKey: 'pk_test_platform' } },
      fetchImpl: async (url, init) => {
        asked = { url: String(url), headers: new Headers(init?.headers), body: new URLSearchParams(String(init?.body)) }
        return Response.json({ id: 'pi_123', status: 'requires_payment_method', amount: 2599, currency: 'usd', client_secret: 'pi_123_secret_x' })
      },
    })
    expect(gateway.available('test')).toBe(true)
    expect(gateway.available('live')).toBe(false)
    expect(await gateway.start(account, request)).toEqual({ providerRef: 'pi_123', publicKey: 'pk_test_platform', accountId: 'acct_merchant', clientSecret: 'pi_123_secret_x', sessionId: null, redirectUrl: null })
    const sent = asked as unknown as { url: string; headers: Headers; body: URLSearchParams }
    expect(sent.url).toBe('https://api.stripe.com/v1/payment_intents')
    expect(sent.headers.get('stripe-account')).toBe('acct_merchant')
    expect(sent.headers.get('authorization')).toBe('Bearer sk_test_platform')
    expect(sent.headers.get('idempotency-key')).toBe(`df-payment:${request.attemptId}`)
    expect(Object.fromEntries(sent.body)).toMatchObject({ amount: '2599', currency: 'usd', 'automatic_payment_methods[enabled]': 'true', 'metadata[df_payment_id]': request.attemptId, receipt_email: 'a@example.com' })
    // No key for live mode here: nothing is sent.
    await expect(gateway.start({ ...account, mode: 'live' }, request)).rejects.toBeInstanceOf(PaymentUnavailable)
  })

  it('reads the outcome back: captured with the amount received, a decline still pending, cancelled failed', async () => {
    const answer = (body: object, status = 200) => stripePayments({ keys: { test: { secretKey: 'sk_test_p', publishableKey: 'pk_test_p' } }, fetchImpl: async () => Response.json(body, { status }) })
    expect(await answer({ id: 'pi_1', status: 'succeeded', amount: 2599, amount_received: 2599, currency: 'usd' }).outcome(account, 'pi_1')).toEqual({ state: 'captured', amount: { amount: 2599n, currency: 'USD' } })
    expect(await answer({ id: 'pi_1', status: 'requires_payment_method', amount: 2599, currency: 'usd' }).outcome(account, 'pi_1')).toEqual({ state: 'pending' })
    expect(await answer({ id: 'pi_1', status: 'canceled', amount: 2599, currency: 'usd' }).outcome(account, 'pi_1')).toEqual({ state: 'failed' })
    expect(await answer({}).outcome(account, 'not-an-intent')).toEqual({ state: 'failed' })
    await expect(answer({}, 503).outcome(account, 'pi_1')).rejects.toBeInstanceOf(PaymentUnavailable)
    await expect(answer({ error: {} }, 403).outcome(account, 'pi_1')).rejects.toBeInstanceOf(PaymentRefused)
    await expect(answer({}).outcome({ ...account, externalAccountId: null }, 'pi_1')).rejects.toBeInstanceOf(PaymentRefused)
  })
})
