import { describe, expect, it } from 'vitest'
import { PaymentNeedsPhone, PaymentRefused, PaymentUnavailable, type GatewayAccount, type PaymentRequest } from '#core/payments'
import { cashfree } from './cashfree'
import { hmacBase64, hmacHex, sha256Hex } from './http'
import { paypal } from './paypal'
import { phonepe } from './phonepe'
import { razorpay } from './razorpay'

// Each adapter against the provider's documented requests and answers (THIRD-PARTY-ACCESS §3.1), with fetch stubbed.

type Asked = { url: string; method: string; headers: Headers; body: string }
const stub = (answer: (asked: Asked) => Response | Promise<Response>) => {
  const asked: Asked[] = []
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    const call = { url: String(url), method: init?.method ?? 'GET', headers: new Headers(init?.headers), body: String(init?.body ?? '') }
    asked.push(call)
    return answer(call)
  }) as typeof fetch
  return { asked, fetchImpl }
}
const account = (credentials: Record<string, string>, mode: 'test' | 'live' = 'test'): GatewayAccount => ({ mode, externalAccountId: null, credentials })
const request: PaymentRequest = {
  attemptId: '7f1c1f0e-1111-4000-8000-000000000001',
  orderId: '0b8c9a5e-2222-4000-8000-000000000002',
  amount: { amount: 129950n, currency: 'INR' },
  customer: { email: 'asha@example.com', phone: '+919845022113' },
  returnUrl: 'https://jaipur.shops.example/checkout/complete?order=o',
}
const reference = 'df_7f1c1f0e111140008000000000000001'

describe('Razorpay', () => {
  const keys = account({ keyId: 'rzp_test_abcdef', keySecret: 'secret', webhookSecret: 'whsecret' })

  it('makes an Order for the amount in paise with our reference, and hands checkout the key id', async () => {
    const { asked, fetchImpl } = stub(() => Response.json({ id: 'order_ABC123', status: 'created' }))
    expect(await razorpay({ fetchImpl }).start(keys, request)).toMatchObject({ providerRef: 'order_ABC123', publicKey: 'rzp_test_abcdef' })
    expect(asked[0]?.url).toBe('https://api.razorpay.com/v1/orders')
    expect(asked[0]?.headers.get('authorization')).toBe(`Basic ${btoa('rzp_test_abcdef:secret')}`)
    expect(JSON.parse(asked[0]?.body ?? '')).toEqual({ amount: 129950, currency: 'INR', receipt: reference, notes: { df_order_id: request.orderId, df_payment_id: request.attemptId } })
  })

  it('reads the order’s payments back: captured, an authorised one captured now, or still open', async () => {
    const captured = stub(() => Response.json({ items: [{ id: 'pay_1', status: 'failed', amount: 129950, currency: 'INR' }, { id: 'pay_2', status: 'captured', amount: 129950, currency: 'INR' }] }))
    expect(await razorpay({ fetchImpl: captured.fetchImpl }).outcome(keys, 'order_ABC123')).toEqual({ state: 'captured', amount: { amount: 129950n, currency: 'INR' } })
    const authorised = stub((a) => (a.url.endsWith('/capture') ? Response.json({ status: 'captured', amount: 129950, currency: 'INR' }) : Response.json({ items: [{ id: 'pay_3', status: 'authorized', amount: 129950, currency: 'INR' }] })))
    expect(await razorpay({ fetchImpl: authorised.fetchImpl }).outcome(keys, 'order_ABC123')).toEqual({ state: 'captured', amount: { amount: 129950n, currency: 'INR' } })
    expect(authorised.asked[1]?.url).toBe('https://api.razorpay.com/v1/payments/pay_3/capture')
    const open = stub(() => Response.json({ items: [{ id: 'pay_1', status: 'failed', amount: 129950, currency: 'INR' }] }))
    expect(await razorpay({ fetchImpl: open.fetchImpl }).outcome(keys, 'order_ABC123')).toEqual({ state: 'pending' })
    expect(await razorpay({ fetchImpl: open.fetchImpl }).outcome(keys, '../x')).toEqual({ state: 'failed' })
  })

  it('takes a webhook signed with the merchant’s secret only, and names the order it is about', async () => {
    const body = JSON.stringify({ event: 'payment.captured', payload: { payment: { entity: { id: 'pay_2', order_id: 'order_ABC123' } } } })
    const headers = new Headers({ 'x-razorpay-signature': await hmacHex('whsecret', body) })
    expect(await razorpay().webhook?.(keys, { body, headers, now: new Date() })).toEqual({ valid: true, providerRef: 'order_ABC123' })
    expect(await razorpay().webhook?.(keys, { body: `${body} `, headers, now: new Date() })).toEqual({ valid: false })
    expect(await razorpay().webhook?.(account({ keyId: 'k', keySecret: 's' }), { body, headers, now: new Date() })).toEqual({ valid: false })
  })

  it('tells refused keys from Razorpay being down', async () => {
    await expect(razorpay({ fetchImpl: stub(() => Response.json({}, { status: 401 })).fetchImpl }).verify?.(keys)).rejects.toBeInstanceOf(PaymentRefused)
    await expect(razorpay({ fetchImpl: stub(() => new Response('', { status: 503 })).fetchImpl }).verify?.(keys)).rejects.toBeInstanceOf(PaymentUnavailable)
    await expect(razorpay({ fetchImpl: stub(() => Response.json({ items: [] })).fetchImpl }).verify?.(keys)).resolves.toBeUndefined()
  })
})

describe('Cashfree', () => {
  const keys = account({ appId: 'app1', secretKey: 'cfsecret' })

  it('makes an order in rupees on the sandbox in test mode, with the shopper’s ten-digit number, and hands back its session', async () => {
    const { asked, fetchImpl } = stub(() => Response.json({ order_id: reference, payment_session_id: 'session_xyz', order_status: 'ACTIVE' }))
    expect(await cashfree({ fetchImpl }).start(keys, request)).toMatchObject({ providerRef: reference, sessionId: 'session_xyz' })
    // The exact decimal, never through a float.
    expect(asked[0]?.body).toContain('"order_amount":1299.50')
    expect(asked[0]?.url).toBe('https://sandbox.cashfree.com/pg/orders')
    expect(asked[0]?.headers.get('x-api-version')).toBe('2023-08-01')
    expect(JSON.parse(asked[0]?.body ?? '')).toMatchObject({ order_id: reference, order_amount: 1299.5, order_currency: 'INR', customer_details: { customer_phone: '9845022113', customer_email: 'asha@example.com' }, order_meta: { return_url: request.returnUrl } })
    await cashfree({ fetchImpl }).start({ ...keys, mode: 'live' }, request)
    expect(asked[1]?.url).toBe('https://api.cashfree.com/pg/orders')
  })

  it('sends a large amount exactly', async () => {
    const { asked, fetchImpl } = stub(() => Response.json({ order_id: reference, payment_session_id: 's', order_status: 'ACTIVE' }))
    await cashfree({ fetchImpl }).start(keys, { ...request, amount: { amount: 999999999999999n, currency: 'INR' } })
    expect(asked[0]?.body).toContain('"order_amount":9999999999999.99')
  })

  it('asks for the shopper’s number, which Cashfree requires, before calling it', async () => {
    const { asked, fetchImpl } = stub(() => Response.json({}))
    await expect(cashfree({ fetchImpl }).start(keys, { ...request, customer: { email: 'a@example.com', phone: null } })).rejects.toBeInstanceOf(PaymentNeedsPhone)
    expect(asked).toHaveLength(0)
  })

  it('reads the order’s status: paid with its amount, expired failed, otherwise open', async () => {
    const answer = (body: object) => cashfree({ fetchImpl: stub(() => Response.json(body)).fetchImpl }).outcome(keys, reference)
    expect(await answer({ order_status: 'PAID', order_amount: 1299.5, order_currency: 'INR' })).toEqual({ state: 'captured', amount: { amount: 129950n, currency: 'INR' } })
    expect(await answer({ order_status: 'EXPIRED', order_amount: 1, order_currency: 'INR' })).toEqual({ state: 'failed' })
    expect(await answer({ order_status: 'ACTIVE', order_amount: 1, order_currency: 'INR' })).toEqual({ state: 'pending' })
  })

  it('takes a webhook signed over its timestamp and body with the secret key, only while fresh', async () => {
    const now = new Date('2026-10-07T10:00:00Z')
    const body = JSON.stringify({ type: 'PAYMENT_SUCCESS_WEBHOOK', data: { order: { order_id: reference }, payment: { payment_status: 'SUCCESS' } } })
    const timestamp = String(now.getTime())
    const headers = new Headers({ 'x-webhook-timestamp': timestamp, 'x-webhook-signature': await hmacBase64('cfsecret', timestamp + body) })
    expect(await cashfree().webhook?.(keys, { body, headers, now })).toEqual({ valid: true, providerRef: reference })
    expect(await cashfree().webhook?.(keys, { body, headers, now: new Date(now.getTime() + 10 * 60 * 1000) })).toEqual({ valid: false })
    expect(await cashfree().webhook?.(account({ appId: 'app1', secretKey: 'other' }), { body, headers, now })).toEqual({ valid: false })
  })

  it('takes keys Cashfree answers 404 to (an order that can’t exist), refuses those it answers 401', async () => {
    await expect(cashfree({ fetchImpl: stub(() => Response.json({ message: 'order not found' }, { status: 404 })).fetchImpl }).verify?.(keys)).resolves.toBeUndefined()
    await expect(cashfree({ fetchImpl: stub(() => Response.json({}, { status: 401 })).fetchImpl }).verify?.(keys)).rejects.toBeInstanceOf(PaymentRefused)
  })
})

describe('PhonePe', () => {
  const keys = account({ clientId: 'cid', clientSecret: 'cs', clientVersion: '1', webhookUsername: 'user', webhookPassword: 'pass' })
  const answers = (pay: object) =>
    stub((a) => (a.url.endsWith('/oauth/token') ? Response.json({ access_token: 'tok', expires_at: 1 }) : Response.json(pay)))

  it('gets a token, then a payment page in paise with our reference, on the sandbox in test mode', async () => {
    const { asked, fetchImpl } = answers({ orderId: 'OMO1', state: 'PENDING', redirectUrl: 'https://mercury.phonepe.com/pay/abc' })
    expect(await phonepe({ fetchImpl }).start(keys, request)).toMatchObject({ providerRef: reference, redirectUrl: 'https://mercury.phonepe.com/pay/abc' })
    expect(asked[0]?.url).toBe('https://api-preprod.phonepe.com/apis/pg-sandbox/v1/oauth/token')
    expect(Object.fromEntries(new URLSearchParams(asked[0]?.body))).toEqual({ client_id: 'cid', client_version: '1', client_secret: 'cs', grant_type: 'client_credentials' })
    expect(asked[1]?.url).toBe('https://api-preprod.phonepe.com/apis/pg-sandbox/checkout/v2/pay')
    expect(asked[1]?.headers.get('authorization')).toBe('O-Bearer tok')
    expect(JSON.parse(asked[1]?.body ?? '')).toMatchObject({ merchantOrderId: reference, amount: 129950, paymentFlow: { type: 'PG_CHECKOUT', merchantUrls: { redirectUrl: request.returnUrl } } })
    await expect(phonepe({ fetchImpl }).start(keys, { ...request, amount: { amount: 100n, currency: 'USD' } })).rejects.toBeInstanceOf(PaymentRefused)
  })

  it('reads the status: completed with its amount, failed, or still pending', async () => {
    expect(await phonepe({ fetchImpl: answers({ state: 'COMPLETED', amount: 129950 }).fetchImpl }).outcome(keys, reference)).toEqual({ state: 'captured', amount: { amount: 129950n, currency: 'INR' } })
    expect(await phonepe({ fetchImpl: answers({ state: 'FAILED', amount: 129950 }).fetchImpl }).outcome(keys, reference)).toEqual({ state: 'failed' })
    expect(await phonepe({ fetchImpl: answers({ state: 'PENDING', amount: 129950 }).fetchImpl }).outcome(keys, reference)).toEqual({ state: 'pending' })
  })

  it('takes a webhook carrying the SHA-256 of the merchant’s username and password', async () => {
    const body = JSON.stringify({ event: 'checkout.order.completed', payload: { merchantOrderId: reference, state: 'COMPLETED' } })
    const ok = new Headers({ authorization: await sha256Hex('user:pass') })
    expect(await phonepe().webhook?.(keys, { body, headers: ok, now: new Date() })).toEqual({ valid: true, providerRef: reference })
    expect(await phonepe().webhook?.(keys, { body, headers: new Headers({ authorization: await sha256Hex('user:guess') }), now: new Date() })).toEqual({ valid: false })
  })
})

describe('PayPal', () => {
  const keys = account({ clientId: 'AbC', clientSecret: 'sec', webhookId: 'WH123' })
  const routes = (routing: Record<string, object>) =>
    stub((a) => {
      if (a.url.endsWith('/v1/oauth2/token')) return Response.json({ access_token: 'tok' })
      const found = Object.entries(routing).find(([suffix]) => a.url.endsWith(suffix))
      return Response.json(found?.[1] ?? {}, { status: found ? 200 : 404 })
    })

  it('makes a CAPTURE order in dollars on the sandbox in test mode, once per attempt, and hands checkout the client id', async () => {
    const { asked, fetchImpl } = routes({ '/v2/checkout/orders': { id: '5O190127TN364715T', status: 'CREATED' } })
    expect(await paypal({ fetchImpl }).start(keys, { ...request, amount: { amount: 2599n, currency: 'USD' } })).toMatchObject({ providerRef: '5O190127TN364715T', publicKey: 'AbC' })
    expect(asked[1]?.url).toBe('https://api-m.sandbox.paypal.com/v2/checkout/orders')
    expect(asked[1]?.headers.get('paypal-request-id')).toBe(request.attemptId)
    expect(JSON.parse(asked[1]?.body ?? '')).toEqual({ intent: 'CAPTURE', purchase_units: [{ reference_id: request.orderId, custom_id: request.attemptId, amount: { currency_code: 'USD', value: '25.99' } }] })
  })

  it('captures an approved order when it reads it back, and reads a completed one as captured', async () => {
    const done = { id: 'ORD1', status: 'COMPLETED', purchase_units: [{ payments: { captures: [{ status: 'COMPLETED', amount: { value: '25.99', currency_code: 'USD' } }] } }] }
    const approved = routes({ '/v2/checkout/orders/ORD1': { id: 'ORD1', status: 'APPROVED' }, '/v2/checkout/orders/ORD1/capture': done })
    expect(await paypal({ fetchImpl: approved.fetchImpl }).outcome(keys, 'ORD1')).toEqual({ state: 'captured', amount: { amount: 2599n, currency: 'USD' } })
    expect(approved.asked.map((a) => `${a.method} ${a.url.split('paypal.com')[1]}`)).toEqual(['POST /v1/oauth2/token', 'GET /v2/checkout/orders/ORD1', 'POST /v2/checkout/orders/ORD1/capture'])
    expect(await paypal({ fetchImpl: routes({ '/v2/checkout/orders/ORD1': { id: 'ORD1', status: 'CREATED' } }).fetchImpl }).outcome(keys, 'ORD1')).toEqual({ state: 'pending' })
    expect(await paypal({ fetchImpl: routes({ '/v2/checkout/orders/ORD1': { id: 'ORD1', status: 'VOIDED' } }).fetchImpl }).outcome(keys, 'ORD1')).toEqual({ state: 'failed' })
  })

  it('has PayPal check a webhook against the merchant’s webhook id, and names the order', async () => {
    const body = JSON.stringify({ event_type: 'PAYMENT.CAPTURE.COMPLETED', resource: { id: 'CAP1', supplementary_data: { related_ids: { order_id: 'ORD1' } } } })
    const signed = new Headers({ 'paypal-auth-algo': 'SHA256withRSA', 'paypal-transmission-id': 't1', 'paypal-transmission-sig': 'sig', 'paypal-transmission-time': '2026-10-07T10:00:00Z', 'paypal-cert-url': 'https://api-m.sandbox.paypal.com/v1/notifications/certs/CERT-1' })
    const yes = routes({ '/v1/notifications/verify-webhook-signature': { verification_status: 'SUCCESS' } })
    expect(await paypal({ fetchImpl: yes.fetchImpl }).webhook?.(keys, { body, headers: signed, now: new Date() })).toEqual({ valid: true, providerRef: 'ORD1' })
    expect(JSON.parse(yes.asked[1]?.body ?? '')).toMatchObject({ webhook_id: 'WH123', transmission_id: 't1' })
    const no = routes({ '/v1/notifications/verify-webhook-signature': { verification_status: 'FAILURE' } })
    expect(await paypal({ fetchImpl: no.fetchImpl }).webhook?.(keys, { body, headers: signed, now: new Date() })).toEqual({ valid: false })
    // Without PayPal's headers, or with a certificate from elsewhere, PayPal is never asked.
    const never = routes({})
    expect(await paypal({ fetchImpl: never.fetchImpl }).webhook?.(keys, { body, headers: new Headers({ 'paypal-transmission-id': 't1' }), now: new Date() })).toEqual({ valid: false })
    const elsewhere = new Headers(signed)
    elsewhere.set('paypal-cert-url', 'https://evil.example/cert')
    expect(await paypal({ fetchImpl: never.fetchImpl }).webhook?.(keys, { body, headers: elsewhere, now: new Date() })).toEqual({ valid: false })
    expect(never.asked).toHaveLength(0)
  })
})
