import { describe, expect, it } from 'vitest'
import { CourierRejected, CourierUnavailable, type Parcel } from '#core/couriers'
import { easyPostQuote } from './easypost'

const parcel: Parcel = { from: { country: 'US', postal: '43215' }, to: { country: 'US', region: 'CA', postal: '94103' }, weightGrams: 900, value: { amount: 4500n, currency: 'USD' } }

const answering = (status: number, body: unknown, seen: Request[] = []) =>
  (async (input: RequestInfo | URL, init?: RequestInit) => {
    seen.push(new Request(input, init))
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
  }) as typeof fetch

const rates = {
  rates: [
    { carrier: 'USPS', service: 'Priority', rate: '9.10', currency: 'USD', delivery_days: 2 },
    { carrier: 'USPS', service: 'GroundAdvantage', rate: '6.85', currency: 'USD', delivery_days: 4 },
    { carrier: 'UPSDAP', service: 'Ground', rate: '11.20', currency: 'USD', delivery_days: 3 },
    { carrier: 'FedExDefault', service: 'FEDEX_GROUND', rate: '12.05', currency: 'USD', est_delivery_days: 3 },
  ],
}

describe('an EasyPost quote', () => {
  it('asks for a shipment by ZIP, state and ounces with the key as Basic auth, and answers the carrier’s cheapest rate', async () => {
    const seen: Request[] = []
    expect(await easyPostQuote({ apiKey: 'EZAK1', fetchImpl: answering(201, rates, seen) }, 'usps', parcel)).toEqual({ amount: { amount: 685n, currency: 'USD' }, service: 'GroundAdvantage', minDays: 4, maxDays: 4 })
    expect(seen[0]?.headers.get('authorization')).toBe(`Basic ${btoa('EZAK1:')}`)
    expect(await seen[0]?.json()).toEqual({ shipment: { from_address: { zip: '43215', country: 'US' }, to_address: { zip: '94103', country: 'US', state: 'CA' }, parcel: { weight: 31.7 } } })
  })

  it('keeps each carrier to its own rates: UPS never answers with USPS’s', async () => {
    expect((await easyPostQuote({ apiKey: 'k', fetchImpl: answering(201, rates) }, 'ups', parcel))?.service).toBe('Ground')
    expect((await easyPostQuote({ apiKey: 'k', fetchImpl: answering(201, rates) }, 'fedex', parcel))).toMatchObject({ amount: { amount: 1205n }, minDays: 3 })
    expect(await easyPostQuote({ apiKey: 'k', fetchImpl: answering(201, { rates: rates.rates.slice(0, 2) }) }, 'fedex', parcel)).toBeNull()
  })

  it('answers no rate for an address it can’t use, and tells a refused key from an outage', async () => {
    expect(await easyPostQuote({ apiKey: 'k', fetchImpl: answering(422, { error: { code: 'ADDRESS.VERIFY.FAILURE' } }) }, 'usps', parcel)).toBeNull()
    await expect(easyPostQuote({ apiKey: 'k', fetchImpl: answering(401, {}) }, 'usps', parcel)).rejects.toBeInstanceOf(CourierRejected)
    await expect(easyPostQuote({ apiKey: 'k', fetchImpl: answering(502, {}) }, 'usps', parcel)).rejects.toBeInstanceOf(CourierUnavailable)
    await expect(easyPostQuote({ apiKey: 'k', fetchImpl: answering(201, { rates: 'none' }) }, 'usps', parcel)).rejects.toBeInstanceOf(CourierUnavailable)
  })
})
