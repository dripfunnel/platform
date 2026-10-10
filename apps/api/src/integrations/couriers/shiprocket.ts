import { z } from 'zod'
import { CourierBoughtUnfinished, CourierRejected, CourierUnavailable, type BookedLabel, type CourierHook, type CourierRate, type LabelAddress, type LabelRequest, type Parcel, type PickupBooked, type TrackingEvent, type TrackingStatus } from '#core/couriers'
import { fromDecimalRounded, toMajor } from '#core/money'
import { courierCall, fetchLabel, sameSecret } from './request'

// A partner's Shiprocket account (THIRD-PARTY-ACCESS §3.2, §4): a dedicated API user's email and password, exchanged
// for a token on each quote, since the Worker keeps nothing between requests. Domestic India only.

export interface ShiprocketCredentials {
  email: string
  password: string
  /** The token the partner set on its Shiprocket webhook, which tracking hooks carry (#275 stores it). */
  webhookToken?: string | null
}

const base = 'https://apiv2.shiprocket.in/v1/external'

const loginSchema = z.object({ token: z.string().min(1) }).loose()
const companySchema = z.object({ courier_name: z.string(), rate: z.union([z.number(), z.string()]), estimated_delivery_days: z.union([z.number(), z.string()]).nullish() }).loose()
const serviceabilitySchema = z.object({ data: z.object({ available_courier_companies: z.array(companySchema) }).loose() }).loose()

const call = (fetchImpl: typeof fetch, url: string, init: RequestInit, signal: AbortSignal | undefined, retry = false): Promise<Response> =>
  courierCall(url, init, { fetchImpl, signal, retry, name: 'shiprocket' })

const failed = (response: Response): never => {
  if (response.status === 401 || response.status === 403) throw new CourierRejected('shiprocket: login refused')
  throw new CourierUnavailable(`shiprocket: answered ${response.status}`)
}

// A quote is never retried: checkout waits on it, and falls back to the flat rate instead.
const logIn = async ({ email, password, fetchImpl = fetch }: ShiprocketCredentials & { fetchImpl?: typeof fetch }, signal: AbortSignal | undefined, retry: boolean): Promise<string> => {
  const login = await call(fetchImpl, `${base}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify({ email, password }) }, signal, retry)
  // A wrong email or password answers 400 as well as 401.
  if (login.status === 400) throw new CourierRejected('shiprocket: login refused')
  if (!login.ok) failed(login)
  const token = loginSchema.safeParse(await login.json().catch(() => null))
  if (!token.success) throw new CourierUnavailable('shiprocket: no token')
  return token.data.token
}

const days = (value: number | string | null | undefined): number | null => {
  const n = typeof value === 'string' ? Number.parseInt(value, 10) : value
  return typeof n === 'number' && Number.isInteger(n) && n >= 0 && n < 100 ? n : null
}

export const shiprocketQuote = async ({ email, password, fetchImpl = fetch }: ShiprocketCredentials & { fetchImpl?: typeof fetch }, parcel: Parcel, signal?: AbortSignal): Promise<CourierRate | null> => {
  if (parcel.from.country !== 'IN' || parcel.to.country !== 'IN') return null
  const token = await logIn({ email, password, fetchImpl }, signal, false)
  const query = new URLSearchParams({
    pickup_postcode: parcel.from.postal,
    delivery_postcode: parcel.to.postal,
    // Kilograms, Shiprocket's smallest slab being half of one.
    weight: (Math.max(parcel.weightGrams, 1) / 1000).toFixed(3),
    cod: '0',
    declared_value: toMajor(parcel.value),
  })
  const response = await call(fetchImpl, `${base}/courier/serviceability/?${query.toString()}`, { headers: { authorization: `Bearer ${token}`, accept: 'application/json' } }, signal)
  // Shiprocket answers a route it doesn't serve with 404.
  if (response.status === 404 || response.status === 422) return null
  if (!response.ok) failed(response)
  const body = serviceabilitySchema.safeParse(await response.json().catch(() => null))
  if (!body.success) throw new CourierUnavailable('shiprocket: unreadable answer')
  const rates = body.data.data.available_courier_companies.flatMap((c) => {
    // The JSON number's own shortest decimal ("10.075"), rounded in decimal: never toFixed on a float.
    const amount = fromDecimalRounded(String(c.rate), 'INR')
    const d = days(c.estimated_delivery_days)
    return amount ? [{ amount, service: c.courier_name, minDays: d, maxDays: d }] : []
  })
  return rates.reduce<CourierRate | null>((best, r) => (best === null || r.amount.amount < best.amount.amount ? r : best), null)
}

// Booking (SAPI 12): Shiprocket's adhoc order, then its courier (AWB), its label and, with scheduled pickups, the pickup.
// Its API takes a pickup address only by the nickname it was registered under, so each location registers once as its id.

const orderSchema = z.object({ shipment_id: z.union([z.number(), z.string()]) }).loose()
const awbSchema = z.object({ response: z.object({ data: z.object({ awb_code: z.union([z.string(), z.number()]), courier_name: z.string() }).loose() }).loose() }).loose()
const labelSchema = z.object({ label_url: z.string() }).loose()
const pickupSchema = z.object({ response: z.object({ pickup_scheduled_date: z.string().nullish(), pickup_token_number: z.union([z.string(), z.number()]).nullish() }).loose() }).loose()

/** Shiprocket's own tracking page, which the shopper's email and text link to. */
export const shiprocketTrackingUrl = (awb: string) => `https://shiprocket.co/tracking/${encodeURIComponent(awb)}`

// Shiprocket asks for a box and an order line carries no dimensions, so every parcel goes as a 10 cm cube (FIRST-RELEASE §19).
const boxCm = 10

const post = async (fetchImpl: typeof fetch, token: string, path: string, body: unknown, signal: AbortSignal | undefined): Promise<Response> =>
  call(fetchImpl, `${base}${path}`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify(body) }, signal)

const read = async <T>(response: Response, schema: z.ZodType<T>, what: string): Promise<T> => {
  if (!response.ok) failed(response)
  const body = schema.safeParse(await response.json().catch(() => null))
  if (!body.success) throw new CourierUnavailable(`shiprocket: unreadable ${what}`)
  return body.data
}

const pickupDay = (value: string | null | undefined): string | null => (value && /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : null)

const askPickup = async (fetchImpl: typeof fetch, token: string, shipmentId: string, signal: AbortSignal | undefined): Promise<PickupBooked> => {
  const p = await read(await post(fetchImpl, token, '/courier/generate/pickup', { shipment_id: [Number(shipmentId)] }, signal), pickupSchema, 'pickup')
  return { ref: p.response.pickup_token_number == null ? null : String(p.response.pickup_token_number).slice(0, 100), date: pickupDay(p.response.pickup_scheduled_date) }
}

const locationName = (locationId: string) => `df-${locationId.replaceAll('-', '').slice(0, 20)}`

export const shiprocketBook = async ({ fetchImpl = fetch, ...creds }: ShiprocketCredentials & { fetchImpl?: typeof fetch }, request: LabelRequest, signal?: AbortSignal): Promise<BookedLabel | null> => {
  const { from, to } = request
  if (from.country !== 'IN' || to.country !== 'IN' || !to.phone) return null
  const token = await logIn({ ...creds, fetchImpl }, signal, true)
  const pickupLocation = locationName(from.locationId)
  const place = await post(fetchImpl, token, '/settings/company/addpickup', {
    pickup_location: pickupLocation, name: from.name, email: from.email ?? '', phone: from.phone ?? '', address: from.line1, address_2: from.line2 ?? '', city: from.city, state: from.region ?? '', country: 'India', pin_code: from.postal,
  }, signal)
  // 422 is "already registered", the usual answer after a location's first label.
  if (!place.ok && place.status !== 422) failed(place)
  await place.body?.cancel()
  const created = await post(fetchImpl, token, '/orders/create/adhoc', {
    order_id: request.reference,
    order_date: new Date().toISOString().slice(0, 16).replace('T', ' '),
    pickup_location: pickupLocation,
    billing_customer_name: to.name, billing_last_name: '', billing_address: to.line1, billing_address_2: to.line2 ?? '', billing_city: to.city, billing_pincode: to.postal,
    billing_state: to.region ?? '', billing_country: 'India', billing_email: to.email ?? '', billing_phone: to.phone,
    shipping_is_billing: true,
    order_items: request.items.map((i) => ({ name: i.name, sku: i.sku ?? i.name.slice(0, 40), units: i.quantity, selling_price: toMajor({ amount: i.unitAmount, currency: request.value.currency }), hsn: i.hsCode ?? '' })),
    payment_method: 'Prepaid',
    sub_total: toMajor(request.value),
    length: boxCm, breadth: boxCm, height: boxCm,
    weight: (Math.max(request.weightGrams, 1) / 1000).toFixed(3),
  }, signal)
  // An address or phone Shiprocket won't take is the parcel's problem, not an outage.
  if (created.status === 400 || created.status === 422) return null
  const shipmentId = String((await read(created, orderSchema, 'order')).shipment_id)
  const awbResponse = await post(fetchImpl, token, '/courier/assign/awb', { shipment_id: shipmentId }, signal)
  if (awbResponse.status === 400 || awbResponse.status === 422) return null
  const awb = await read(awbResponse, awbSchema, 'courier')
  const trackingNumber = String(awb.response.data.awb_code)
  if (!trackingNumber) return null
  // The courier is assigned and billed from here: a failure names the shipment, so it can be cancelled there.
  let label: BookedLabel['label']
  try {
    const labelLink = await read(await post(fetchImpl, token, '/courier/generate/label', { shipment_id: [Number(shipmentId)] }, signal), labelSchema, 'label')
    label = await fetchLabel(labelLink.label_url, { fetchImpl, signal, name: 'shiprocket' })
  } catch {
    throw new CourierBoughtUnfinished('shiprocket: label not fetched', shipmentId)
  }
  // A pickup not asked now can be asked later (requestPickup), so it never undoes a label already bought.
  const pickup = request.pickup === 'scheduled' ? await askPickup(fetchImpl, token, shipmentId, signal).catch(() => null) : null
  return { providerRef: shipmentId, trackingNumber, trackingUrl: shiprocketTrackingUrl(trackingNumber), courierName: awb.response.data.courier_name.slice(0, 80), label, pickup }
}

export const shiprocketPickup = async ({ fetchImpl = fetch, ...creds }: ShiprocketCredentials & { fetchImpl?: typeof fetch }, shipment: { providerRef: string; from: LabelAddress }, signal?: AbortSignal): Promise<PickupBooked> => {
  const token = await logIn({ ...creds, fetchImpl }, signal, true)
  return askPickup(fetchImpl, token, shipment.providerRef, signal)
}

// Tracking (SAPI 12): Shiprocket posts each status change with the token the partner set on its webhook as `x-api-key`;
// its times are India's, without a zone.
const hookSchema = z.object({ awb: z.union([z.string(), z.number()]), current_status: z.string(), current_timestamp: z.string().nullish() }).loose()

const statusOf = (raw: string): TrackingStatus | null => {
  const s = raw.trim().toUpperCase()
  if (s === 'DELIVERED') return 'delivered'
  if (s === 'OUT FOR DELIVERY') return 'out_for_delivery'
  if (s.startsWith('RTO')) return 'returned'
  if (s === 'CANCELED' || s === 'CANCELLED') return 'cancelled'
  if (['UNDELIVERED', 'LOST', 'DAMAGED', 'DESTROYED', 'MISROUTED'].includes(s)) return 'exception'
  if (['PICKED UP', 'SHIPPED', 'IN TRANSIT', 'REACHED AT DESTINATION HUB', 'REACHED DESTINATION HUB', 'DELAYED'].includes(s)) return 'in_transit'
  // Before the courier has it (manifested, pickup scheduled), nothing has moved.
  return null
}

const istTime = (raw: string | null | undefined): Date | null => {
  const m = raw ? /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/.exec(raw.trim()) ?? /^(\d{2}) (\d{2}) (\d{4}) (\d{2}):(\d{2}):(\d{2})$/.exec(raw.trim()) : null
  if (!m) return null
  const [y, mo, d] = (m[1]?.length === 4 ? [m[1], m[2], m[3]] : [m[3], m[2], m[1]]) as [string, string, string]
  const at = new Date(`${y}-${mo}-${d}T${m[4]}:${m[5]}:${m[6]}+05:30`)
  return Number.isNaN(at.getTime()) ? null : at
}

export const shiprocketHook = async (token: string | null | undefined, hook: CourierHook): Promise<TrackingEvent[] | null> => {
  if (!token || !(await sameSecret(hook.headers.get('x-api-key') ?? '', token))) return null
  let json: unknown
  try {
    json = JSON.parse(hook.body)
  } catch {
    return []
  }
  const parsed = hookSchema.safeParse(json)
  const status = parsed.success ? statusOf(parsed.data.current_status) : null
  // Without the courier's own time an event can't be ordered, so it is ignored rather than taken as the newest.
  const at = parsed.success ? istTime(parsed.data.current_timestamp) : null
  if (!parsed.success || !status || !at) return []
  return [{ providerRef: null, trackingNumber: String(parsed.data.awb).slice(0, 80), status, at }]
}
