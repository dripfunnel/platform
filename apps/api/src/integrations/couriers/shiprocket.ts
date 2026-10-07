import { z } from 'zod'
import { CourierRejected, courierTimeoutMs, CourierUnavailable, type CourierRate, type Parcel } from '#core/couriers'
import { fromDecimalRounded, toMajor } from '#core/money'

// A partner's Shiprocket account (THIRD-PARTY-ACCESS §3.2, §4): a dedicated API user's email and password, exchanged
// for a token on each quote, since the Worker keeps nothing between requests. Domestic India only.

export interface ShiprocketCredentials {
  email: string
  password: string
}

const base = 'https://apiv2.shiprocket.in/v1/external'

const loginSchema = z.object({ token: z.string().min(1) }).loose()
const companySchema = z.object({ courier_name: z.string(), rate: z.union([z.number(), z.string()]), estimated_delivery_days: z.union([z.number(), z.string()]).nullish() }).loose()
const serviceabilitySchema = z.object({ data: z.object({ available_courier_companies: z.array(companySchema) }).loose() }).loose()

const call = async (fetchImpl: typeof fetch, url: string, init: RequestInit, signal: AbortSignal | undefined): Promise<Response> => {
  const timeout = AbortSignal.timeout(courierTimeoutMs)
  try {
    return await fetchImpl(url, { ...init, signal: signal ? AbortSignal.any([signal, timeout]) : timeout })
  } catch {
    throw new CourierUnavailable('shiprocket: no answer')
  }
}

const failed = (response: Response): never => {
  if (response.status === 401 || response.status === 403) throw new CourierRejected('shiprocket: login refused')
  throw new CourierUnavailable(`shiprocket: answered ${response.status}`)
}

const days = (value: number | string | null | undefined): number | null => {
  const n = typeof value === 'string' ? Number.parseInt(value, 10) : value
  return typeof n === 'number' && Number.isInteger(n) && n >= 0 && n < 100 ? n : null
}

export const shiprocketQuote = async ({ email, password, fetchImpl = fetch }: ShiprocketCredentials & { fetchImpl?: typeof fetch }, parcel: Parcel, signal?: AbortSignal): Promise<CourierRate | null> => {
  if (parcel.from.country !== 'IN' || parcel.to.country !== 'IN') return null
  const login = await call(fetchImpl, `${base}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify({ email, password }) }, signal)
  // A wrong email or password answers 400 as well as 401.
  if (login.status === 400) throw new CourierRejected('shiprocket: login refused')
  if (!login.ok) failed(login)
  const token = loginSchema.safeParse(await login.json().catch(() => null))
  if (!token.success) throw new CourierUnavailable('shiprocket: no token')
  const query = new URLSearchParams({
    pickup_postcode: parcel.from.postal,
    delivery_postcode: parcel.to.postal,
    // Kilograms, Shiprocket's smallest slab being half of one.
    weight: (Math.max(parcel.weightGrams, 1) / 1000).toFixed(3),
    cod: '0',
    declared_value: toMajor(parcel.value),
  })
  const response = await call(fetchImpl, `${base}/courier/serviceability/?${query.toString()}`, { headers: { authorization: `Bearer ${token.data.token}`, accept: 'application/json' } }, signal)
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
