import type { ApiClient } from '@dripfunnel/mobile-shared/graphql'
import { orderHistoryOperation, orderOperation } from './orders'
import { run } from './operation'
import { registerPushDevice, unregisterPushDevice } from './push'

type Sent = { query: string; variables: Record<string, unknown> | undefined }
const client = (answer: unknown): ApiClient & { sent: Sent[] } => {
  const sent: Sent[] = []
  return {
    sent,
    request: async <T,>(query: string, variables?: Record<string, unknown>): Promise<T> => {
      sent.push({ query, variables })
      return answer as T
    },
  }
}

const inr = (amount: string) => ({ amount, currency: 'INR' })

describe('the signed-in shopper’s orders', () => {
  const page = (hasNextPage: boolean) => ({
    orderHistory: {
      nodes: [{ id: 'o-1', number: 'ORD-1', itemCount: 2, placedAt: '2026-10-27T10:14:00Z', state: 'placed', paymentState: 'paid', paymentMethod: 'razorpay', total: inr('154800') }],
      pageInfo: { hasNextPage, endCursor: 'cursor-2' },
    },
    store: { timeZone: 'Asia/Kolkata' },
  })

  it('are read a page at a time, with the store’s time zone, and never kept for offline', async () => {
    const api = client(page(true))
    const read = await run(api, orderHistoryOperation(null))
    expect(read).toEqual({
      items: [{ id: 'o-1', number: 'ORD-1', itemCount: 2, placedAt: '2026-10-27T10:14:00Z', state: 'placed', paymentState: 'paid', paymentMethod: 'razorpay', total: inr('154800') }],
      next: 'cursor-2',
      timeZone: 'Asia/Kolkata',
    })
    expect(api.sent[0]?.variables).toEqual({ first: 20 })
    expect(orderHistoryOperation(null).slot).toBeNull()
  })

  it('ask for the next page by its cursor, and have none after the last', async () => {
    const api = client(page(false))
    expect((await run(api, orderHistoryOperation('cursor-1'))).next).toBeNull()
    expect(api.sent[0]?.variables).toEqual({ first: 20, after: 'cursor-1' })
  })

  it('are none when the API answers none', async () => {
    expect(await run(client({ orderHistory: null }), orderHistoryOperation(null))).toEqual({ items: [], next: null, timeZone: null })
  })
})

describe('an order', () => {
  const answer = (delivery: unknown) => ({
    order: {
      id: 'o-1',
      number: 'ORD-1',
      state: 'placed',
      paymentState: 'pending',
      paymentMethod: 'cod',
      paymentDueBy: null,
      placedAt: '2026-10-27T10:14:00Z',
      pricesIncludeTax: true,
      shippingMethod: 'Own delivery',
      subtotal: inr('149900'),
      discounts: [{ name: 'WELCOME', amount: inr('10000') }, { name: 'Nothing', amount: null }],
      giftCard: null,
      shipping: inr('4900'),
      tax: inr('23614'),
      total: inr('144800'),
      lines: [{ name: 'Linen Shirt', versionName: 'Sand / M', quantity: 1, unitPrice: inr('149900'), lineTotal: inr('149900') }],
      delivery,
    },
    store: { timeZone: 'Asia/Kolkata' },
  })

  it('is read with its lines, totals and payment, and its delivery while it has one', async () => {
    const delivery = {
      state: 'picked_up',
      etaAt: '2026-10-27T10:52:00Z',
      handoverCode: '2580',
      steps: [{ state: 'packing', at: '2026-10-27T10:14:00Z' }, { state: null, at: null }, { state: 'picked_up', at: '2026-10-27T10:40:00Z' }],
      rider: { firstName: 'Asha', phone: '+919876500000', photoUrl: '/shop-api/assets/abc', vehicleType: 'scooter', vehicleNumber: 'RJ14 0001' },
      position: { latitude: 26.91, longitude: 75.79, reportedAt: '2026-10-27T10:44:00Z' },
    }
    const read = await run(client(answer(delivery)), orderOperation('o-1'))
    expect(read.timeZone).toBe('Asia/Kolkata')
    expect(read.order).toMatchObject({
      id: 'o-1',
      number: 'ORD-1',
      paymentMethod: 'cod',
      pricesIncludeTax: true,
      discounts: [{ name: 'WELCOME', amount: inr('10000') }],
      lines: [{ name: 'Linen Shirt', versionName: 'Sand / M', quantity: 1, lineTotal: inr('149900') }],
      delivery: {
        state: 'picked_up',
        etaAt: '2026-10-27T10:52:00Z',
        handoverCode: '2580',
        steps: [{ state: 'packing', at: '2026-10-27T10:14:00Z' }, { state: 'picked_up', at: '2026-10-27T10:40:00Z' }],
        rider: { firstName: 'Asha', phone: '+919876500000', vehicleType: 'scooter' },
        position: { latitude: 26.91, longitude: 75.79, reportedAt: '2026-10-27T10:44:00Z' },
      },
    })
  })

  it('has no delivery when the API gives none, a rider only when one is named, and a position only with both coordinates', async () => {
    expect((await run(client(answer(null)), orderOperation('o-1'))).order?.delivery).toBeNull()
    const partial = await run(client(answer({ state: 'searching', steps: [], rider: { firstName: null }, position: { latitude: 26.9, longitude: null } })), orderOperation('o-1'))
    expect(partial.order?.delivery).toMatchObject({ state: 'searching', rider: null, position: null, handoverCode: null, etaAt: null })
  })

  it('is none for a shopper the API finds no such order for', async () => {
    expect(await run(client({ order: null, store: { timeZone: null } }), orderOperation('o-9'))).toEqual({ order: null, timeZone: null })
  })

  it('is asked for by id, and never kept for offline: it holds the shopper’s details and the handover code', () => {
    const op = orderOperation('o-1')
    expect(op.variables).toEqual({ id: 'o-1' })
    expect(op.slot).toBeNull()
  })
})

describe('the phone’s push registration', () => {
  it('names the order only for a guest’s phone', async () => {
    const api = client({ registerPushDevice: true })
    await registerPushDevice(api, 'ExponentPushToken[abc]', 'android', null)
    await registerPushDevice(api, 'ExponentPushToken[abc]', 'ios', 'o-1')
    expect(api.sent[0]?.variables).toEqual({ token: 'ExponentPushToken[abc]', platform: 'android' })
    expect(api.sent[1]?.variables).toEqual({ token: 'ExponentPushToken[abc]', platform: 'ios', orderId: 'o-1' })
  })

  it('is removed by its token', async () => {
    const api = client({ unregisterPushDevice: true })
    await unregisterPushDevice(api, 'ExponentPushToken[abc]', null)
    expect(api.sent[0]?.variables).toEqual({ token: 'ExponentPushToken[abc]' })
  })
})
