import { describe, expect, it } from 'vitest'
import { CourierBoughtUnfinished, CourierRejected, CourierUnavailable, type LabelRequest } from '#core/couriers'
import { localCouriers } from '../local/index'
import { easyPostBook, easyPostPickup } from './easypost'
import { courierCall, fetchLabel, isLabelHost } from './request'
import { shiprocketBook, shiprocketPickup } from './shiprocket'

// SAPI 12 (#311): booking a label and a pickup through each adapter, against answers shaped as Shiprocket's and EasyPost's.

const pdf = new TextEncoder().encode('%PDF-1.4 label')
type Answer = { status: number; body?: unknown; bytes?: Uint8Array }
const answering = (answers: Answer[], seen: Request[] = []) =>
  (async (input: RequestInfo | URL, init?: RequestInit) => {
    seen.push(new Request(input, init))
    const next = answers.shift() ?? { status: 500, body: {} }
    if (next.bytes) return new Response(new Uint8Array(next.bytes), { status: next.status })
    return new Response(JSON.stringify(next.body ?? {}), { status: next.status, headers: { 'content-type': 'application/json' } })
  }) as typeof fetch

const india: LabelRequest = {
  reference: '0b6c3c1e-2f43-4d1e-9a51-6f0c1b7d9e10',
  from: { locationId: '7d4f2a10-0000-4000-8000-000000000001', name: 'Juniper', line1: '4 Johari Bazaar', line2: null, city: 'Jaipur', region: 'Rajasthan', postal: '302003', country: 'IN', phone: '+911412000000', email: 'hi@juniper.example' },
  to: { name: 'Priya Shah', line1: '1 MG Road', line2: null, city: 'Pune', region: 'Maharashtra', postal: '411001', country: 'IN', phone: '+919800000001', email: 'priya@example.com' },
  weightGrams: 600,
  items: [{ name: 'Kurta', sku: 'KUR-1', quantity: 2, unitAmount: 49900n, hsCode: '6211' }],
  value: { amount: 99800n, currency: 'INR' },
  labelSize: 'a6',
  pickup: 'scheduled',
}
const us: LabelRequest = {
  ...india,
  from: { ...india.from, line1: '1 High St', city: 'Columbus', region: 'OH', postal: '43215', country: 'US' },
  to: { ...india.to, line1: '2 Market St', city: 'San Francisco', region: 'CA', postal: '94103', country: 'US' },
  value: { amount: 4500n, currency: 'USD' },
  labelSize: '4x6',
  pickup: 'on_request',
}
const login = { status: 200, body: { token: 'tok-1' } }
const creds = { email: 'api@partner.example', password: 'secret' }

describe('a Shiprocket label', () => {
  it('registers the location, makes the order, takes its courier and label, and asks the pickup when pickups are scheduled', async () => {
    const seen: Request[] = []
    const booked = await shiprocketBook(
      {
        ...creds,
        fetchImpl: answering([
          login,
          { status: 422, body: { message: 'Address nick name already in use' } },
          { status: 200, body: { order_id: 991, shipment_id: 4411 } },
          { status: 200, body: { awb_assign_status: 1, response: { data: { awb_code: '1491234567', courier_name: 'Delhivery Surface' } } } },
          { status: 200, body: { label_created: 1, label_url: 'https://kr-shipmultichannel-mum.s3.ap-south-1.amazonaws.com/l/4411.pdf' } },
          { status: 200, bytes: pdf },
          { status: 200, body: { pickup_status: 1, response: { pickup_scheduled_date: '2026-10-12 10:00:00', pickup_token_number: 'Reference No: 77' } } },
        ], seen),
      },
      india,
    )
    expect(booked).toEqual({
      providerRef: '4411', trackingNumber: '1491234567', trackingUrl: 'https://shiprocket.co/tracking/1491234567', courierName: 'Delhivery Surface',
      label: { bytes: pdf, mime: 'application/pdf' }, pickup: { ref: 'Reference No: 77', date: '2026-10-12' },
    })
    expect(seen.map((r) => new URL(r.url).pathname)).toEqual([
      '/v1/external/auth/login', '/v1/external/settings/company/addpickup', '/v1/external/orders/create/adhoc', '/v1/external/courier/assign/awb',
      '/v1/external/courier/generate/label', '/l/4411.pdf', '/v1/external/courier/generate/pickup',
    ])
    const order = (await seen[2]?.json()) as Record<string, unknown>
    expect(order).toMatchObject({ order_id: india.reference, pickup_location: 'df-7d4f2a10000040008000', billing_pincode: '411001', billing_phone: '+919800000001', payment_method: 'Prepaid', sub_total: '998.00', weight: '0.600' })
    expect(order['order_items']).toEqual([{ name: 'Kurta', sku: 'KUR-1', units: 2, selling_price: '499.00', hsn: '6211' }])
  })

  it('asks no pickup on request, and answers null for a parcel it won’t take or a shopper with no number', async () => {
    const answers = [login, { status: 200, body: {} }, { status: 200, body: { shipment_id: 1 } }, { status: 200, body: { response: { data: { awb_code: 'A1', courier_name: 'Ekart' } } } }, { status: 200, body: { label_url: 'https://x.s3.amazonaws.com/a.pdf' } }, { status: 200, bytes: pdf }]
    const seen: Request[] = []
    expect((await shiprocketBook({ ...creds, fetchImpl: answering(answers, seen) }, { ...india, pickup: 'on_request' }))?.pickup).toBeNull()
    expect(seen).toHaveLength(6)
    expect(await shiprocketBook({ ...creds, fetchImpl: answering([login, { status: 200 }, { status: 422, body: { message: 'Invalid pincode' } }]) }, india)).toBeNull()
    expect(await shiprocketBook({ ...creds, fetchImpl: answering([]) }, { ...india, to: { ...india.to, phone: null } })).toBeNull()
  })

  it('refuses a label link off the courier’s file store, and says a refused login is the account’s', async () => {
    const off = [login, { status: 200 }, { status: 200, body: { shipment_id: 1 } }, { status: 200, body: { response: { data: { awb_code: 'A1', courier_name: 'Ekart' } } } }, { status: 200, body: { label_url: 'https://169.254.169.254/latest' } }]
    await expect(shiprocketBook({ ...creds, fetchImpl: answering(off) }, india)).rejects.toBeInstanceOf(CourierUnavailable)
    await expect(shiprocketBook({ ...creds, fetchImpl: answering([{ status: 400, body: {} }]) }, india)).rejects.toBeInstanceOf(CourierRejected)
  })

  it('names the shipment when the label fails once its courier is assigned, and books the label though a scheduled pickup fails', async () => {
    const assigned = [login, { status: 200 }, { status: 200, body: { shipment_id: 77 } }, { status: 200, body: { response: { data: { awb_code: 'A7', courier_name: 'Ekart' } } } }]
    const failed = await shiprocketBook({ ...creds, fetchImpl: answering([...assigned, { status: 200, body: { label_url: 'https://x.s3.amazonaws.com/a.pdf' } }, { status: 200, bytes: new TextEncoder().encode('<html>') }]) }, india).catch((e: unknown) => e)
    expect(failed).toBeInstanceOf(CourierBoughtUnfinished)
    expect((failed as CourierBoughtUnfinished).providerRef).toBe('77')
    const booked = await shiprocketBook({ ...creds, fetchImpl: answering([...assigned, { status: 200, body: { label_url: 'https://x.s3.amazonaws.com/a.pdf' } }, { status: 200, bytes: pdf }, { status: 400, body: {} }]) }, india)
    expect(booked).toMatchObject({ providerRef: '77', trackingNumber: 'A7', pickup: null })
  })

  it('asks a booked parcel’s pickup by its shipment id', async () => {
    const seen: Request[] = []
    expect(await shiprocketPickup({ ...creds, fetchImpl: answering([login, { status: 200, body: { response: { pickup_scheduled_date: '2026-10-13 09:00:00' } } }], seen) }, { providerRef: '4411', from: india.from })).toEqual({ ref: null, date: '2026-10-13' })
    expect(await seen[1]?.json()).toEqual({ shipment_id: [4411] })
  })
})

describe('an EasyPost label', () => {
  const created = { id: 'shp_1', rates: [{ id: 'rate_a', carrier: 'USPS', service: 'Priority', rate: '9.10', currency: 'USD' }, { id: 'rate_b', carrier: 'USPS', service: 'GroundAdvantage', rate: '6.85', currency: 'USD' }, { id: 'rate_c', carrier: 'UPSDAP', service: 'Ground', rate: '5.00', currency: 'USD' }] }
  const bought = { id: 'shp_1', tracking_code: '9400100000000000000000', postage_label: { label_pdf_url: 'https://easypost-files.s3.us-west-2.amazonaws.com/l.pdf' }, selected_rate: { carrier: 'USPS', service: 'GroundAdvantage' }, tracker: { public_url: 'https://track.easypost.com/abc' } }

  it('buys this carrier’s cheapest rate, never another carrier’s, and reads its PDF label and tracker', async () => {
    const seen: Request[] = []
    const label = await easyPostBook({ apiKey: 'EZK', fetchImpl: answering([{ status: 201, body: created }, { status: 200, body: bought }, { status: 200, bytes: pdf }], seen) }, 'usps', us)
    expect(label).toEqual({ providerRef: 'shp_1', trackingNumber: '9400100000000000000000', trackingUrl: 'https://track.easypost.com/abc', courierName: 'USPS GroundAdvantage', label: { bytes: pdf, mime: 'application/pdf' }, pickup: null })
    expect(await seen[1]?.json()).toEqual({ rate: { id: 'rate_b' } })
    expect(((await seen[0]?.json()) as { shipment: { reference: string; options: unknown } }).shipment).toMatchObject({ reference: us.reference, options: { label_format: 'PDF', label_size: '4x6' } })
  })

  it('names the bought shipment when its label can’t be fetched, so it can be refunded', async () => {
    const failed = await easyPostBook({ apiKey: 'EZK', fetchImpl: answering([{ status: 201, body: created }, { status: 200, body: bought }, { status: 200, bytes: new TextEncoder().encode('<html>') }]) }, 'usps', us).catch((e: unknown) => e)
    expect(failed).toBeInstanceOf(CourierBoughtUnfinished)
    expect((failed as CourierBoughtUnfinished).providerRef).toBe('shp_1')
  })

  it('answers null for an address it can’t use or no rate from this carrier, and a refused key is the account’s', async () => {
    expect(await easyPostBook({ apiKey: 'EZK', fetchImpl: answering([{ status: 422, body: {} }]) }, 'usps', us)).toBeNull()
    expect(await easyPostBook({ apiKey: 'EZK', fetchImpl: answering([{ status: 201, body: created }]) }, 'fedex', us)).toBeNull()
    await expect(easyPostBook({ apiKey: 'EZK', fetchImpl: answering([{ status: 401, body: {} }]) }, 'usps', us)).rejects.toBeInstanceOf(CourierRejected)
  })

  it('buys the cheapest pickup offered for a booked parcel', async () => {
    const seen: Request[] = []
    const pickup = await easyPostPickup(
      { apiKey: 'EZK', fetchImpl: answering([{ status: 201, body: { id: 'pickup_1', pickup_rates: [{ carrier: 'USPS', service: 'NextDay', rate: '0.00', currency: 'USD' }, { carrier: 'USPS', service: 'Future', rate: '1.00', currency: 'USD' }] } }, { status: 200, body: { confirmation: 'WTC123', min_datetime: '2026-10-13T09:00:00Z' } }], seen) },
      { providerRef: 'shp_1', from: us.from },
    )
    expect(pickup).toEqual({ ref: 'WTC123', date: '2026-10-13' })
    expect(await seen[1]?.json()).toEqual({ carrier: 'USPS', service: 'NextDay' })
    await expect(easyPostPickup({ apiKey: 'EZK', fetchImpl: answering([{ status: 201, body: { id: 'pickup_2', pickup_rates: [] } }]) }, { providerRef: 'shp_1', from: us.from })).rejects.toBeInstanceOf(CourierUnavailable)
  })
})

describe('courier calls', () => {
  it('retry a read with backoff up to a limit, and never a purchase', async () => {
    const seen: Request[] = []
    const down = answering([{ status: 503 }, { status: 503 }, { status: 503 }, { status: 503 }], seen)
    expect((await courierCall('https://api.example/read', {}, { fetchImpl: down, signal: undefined, retry: true, name: 'x' })).status).toBe(503)
    expect(seen).toHaveLength(3)
    const once: Request[] = []
    expect((await courierCall('https://api.example/buy', { method: 'POST' }, { fetchImpl: answering([{ status: 503 }], once), signal: undefined, name: 'x' })).status).toBe(503)
    expect(once).toHaveLength(1)
  }, 10_000)

  it('give up as no answer once the caller’s deadline passes', async () => {
    const hanging = ((_: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_, reject) => init?.signal?.addEventListener('abort', () => reject(new Error('aborted'))))) as typeof fetch
    await expect(courierCall('https://api.example/buy', {}, { fetchImpl: hanging, signal: AbortSignal.timeout(20), name: 'x' })).rejects.toBeInstanceOf(CourierUnavailable)
  })

  it('take a label only from a courier’s file store over https, and only a PDF or PNG within the cap', async () => {
    expect(['https://easypost-files.s3.us-west-2.amazonaws.com/a.pdf', 'https://kr-shipmultichannel.s3.amazonaws.com/a.pdf'].every(isLabelHost)).toBe(true)
    expect(['http://easypost-files.s3.amazonaws.com/a.pdf', 'https://169.254.169.254/a', 'https://amazonaws.com.evil.example/a', 'https://x.s3.amazonaws.com:8443/a', 'not a url'].some(isLabelHost)).toBe(false)
    await expect(fetchLabel('https://x.s3.amazonaws.com/a.pdf', { fetchImpl: answering([{ status: 200, bytes: new TextEncoder().encode('<html>') }]), signal: undefined, name: 'x' })).rejects.toBeInstanceOf(CourierUnavailable)
  })
})

describe('the local stand-in', () => {
  it('books a label with a made-up tracking number and a real PDF, in the courier’s own country only', async () => {
    const { gateway } = await localCouriers().forPartner('p')
    const booked = await gateway.book('shiprocket', india)
    expect(booked).toMatchObject({ providerRef: `local-${india.reference}`, trackingNumber: 'LOCAL0B6C3C1E2F43', trackingUrl: 'https://track.localhost/LOCAL0B6C3C1E2F43', pickup: { ref: `local-pickup-${india.reference}`, date: null } })
    expect(new TextDecoder().decode(booked?.label.bytes.slice(0, 5))).toBe('%PDF-')
    expect(await gateway.book('usps', india)).toBeNull()
    expect(await gateway.pickup('usps', { providerRef: 'local-1', from: us.from })).toEqual({ ref: 'local-pickup-local-1', date: null })
  })
})
