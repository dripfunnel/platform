import { describe, expect, it } from 'vitest'
import { CourierRejected, CourierUnavailable, type Parcel } from '#core/couriers'
import { shiprocketQuote } from './shiprocket'

const parcel: Parcel = { from: { country: 'IN', postal: '302001' }, to: { country: 'IN', region: 'Maharashtra', postal: '400001' }, weightGrams: 750, value: { amount: 149900n, currency: 'INR' } }

const answering = (answers: { status: number; body: unknown }[], seen: Request[] = []) =>
  (async (input: RequestInfo | URL, init?: RequestInit) => {
    seen.push(new Request(input, init))
    const next = answers.shift() ?? { status: 500, body: {} }
    return new Response(JSON.stringify(next.body), { status: next.status, headers: { 'content-type': 'application/json' } })
  }) as typeof fetch

const login = { status: 200, body: { token: 'tok-1' } }
const creds = { email: 'api@partner.example', password: 'secret' }

describe('a Shiprocket quote', () => {
  it('logs in, asks for the route by postcode and kilograms, and answers the cheapest courier in paise', async () => {
    const seen: Request[] = []
    const rate = await shiprocketQuote(
      { ...creds, fetchImpl: answering([login, { status: 200, body: { status: 200, data: { available_courier_companies: [{ courier_name: 'Bluedart', rate: 120.5, estimated_delivery_days: '2' }, { courier_name: 'Delhivery Surface', rate: 85, estimated_delivery_days: '5' }] } } }], seen) },
      parcel,
    )
    expect(rate).toEqual({ amount: { amount: 8500n, currency: 'INR' }, service: 'Delhivery Surface', minDays: 5, maxDays: 5 })
    expect(await seen[0]?.json()).toEqual(creds)
    const url = new URL(seen[1]?.url ?? '')
    expect([url.pathname, url.searchParams.get('pickup_postcode'), url.searchParams.get('delivery_postcode'), url.searchParams.get('weight'), url.searchParams.get('declared_value')]).toEqual([
      '/v1/external/courier/serviceability/', '302001', '400001', '0.750', '1499.00',
    ])
    expect(seen[1]?.headers.get('authorization')).toBe('Bearer tok-1')
  })

  it('rounds a rate in decimal, where a float would round 10.075 down', async () => {
    const rate = await shiprocketQuote({ ...creds, fetchImpl: answering([login, { status: 200, body: { data: { available_courier_companies: [{ courier_name: 'Ekart', rate: 10.075 }, { courier_name: 'Xpress', rate: '1.005' }] } } }]) }, parcel)
    expect(rate?.amount).toEqual({ amount: 101n, currency: 'INR' })
    const other = await shiprocketQuote({ ...creds, fetchImpl: answering([login, { status: 200, body: { data: { available_courier_companies: [{ courier_name: 'Ekart', rate: 10.075 }] } } }]) }, parcel)
    expect(other?.amount).toEqual({ amount: 1008n, currency: 'INR' })
  })

  it('serves India only, asking nothing for another country', async () => {
    const seen: Request[] = []
    expect(await shiprocketQuote({ ...creds, fetchImpl: answering([], seen) }, { ...parcel, to: { ...parcel.to, country: 'US' } })).toBeNull()
    expect(seen).toHaveLength(0)
  })

  it('answers no rate for a route no courier serves', async () => {
    expect(await shiprocketQuote({ ...creds, fetchImpl: answering([login, { status: 404, body: { message: 'not serviceable' } }]) }, parcel)).toBeNull()
    expect(await shiprocketQuote({ ...creds, fetchImpl: answering([login, { status: 200, body: { data: { available_courier_companies: [] } } }]) }, parcel)).toBeNull()
  })

  it('tells a refused login from an outage', async () => {
    await expect(shiprocketQuote({ ...creds, fetchImpl: answering([{ status: 400, body: { message: 'Invalid email and password combination' } }]) }, parcel)).rejects.toBeInstanceOf(CourierRejected)
    await expect(shiprocketQuote({ ...creds, fetchImpl: answering([{ status: 401, body: {} }]) }, parcel)).rejects.toBeInstanceOf(CourierRejected)
    await expect(shiprocketQuote({ ...creds, fetchImpl: answering([{ status: 503, body: {} }]) }, parcel)).rejects.toBeInstanceOf(CourierUnavailable)
    await expect(shiprocketQuote({ ...creds, fetchImpl: answering([login, { status: 500, body: {} }]) }, parcel)).rejects.toBeInstanceOf(CourierUnavailable)
    await expect(shiprocketQuote({ ...creds, fetchImpl: answering([login, { status: 200, body: { nothing: true } }]) }, parcel)).rejects.toBeInstanceOf(CourierUnavailable)
    const throwing = (async () => {
      throw new TypeError('network')
    }) as typeof fetch
    await expect(shiprocketQuote({ ...creds, fetchImpl: throwing }, parcel)).rejects.toBeInstanceOf(CourierUnavailable)
  })
})
