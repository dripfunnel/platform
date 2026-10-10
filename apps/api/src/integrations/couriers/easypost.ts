import { z } from 'zod'
import { CourierBoughtUnfinished, CourierRejected, courierTimeoutMs, CourierUnavailable, type BookedLabel, type CourierProvider, type CourierRate, type LabelAddress, type LabelRequest, type LabelSize, type Parcel, type PickupBooked } from '#core/couriers'
import { fromMajor, isCurrency } from '#core/money'
import { courierCall, fetchLabel } from './request'

// A partner's EasyPost account (THIRD-PARTY-ACCESS §3.2, §4; decided on #337): USPS, UPS and FedEx rates through one
// key. A shipment is EasyPost's quote: it holds the rates and buys nothing until a label is bought (SAPI 12).

export interface EasyPostCredentials {
  apiKey: string
}

const rateSchema = z.object({ carrier: z.string(), service: z.string(), rate: z.string(), currency: z.string(), delivery_days: z.number().nullish(), est_delivery_days: z.number().nullish() }).loose()
const shipmentSchema = z.object({ rates: z.array(rateSchema) }).loose()

// EasyPost's carrier names: USPS; UPS or UPSDAP; FedEx or FedExDefault.
const carrierOf: Record<Exclude<CourierProvider, 'shiprocket'>, string> = { usps: 'USPS', ups: 'UPS', fedex: 'FEDEX' }

const ounces = (grams: number) => Math.max(0.1, Math.round((grams / 28.349523125) * 10) / 10)

export const easyPostQuote = async ({ apiKey, fetchImpl = fetch }: EasyPostCredentials & { fetchImpl?: typeof fetch }, provider: CourierProvider, parcel: Parcel, signal?: AbortSignal): Promise<CourierRate | null> => {
  if (provider === 'shiprocket') return null
  const timeout = AbortSignal.timeout(courierTimeoutMs)
  let response: Response
  try {
    response = await fetchImpl('https://api.easypost.com/v2/shipments', {
      method: 'POST',
      headers: { authorization: `Basic ${btoa(`${apiKey}:`)}`, 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({
        shipment: {
          from_address: { zip: parcel.from.postal, country: parcel.from.country },
          to_address: { zip: parcel.to.postal, country: parcel.to.country, ...(parcel.to.region ? { state: parcel.to.region } : {}) },
          parcel: { weight: ounces(parcel.weightGrams) },
        },
      }),
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    })
  } catch {
    throw new CourierUnavailable('easypost: no answer')
  }
  if (response.status === 401 || response.status === 403) throw new CourierRejected('easypost: key refused')
  // An address EasyPost can't use is a route nobody serves, not an outage.
  if (response.status === 422 || response.status === 400) return null
  if (!response.ok) throw new CourierUnavailable(`easypost: answered ${response.status}`)
  const body = shipmentSchema.safeParse(await response.json().catch(() => null))
  if (!body.success) throw new CourierUnavailable('easypost: unreadable answer')
  const wanted = carrierOf[provider]
  const rates = body.data.rates.flatMap((r) => {
    if (!r.carrier.toUpperCase().startsWith(wanted)) return []
    const currency = r.currency.toUpperCase()
    const amount = isCurrency(currency) ? fromMajor(r.rate, currency) : null
    const d = r.delivery_days ?? r.est_delivery_days ?? null
    return amount ? [{ amount, service: r.service, minDays: d, maxDays: d }] : []
  })
  return rates.reduce<CourierRate | null>((best, r) => (best === null || r.amount.amount < best.amount.amount ? r : best), null)
}

// Booking (SAPI 12): an EasyPost shipment with both addresses, bought at this carrier's cheapest rate. Its tracker comes
// with the purchase; an on-request pickup is its own purchase from the carrier's pickup rates.

const boughtSchema = z.object({
  id: z.string(),
  tracking_code: z.string().min(1),
  postage_label: z.object({ label_url: z.string().nullish(), label_pdf_url: z.string().nullish() }).loose(),
  selected_rate: z.object({ carrier: z.string(), service: z.string() }).loose(),
  tracker: z.object({ public_url: z.string().nullish() }).loose().nullish(),
}).loose()
const createdSchema = z.object({ id: z.string(), rates: z.array(rateSchema.extend({ id: z.string() })) }).loose()
const pickupSchema = z.object({ id: z.string(), pickup_rates: z.array(z.object({ carrier: z.string(), service: z.string(), rate: z.string(), currency: z.string().optional() }).loose()) }).loose()
const pickupBoughtSchema = z.object({ confirmation: z.string().nullish(), min_datetime: z.string().nullish() }).loose()

const base = 'https://api.easypost.com/v2'
// EasyPost's sizes for the store's label size (SetOps); A4 and A6 are India's, which EasyPost doesn't ship.
const sizeOf: Record<LabelSize, string> = { '4x6': '4x6', letter: '8.5x11', a4: '8.5x11', a6: '4x6' }

const address = (a: LabelAddress) => ({ name: a.name, street1: a.line1, street2: a.line2 ?? undefined, city: a.city, state: a.region ?? undefined, zip: a.postal, country: a.country, phone: a.phone ?? undefined, email: a.email ?? undefined })

const send = (apiKey: string, fetchImpl: typeof fetch, path: string, body: unknown, signal: AbortSignal | undefined) =>
  courierCall(`${base}${path}`, { method: 'POST', headers: { authorization: `Basic ${btoa(`${apiKey}:`)}`, 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify(body) }, { fetchImpl, signal, name: 'easypost' })

const readAs = async <T>(response: Response, schema: z.ZodType<T>, what: string): Promise<T> => {
  if (response.status === 401 || response.status === 403) throw new CourierRejected('easypost: key refused')
  if (!response.ok) throw new CourierUnavailable(`easypost: ${what} answered ${response.status}`)
  const body = schema.safeParse(await response.json().catch(() => null))
  if (!body.success) throw new CourierUnavailable(`easypost: unreadable ${what}`)
  return body.data
}

/** The cheapest by its amount in minor units, never by a float; a rate in no currency we know is skipped. */
const cheapestOf = <R extends { rate: string; currency?: string | undefined }>(rates: readonly R[]): R | null =>
  rates
    .flatMap((r) => {
      const amount = fromMajor(r.rate, (r.currency ?? 'USD').toUpperCase())
      return amount ? [{ r, amount: amount.amount }] : []
    })
    .reduce<{ r: R; amount: bigint } | null>((best, x) => (best === null || x.amount < best.amount ? x : best), null)?.r ?? null

const httpsOrNull = (raw: string | null | undefined) => {
  try {
    return raw && new URL(raw).protocol === 'https:' ? raw : null
  } catch {
    return null
  }
}

export const easyPostBook = async ({ apiKey, fetchImpl = fetch }: EasyPostCredentials & { fetchImpl?: typeof fetch }, provider: CourierProvider, request: LabelRequest, signal?: AbortSignal): Promise<BookedLabel | null> => {
  if (provider === 'shiprocket') return null
  const created = await send(apiKey, fetchImpl, '/shipments', {
    shipment: {
      reference: request.reference,
      from_address: address(request.from),
      to_address: address(request.to),
      parcel: { weight: ounces(request.weightGrams) },
      options: { label_format: 'PDF', label_size: sizeOf[request.labelSize] },
    },
  }, signal)
  if (created.status === 400 || created.status === 422) return null
  const shipment = await readAs(created, createdSchema, 'shipment')
  const wanted = carrierOf[provider]
  const rate = cheapestOf(shipment.rates.filter((r) => r.carrier.toUpperCase().startsWith(wanted)))
  if (!rate) return null
  const bought = await readAs(await send(apiKey, fetchImpl, `/shipments/${encodeURIComponent(shipment.id)}/buy`, { rate: { id: rate.id } }, signal), boughtSchema, 'purchase')
  // Bought from here: a failure names the shipment, so it can be refunded there.
  const link = bought.postage_label.label_pdf_url ?? bought.postage_label.label_url
  const label = link ? await fetchLabel(link, { fetchImpl, signal, name: 'easypost' }).catch(() => null) : null
  if (!label) throw new CourierBoughtUnfinished('easypost: label not fetched', bought.id)
  return {
    providerRef: bought.id,
    trackingNumber: bought.tracking_code.slice(0, 80),
    trackingUrl: httpsOrNull(bought.tracker?.public_url),
    courierName: `${bought.selected_rate.carrier} ${bought.selected_rate.service}`.slice(0, 80),
    label,
    // A US carrier's daily pickup is the merchant's standing arrangement with it: nothing to ask per parcel.
    pickup: null,
  }
}

const pickupWindowMs = 2 * 24 * 60 * 60 * 1000

export const easyPostPickup = async ({ apiKey, fetchImpl = fetch }: EasyPostCredentials & { fetchImpl?: typeof fetch }, shipment: { providerRef: string; from: LabelAddress }, signal?: AbortSignal): Promise<PickupBooked> => {
  const now = Date.now()
  const asked = await readAs(
    await send(apiKey, fetchImpl, '/pickups', {
      pickup: { reference: shipment.providerRef, address: address(shipment.from), shipment: { id: shipment.providerRef }, min_datetime: new Date(now).toISOString(), max_datetime: new Date(now + pickupWindowMs).toISOString(), is_account_address: false },
    }, signal),
    pickupSchema,
    'pickup',
  )
  const cheapest = cheapestOf(asked.pickup_rates)
  if (!cheapest) throw new CourierUnavailable('easypost: no pickup offered')
  const bought = await readAs(await send(apiKey, fetchImpl, `/pickups/${encodeURIComponent(asked.id)}/buy`, { carrier: cheapest.carrier, service: cheapest.service }, signal), pickupBoughtSchema, 'pickup purchase')
  return { ref: (bought.confirmation ?? asked.id).slice(0, 100), date: bought.min_datetime && /^\d{4}-\d{2}-\d{2}/.test(bought.min_datetime) ? bought.min_datetime.slice(0, 10) : null }
}
