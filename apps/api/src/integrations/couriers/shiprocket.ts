import { z } from 'zod'
import { CourierBoughtUnfinished, CourierRejected, CourierUnavailable, type BookedLabel, type LoginCheck, type CourierHook, type CourierRate, type LabelAddress, type LabelRequest, type Parcel, type PickupBooked, type TrackingEvent, type TrackingStatus } from '#core/couriers'
import { logEvent } from '#core/log'
import { fromDecimalRounded, toMajor } from '#core/money'
import { sameSecret } from '#core/secrets'
import { courierCall, fetchLabel } from './request'

// A store's Shiprocket account (THIRD-PARTY-ACCESS §3.2, §4; #1489): a dedicated API user's email and password, exchanged
// for a token on each quote, since the Worker keeps nothing between requests. Domestic India only.

export interface ShiprocketCredentials {
  email: string
  password: string
  /** The token the merchant set on its Shiprocket webhook, which tracking hooks carry. */
  webhookToken?: string | null
  /** The sales channel its orders land in; Shiprocket's default channel when unset. */
  channelId?: string | null
}

const base = 'https://apiv2.shiprocket.in/v1/external'

const loginSchema = z.object({ token: z.string().min(1) }).loose()
const companySchema = z.object({ courier_name: z.string(), rate: z.union([z.number(), z.string()]), estimated_delivery_days: z.union([z.number(), z.string()]).nullish() }).loose()
const serviceabilitySchema = z.object({ data: z.object({ available_courier_companies: z.array(companySchema) }).loose() }).loose()

const call = (fetchImpl: typeof fetch, url: string, init: RequestInit, signal: AbortSignal | undefined, retry = false): Promise<Response> =>
  courierCall(url, init, { fetchImpl, signal, retry, name: 'shiprocket' })

const failed = (response: Response, step = 'call'): never => {
  if (response.status === 401 || response.status === 403) throw new CourierRejected(`shiprocket: ${step} refused`)
  throw new CourierUnavailable(`shiprocket: ${step} answered ${response.status}`)
}

// A quote is never retried: checkout waits on it, and falls back to the flat rate instead.
const logIn = async ({ email, password, fetchImpl = fetch }: ShiprocketCredentials & { fetchImpl?: typeof fetch }, signal: AbortSignal | undefined, retry: boolean): Promise<string> => {
  const login = await call(fetchImpl, `${base}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify({ email, password }) }, signal, retry)
  // A wrong email or password answers 400 as well as 401.
  if (login.status === 400) throw new CourierRejected('shiprocket: login refused')
  if (!login.ok) failed(login, 'login')
  const token = loginSchema.safeParse(await login.json().catch(() => null))
  if (!token.success) throw new CourierUnavailable('shiprocket: no token')
  return token.data.token
}

const days = (value: number | string | null | undefined): number | null => {
  const n = typeof value === 'string' ? Number.parseInt(value, 10) : value
  return typeof n === 'number' && Number.isInteger(n) && n >= 0 && n < 100 ? n : null
}

/** Whether a login works, asked once and never retried: a merchant waits on it when connecting (#1489). */
export const shiprocketCheck = async ({ email, password, fetchImpl = fetch }: { email: string; password: string; fetchImpl?: typeof fetch }, signal?: AbortSignal): Promise<LoginCheck> => {
  try {
    await logIn({ email, password, fetchImpl }, signal, false)
    return 'ok'
  } catch (error) {
    if (error instanceof CourierRejected) return 'rejected'
    if (error instanceof CourierUnavailable) {
      // Why it didn't answer (no reply, a status, no token), so a merchant's "didn't answer" can be traced; never the login.
      logEvent({ event: 'courier_login_check', api: 'store', code: error.message })
      return 'unavailable'
    }
    throw error
  }
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
  if (!response.ok) failed(response, 'rates')
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

const pickupListSchema = z.object({ data: z.object({ shipping_address: z.array(z.object({ pickup_location: z.string() }).loose()) }).loose() }).loose()
const orderSchema = z.object({ shipment_id: z.union([z.number(), z.string()]) }).loose()
// A refused assignment answers 200 with `awb_assign_status: 0` and no code (the reference plugin's check).
const awbSchema = z.object({ awb_assign_status: z.number().nullish(), response: z.object({ data: z.object({ awb_code: z.union([z.string(), z.number()]).nullish(), courier_name: z.string().nullish() }).loose() }).loose() }).loose()
const labelSchema = z.object({ label_url: z.string() }).loose()
const pickupSchema = z.object({ response: z.object({ pickup_scheduled_date: z.string().nullish(), pickup_token_number: z.union([z.string(), z.number()]).nullish() }).loose() }).loose()

/** Shiprocket's own tracking page, which the shopper's email and text link to. */
export const shiprocketTrackingUrl = (awb: string) => `https://shiprocket.co/tracking/${encodeURIComponent(awb)}`

// Shiprocket asks for a box and an order line carries no dimensions, so every parcel goes as a 10 cm cube (FIRST-RELEASE §19).
const boxCm = 10

const post = async (fetchImpl: typeof fetch, token: string, path: string, body: unknown, signal: AbortSignal | undefined): Promise<Response> =>
  call(fetchImpl, `${base}${path}`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify(body) }, signal)

// An answer's shape without its values, which echo the address: its keys and Shiprocket's own status code.
const shapeOf = (body: unknown, depth = 1): string => {
  if (Array.isArray(body)) return `[${body.length}]`
  if (!body || typeof body !== 'object') return typeof body
  const code = 'status_code' in body && typeof body.status_code === 'number' ? ` ${body.status_code}` : ''
  const keys = Object.entries(body).filter(([k]) => /^[\w.]{1,40}$/.test(k)).slice(0, 10)
  return `${keys.map(([k, v]) => (depth > 0 && v && typeof v === 'object' ? `${k}{${shapeOf(v, depth - 1)}}` : k)).join(',')}${code}`
}

const read = async <T>(response: Response, schema: z.ZodType<T>, what: string): Promise<T> => {
  if (!response.ok) failed(response, what)
  const json: unknown = await response.json().catch(() => null)
  const body = schema.safeParse(json)
  if (!body.success) throw new CourierUnavailable(`shiprocket: unreadable ${what} ${response.status} ${shapeOf(json)}`)
  return body.data
}

const pickupDay = (value: string | null | undefined): string | null => (value && /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : null)

const askPickup = async (fetchImpl: typeof fetch, token: string, shipmentId: string, signal: AbortSignal | undefined): Promise<PickupBooked> => {
  const p = await read(await post(fetchImpl, token, '/courier/generate/pickup', { shipment_id: [Number(shipmentId)] }, signal), pickupSchema, 'pickup')
  return { ref: p.response.pickup_token_number == null ? null : String(p.response.pickup_token_number).slice(0, 100), date: pickupDay(p.response.pickup_scheduled_date) }
}

const locationName = (locationId: string) => `df-${locationId.replaceAll('-', '').slice(0, 20)}`

/** Shiprocket takes a phone as its 10 national digits; numbers are kept in E.164 (`+91…`). */
export const indianPhone = (phone: string | null | undefined): string | null => {
  const d = (phone ?? '').replace(/\D/g, '')
  const n = d.length === 12 && d.startsWith('91') ? d.slice(2) : d.length === 11 && d.startsWith('0') ? d.slice(1) : d
  return /^\d{10}$/.test(n) ? n : null
}

const errorFieldsOf = (body: unknown): string[] => {
  const errors = body && typeof body === 'object' && 'errors' in body ? body.errors : null
  return errors && typeof errors === 'object' ? Object.keys(errors).filter((k) => /^[\w.]{1,40}$/.test(k)).slice(0, 8) : []
}

// What Shiprocket refused, by step, status and the fields it named: never its messages, which echo the address (LOGGING §9).
const refused = (step: string, status: number, fields: string[], ref?: string): null => {
  logEvent({ event: 'courier_refused', api: 'store', code: ['shiprocket', step, status, fields.join(','), ref ?? ''].join(':') })
  return null
}

export const shiprocketBook = async ({ fetchImpl = fetch, channelId, ...creds }: ShiprocketCredentials & { fetchImpl?: typeof fetch }, request: LabelRequest, signal?: AbortSignal): Promise<BookedLabel | null> => {
  const { from, to } = request
  if (from.country !== 'IN' || to.country !== 'IN') return null
  const phone = indianPhone(to.phone)
  if (!phone) return refused('phone', 0, ['billing_phone'])
  const token = await logIn({ ...creds, fetchImpl }, signal, true)
  const pickupLocation = locationName(from.locationId)
  // Registered once per location: looked up in the account's list first (`GET /settings/company/pickup`), added if missing.
  const listed = pickupListSchema.safeParse(await (await call(fetchImpl, `${base}/settings/company/pickup`, { headers: { authorization: `Bearer ${token}`, accept: 'application/json' } }, signal, true)).json().catch(() => null))
  if (!listed.success) throw new CourierUnavailable('shiprocket: unreadable pickup list')
  if (!listed.data.data.shipping_address.some((p) => p.pickup_location === pickupLocation)) {
    const place = await post(fetchImpl, token, '/settings/company/addpickup', {
      pickup_location: pickupLocation, name: from.name, email: from.email ?? '', phone: indianPhone(from.phone) ?? '', address: from.line1, address_2: from.line2 ?? '', city: from.city, state: from.region ?? '', country: 'India', pin_code: from.postal,
      // Optional coordinates on a pickup location (#815's card records the source).
      ...(from.pin ? { lat: String(from.pin.latitude), long: String(from.pin.longitude) } : {}),
    }, signal)
    if (place.status >= 500 || place.status === 429) failed(place, 'pickup')
    // Any other refusal is the location's address or phone, which the merchant fixes.
    if (!place.ok) return refused('pickup', place.status, errorFieldsOf(await place.json().catch(() => null)))
    await place.body?.cancel()
  }
  const created = await post(fetchImpl, token, '/orders/create/adhoc', {
    order_id: request.reference,
    order_date: new Date().toISOString().slice(0, 16).replace('T', ' '),
    pickup_location: pickupLocation,
    ...(channelId ? { channel_id: channelId } : {}),
    billing_customer_name: to.name, billing_last_name: '', billing_address: to.line1, billing_address_2: to.line2 ?? '', billing_city: to.city, billing_pincode: to.postal,
    billing_state: to.region ?? '', billing_country: 'India', billing_email: to.email ?? '', billing_phone: phone,
    shipping_is_billing: true,
    order_items: request.items.map((i) => ({ name: i.name, sku: i.sku ?? i.name.slice(0, 40), units: i.quantity, selling_price: toMajor({ amount: i.unitAmount, currency: request.value.currency }), hsn: i.hsCode ?? '' })),
    // Cash on delivery: the courier collects sub_total from the shopper.
    payment_method: request.collect ? 'COD' : 'Prepaid',
    sub_total: toMajor(request.collect ?? request.value),
    length: boxCm, breadth: boxCm, height: boxCm,
    weight: (Math.max(request.weightGrams, 1) / 1000).toFixed(3),
  }, signal)
  // An address or phone Shiprocket won't take is the parcel's problem, not an outage.
  if (created.status === 400 || created.status === 422) return refused('order', created.status, errorFieldsOf(await created.json().catch(() => null)))
  if (!created.ok) failed(created, 'order')
  // A refused order can answer 200 with a message and no shipment, e.g. a pickup location Shiprocket doesn't hold.
  const answer: unknown = await created.json().catch(() => null)
  const order = orderSchema.safeParse(answer)
  if (!order.success) return refused('order', created.status, [shapeOf(answer)])
  const shipmentId = String(order.data.shipment_id)
  // From here the order is on the store's Shiprocket board, so a refusal names its shipment.
  const awbResponse = await post(fetchImpl, token, '/courier/assign/awb', { shipment_id: shipmentId }, signal)
  if (awbResponse.status === 400 || awbResponse.status === 422) return refused('awb', awbResponse.status, errorFieldsOf(await awbResponse.json().catch(() => null)), shipmentId)
  const awb = await read(awbResponse, awbSchema, 'courier')
  const assigned = awb.response.data
  if (awb.awb_assign_status === 0 || assigned.awb_code == null || String(assigned.awb_code) === '' || !assigned.courier_name) return refused('awb', awbResponse.status, [], shipmentId)
  const trackingNumber = String(assigned.awb_code)
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
  return { providerRef: shipmentId, trackingNumber, trackingUrl: shiprocketTrackingUrl(trackingNumber), courierName: assigned.courier_name.slice(0, 80), label, pickup }
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

// Tracking asked, for a hook that may not have come (`GET /courier/track/shipment/{id}`): the parcel's current status in the
// hook's own words, at its latest activity's time (India's). A courier's own activity codes are no status.
const trackSchema = z.object({
  tracking_data: z.object({
    shipment_track: z.array(z.object({ current_status: z.string().nullish() }).loose()).nullish(),
    shipment_track_activities: z.array(z.object({ date: z.string() }).loose()).nullish(),
  }).loose(),
}).loose()

/** Each shipment's status that means something to the shopper; one login for the lot, a parcel not answered left for the next run. */
export const shiprocketTrack = async ({ fetchImpl = fetch, ...creds }: ShiprocketCredentials & { fetchImpl?: typeof fetch }, shipmentIds: readonly string[], signal?: AbortSignal, now = new Date()): Promise<TrackingEvent[]> => {
  const token = await logIn({ ...creds, fetchImpl }, signal, true)
  const events: TrackingEvent[] = []
  for (const id of shipmentIds) {
    const response = await call(fetchImpl, `${base}/courier/track/shipment/${encodeURIComponent(id)}`, { headers: { authorization: `Bearer ${token}`, accept: 'application/json' } }, signal)
    if (response.status === 401 || response.status === 403) failed(response, 'track')
    const json: unknown = response.ok ? await response.json().catch(() => null) : (await response.body?.cancel(), null)
    const body = response.ok ? trackSchema.safeParse(json) : null
    // An answer read as nothing is told apart from a parcel that hasn't moved: its status and shape, never its values.
    if (!body?.success) logEvent({ event: 'courier_track_unread', api: 'system', code: `shiprocket:${response.status}:${shapeOf(json)}` })
    if (!body?.success) continue
    const status = statusOf(body.data.tracking_data.shipment_track?.[0]?.current_status ?? '')
    const at = (body.data.tracking_data.shipment_track_activities ?? []).map((a) => istTime(a.date)).reduce<Date | null>((latest, d) => (d && (!latest || d > latest) ? d : latest), null)
    // A parcel cancelled before pickup may have no activity; a final status can't be overtaken, so the time asked does.
    const when = at ?? (status === 'cancelled' ? now : null)
    if (status && when) events.push({ providerRef: id, trackingNumber: null, status, at: when })
  }
  return events
}

// COD remittance (apidocs.shiprocket.in): a shipment's order (`GET /shipments/{id}` → data.order_id), then that order's
// `remittance_utr` (`GET /orders/show/{id}`), the bank transfer's reference. Its `remittance_status` values aren't
// documented, so only a UTR counts as paid out.
const shipmentSchema = z.object({ data: z.object({ order_id: z.union([z.number(), z.string()]) }).loose() }).loose()
const orderShowSchema = z.object({ data: z.object({ remittance_utr: z.union([z.string(), z.number()]).nullish() }).loose() }).loose()

const getJson = async (fetchImpl: typeof fetch, token: string, path: string, signal: AbortSignal | undefined): Promise<unknown> => {
  const response = await call(fetchImpl, `${base}${path}`, { headers: { authorization: `Bearer ${token}`, accept: 'application/json' } }, signal, true)
  if (response.status === 401 || response.status === 403) failed(response, 'remittance')
  return response.ok ? response.json().catch(() => null) : (await response.body?.cancel(), null)
}

/** The shipments whose COD Shiprocket has paid out; one not answered, or not yet remitted, is left for the next run. */
export const shiprocketRemitted = async ({ fetchImpl = fetch, ...creds }: ShiprocketCredentials & { fetchImpl?: typeof fetch }, shipmentIds: readonly string[], signal?: AbortSignal): Promise<string[]> => {
  const token = await logIn({ ...creds, fetchImpl }, signal, true)
  const remitted: string[] = []
  for (const id of shipmentIds) {
    const shipment = shipmentSchema.safeParse(await getJson(fetchImpl, token, `/shipments/${encodeURIComponent(id)}`, signal))
    if (!shipment.success) continue
    const order = orderShowSchema.safeParse(await getJson(fetchImpl, token, `/orders/show/${encodeURIComponent(String(shipment.data.data.order_id))}`, signal))
    const utr = order.success ? String(order.data.data.remittance_utr ?? '').trim() : ''
    if (utr !== '') remitted.push(id)
  }
  return remitted
}
