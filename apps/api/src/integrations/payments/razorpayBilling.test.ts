import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { PaymentRefused } from '#core/payments'
import { dateOf, keyHintOf, methodOf, razorpayBilling } from './razorpayBilling'

// Plan billing on Razorpay Subscriptions (#1744): what leaves a key, how a saved method reads, and the two signatures.
const keys = { keyId: 'rzp_live_AbCdEf123456', keySecret: 'key-secret', webhookSecret: 'hook-secret' }
const offline = () => razorpayBilling({ fetchImpl: () => Promise.reject(new Error('no network')) })

describe('razorpay plan billing', () => {
  it('shows a key only as its mode and last four', () => {
    expect(keyHintOf('rzp_live_AbCdEf123456')).toBe('rzp_live_••••3456')
    expect(keyHintOf('rzp_test_ZZZZZZ9999')).toBe('rzp_test_••••9999')
  })

  it('names a card by network and last four, a UPI handle masked, and nothing it can’t read', () => {
    expect(methodOf({ id: 'pay_1', status: 'captured', amount: 100, currency: 'INR', method: 'card', card: { last4: '1111', network: 'Visa' } })).toEqual({ kind: 'card', brand: 'visa', last4: '1111' })
    expect(methodOf({ id: 'pay_2', status: 'captured', amount: 100, currency: 'INR', method: 'upi', vpa: 'maya.chen@okhdfc' })).toEqual({ kind: 'upi', handle: 'ma••••@okhdfc' })
    expect(methodOf({ id: 'pay_3', status: 'captured', amount: 100, currency: 'INR', method: 'netbanking' })).toBeNull()
    expect(dateOf(1_767_225_600)).toEqual(new Date('2026-01-01T00:00:00Z'))
    expect(dateOf(null)).toBeNull()
  })

  it('checks Checkout’s answer with the key secret over payment|subscription, and a webhook with the webhook secret', async () => {
    const api = offline()
    const signed = createHmac('sha256', keys.keySecret).update('pay_1|sub_1').digest('hex')
    expect(await api.checkoutSignatureValid(keys, 'pay_1', 'sub_1', signed)).toBe(true)
    expect(await api.checkoutSignatureValid(keys, 'pay_1', 'sub_2', signed)).toBe(false)
    const body = JSON.stringify({ event: 'subscription.charged', payload: { subscription: { entity: { id: 'sub_9' } } } })
    expect(await api.webhookSubscription(keys, body, createHmac('sha256', keys.webhookSecret).update(body).digest('hex'))).toEqual({ valid: true, subscriptionId: 'sub_9' })
    expect(await api.webhookSubscription(keys, body, createHmac('sha256', keys.keySecret).update(body).digest('hex'))).toEqual({ valid: false })
  })

  it('refuses ids that aren’t Razorpay’s before any request', () => {
    const api = offline()
    expect(() => api.payment(keys, '../orders')).toThrow(PaymentRefused)
    expect(() => api.subscription(keys, '../plans')).toThrow(PaymentRefused)
  })
})
