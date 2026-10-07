import { z } from 'zod'
import { CourierRejected, courierTimeoutMs, CourierUnavailable, type CourierProvider, type CourierRate, type Parcel } from '#core/couriers'
import { fromMajor, isCurrency } from '#core/money'

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
