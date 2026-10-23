import { describe, expect, it } from 'vitest'
import { PaymentRefused, PaymentUnavailable } from '#core/payments'
import { stripePayments } from './payments'

const account = { mode: 'test' as const, externalAccountId: 'acct_merchant', credentials: {} }
const request = { attemptId: '7f1c1f0e-0000-4000-8000-000000000001', orderId: 'o1', amount: { amount: 2599n, currency: 'USD' }, customer: { email: 'a@example.com', phone: null }, returnUrl: 'https://shop.example/order/o1/' }

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

  it('gives the app a signed-in shopper’s Customer and an ephemeral key made for its SDK’s version, before the intent', async () => {
    const shopperId = '0b8c9a5e-2222-4000-8000-000000000002'
    const asked: { method: string; url: string; headers: Headers; body: URLSearchParams }[] = []
    const gateway = (found: object[]) =>
      stripePayments({
        keys: { test: { secretKey: 'sk_test_platform', publishableKey: 'pk_test_platform' } },
        fetchImpl: async (url, init) => {
          asked.push({ method: init?.method ?? 'GET', url: String(url), headers: new Headers(init?.headers), body: new URLSearchParams(String(init?.body ?? '')) })
          if (String(url).includes('/customers/search')) return Response.json({ data: found })
          if (String(url).endsWith('/customers')) return Response.json({ id: 'cus_new' })
          if (String(url).endsWith('/ephemeral_keys')) return Response.json({ id: 'ephkey_1', secret: 'ek_test_secret' })
          return Response.json({ id: 'pi_123', status: 'requires_payment_method', amount: 2599, currency: 'usd', client_secret: 'pi_123_secret_x' })
        },
      })
    const app = { returnUrl: 'acmeshop://orders/o1', cancelUrl: 'acmeshop://checkout', shopperId, stripeApiVersion: '2024-06-20' }
    expect(await gateway([]).start(account, { ...request, app })).toEqual({ providerRef: 'pi_123', publicKey: 'pk_test_platform', accountId: 'acct_merchant', clientSecret: 'pi_123_secret_x', sessionId: null, redirectUrl: null, customerId: 'cus_new', ephemeralKeySecret: 'ek_test_secret' })
    expect(asked.map((a) => `${a.method} ${a.url.split('/v1')[1]?.split('?')[0]}`)).toEqual(['GET /customers/search', 'POST /customers', 'POST /ephemeral_keys', 'POST /payment_intents'])
    expect(decodeURIComponent(asked[0]?.url ?? '')).toContain(`metadata['df_customer_id']:'${shopperId}'`)
    expect(Object.fromEntries(asked[1]?.body ?? [])).toEqual({ 'metadata[df_customer_id]': shopperId })
    expect(asked[1]?.headers.get('idempotency-key')).toBe(`df-customer:${shopperId}`)
    expect(asked[2]?.headers.get('stripe-version')).toBe('2024-06-20')
    expect(asked[2]?.headers.get('idempotency-key')).toBe(`df-ephemeral-key:${request.attemptId}`)
    expect(Object.fromEntries(asked[2]?.body ?? [])).toEqual({ customer: 'cus_new' })
    expect(asked.every((a) => a.headers.get('stripe-account') === 'acct_merchant')).toBe(true)
    expect(Object.fromEntries(asked[3]?.body ?? [])).toMatchObject({ customer: 'cus_new' })
    // A Customer found is reused, not made again.
    asked.length = 0
    expect((await gateway([{ id: 'cus_old' }]).start(account, { ...request, app })).customerId).toBe('cus_old')
    expect(asked.map((a) => a.method + ' ' + (a.url.split('/v1')[1] ?? '').split('?')[0])).toEqual(['GET /customers/search', 'POST /ephemeral_keys', 'POST /payment_intents'])
  })

  it('gives the app’s guest, or a shopper whose SDK version it wasn’t told, the intent alone, as the web has it', async () => {
    const asked: string[] = []
    const gateway = stripePayments({
      keys: { test: { secretKey: 'sk_test_p', publishableKey: 'pk_test_p' } },
      fetchImpl: async (url) => (asked.push(String(url)), Response.json({ id: 'pi_1', status: 'requires_payment_method', amount: 1, currency: 'usd', client_secret: 'pi_1_secret' })),
    })
    const app = { returnUrl: 'acmeshop://orders/o1', cancelUrl: 'acmeshop://checkout', shopperId: null, stripeApiVersion: '2024-06-20' }
    expect(await gateway.start(account, { ...request, app })).not.toHaveProperty('customerId')
    expect(await gateway.start(account, { ...request, app: { ...app, shopperId: '0b8c9a5e-2222-4000-8000-000000000002', stripeApiVersion: null } })).not.toHaveProperty('ephemeralKeySecret')
    expect(asked.every((u) => u.endsWith('/payment_intents'))).toBe(true)
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

  it('cancels a replaced intent once, and says so when Stripe refuses because it was paid', async () => {
    let asked = ''
    const ok = stripePayments({ keys: { test: { secretKey: 'sk_test_p', publishableKey: 'pk_test_p' } }, fetchImpl: async (url) => ((asked = String(url)), Response.json({ id: 'pi_1', status: 'canceled', amount: 1, currency: 'usd' })) })
    await ok.cancel?.(account, 'pi_1')
    expect(asked).toBe('https://api.stripe.com/v1/payment_intents/pi_1/cancel')
    const paid = stripePayments({ keys: { test: { secretKey: 'sk_test_p', publishableKey: 'pk_test_p' } }, fetchImpl: async () => Response.json({ error: { code: 'payment_intent_unexpected_state' } }, { status: 400 }) })
    await expect(paid.cancel?.(account, 'pi_1')).rejects.toBeInstanceOf(PaymentRefused)
  })
})

describe('Stripe refunds on a connected account', () => {
  const refund = { refundId: '7f1c1f0e-0000-4000-8000-0000000000aa', amount: { amount: 1000n, currency: 'USD' } }

  it('refunds part of a PaymentIntent on the merchant’s account, once per refund id, and reads where it stands', async () => {
    let asked: { url: string; headers: Headers; body: URLSearchParams } | null = null
    const gateway = (status: string) =>
      stripePayments({
        keys: { test: { secretKey: 'sk_test_p', publishableKey: 'pk_test_p' } },
        fetchImpl: async (url, init) => {
          asked = { url: String(url), headers: new Headers(init?.headers), body: new URLSearchParams(String(init?.body)) }
          return Response.json({ id: 're_9', status })
        },
      })
    expect(await gateway('succeeded').refund(account, 'pi_1', refund)).toEqual({ providerRef: 're_9', state: 'done' })
    const sent = asked as unknown as { url: string; headers: Headers; body: URLSearchParams }
    expect(sent.url).toBe('https://api.stripe.com/v1/refunds')
    expect(sent.headers.get('stripe-account')).toBe('acct_merchant')
    expect(sent.headers.get('idempotency-key')).toBe(`df-refund:${refund.refundId}`)
    expect(Object.fromEntries(sent.body)).toEqual({ payment_intent: 'pi_1', amount: '1000', 'metadata[df_refund_id]': refund.refundId })
    expect((await gateway('pending').refund(account, 'pi_1', refund)).state).toBe('pending')
    expect((await gateway('failed').refund(account, 'pi_1', refund)).state).toBe('failed')
    await expect(gateway('succeeded').refund(account, 'ch_1', refund)).rejects.toBeInstanceOf(PaymentRefused)
  })
})
