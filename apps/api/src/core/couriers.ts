import type { Money } from './money'

// The one contract every courier adapter keeps (THIRD-PARTY-ACCESS §3.2): Shiprocket in India, and USPS, UPS and
// FedEx through EasyPost in the US, each on the partner's own account (#272, #337).

export const courierProviders = ['shiprocket', 'usps', 'ups', 'fedex'] as const
export type CourierProvider = (typeof courierProviders)[number]

/** The account a courier goes through: Shiprocket is its own, the US carriers are EasyPost's. */
export type CourierAccountKind = 'shiprocket' | 'easypost'
export const accountKindOf = (provider: CourierProvider): CourierAccountKind => (provider === 'shiprocket' ? 'shiprocket' : 'easypost')

/** The couriers a store in this country may use; the EU's wait with the EU region (THIRD-PARTY-ACCESS §3.2). */
export const couriersFor = (country: string | null): readonly CourierProvider[] => (country === 'IN' ? ['shiprocket'] : country === 'US' ? ['usps', 'ups', 'fedex'] : [])

export interface Parcel {
  from: { country: string; postal: string }
  to: { country: string; region: string | null; postal: string }
  weightGrams: number
  /** What's inside, for the courier's insurance and cash-on-delivery limits. */
  value: Money
}

export interface CourierRate {
  amount: Money
  /** The courier's own name for the service, e.g. "Priority" or "Delhivery Surface". */
  service: string
  minDays: number | null
  maxDays: number | null
}

export interface CourierGateway {
  /** The cheapest rate this courier offers for the parcel; null when it serves no such route. */
  quote: (provider: CourierProvider, parcel: Parcel, signal?: AbortSignal) => Promise<CourierRate | null>
}

/** The courier's login or key was refused: the partner's account needs fixing, not the parcel. */
export class CourierRejected extends Error {
  override name = 'CourierRejected'
}

/** No answer in time, throttled, or the courier failed itself. */
export class CourierUnavailable extends Error {
  override name = 'CourierUnavailable'
}

export const courierTimeoutMs = 6_000

/** A partner's couriers: which accounts it has connected, and a gateway quoting through them (#275 stores them). */
export interface PartnerCouriers {
  accounts: ReadonlySet<CourierAccountKind>
  gateway: CourierGateway
}

export interface CourierDirectory {
  forPartner: (partnerId: string) => Promise<PartnerCouriers>
}
