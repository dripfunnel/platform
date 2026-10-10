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

export interface LabelAddress {
  name: string
  line1: string
  line2: string | null
  city: string
  region: string | null
  postal: string
  country: string
  phone: string | null
  email: string | null
}

export type LabelSize = 'a6' | 'a4' | '4x6' | 'letter'
export type PickupMode = 'scheduled' | 'on_request'

export interface LabelRequest {
  /** Our shipment's id: the courier's reference for it, so the same shipment is never two parcels there. */
  reference: string
  /** The location it leaves from; `locationId` names it at a courier that keeps pickup addresses (Shiprocket). */
  from: LabelAddress & { locationId: string }
  to: LabelAddress
  weightGrams: number
  items: readonly { name: string; sku: string | null; quantity: number; unitAmount: bigint; hsCode: string | null }[]
  value: Money
  labelSize: LabelSize
  /** `scheduled`: the courier collects every working day, so booking asks for this parcel's pickup at once. */
  pickup: PickupMode
}

export interface PickupBooked {
  ref: string | null
  /** The day the courier says it comes (YYYY-MM-DD), when it says. */
  date: string | null
}

export interface BookedLabel {
  /** The courier's own id for the shipment, which its tracking and pickups name. */
  providerRef: string
  trackingNumber: string
  trackingUrl: string | null
  /** The carrier and service as the shopper sees them, e.g. "Delhivery Surface" or "USPS Priority". */
  courierName: string
  label: { bytes: Uint8Array<ArrayBuffer>; mime: 'application/pdf' | 'image/png' }
  /** Asked for with the label when pickups are scheduled; null otherwise. */
  pickup: PickupBooked | null
}

/** Where a booked parcel is, as either courier's tracking says it in its own words (THIRD-PARTY-ACCESS §3.2). */
export const trackingStatuses = ['in_transit', 'out_for_delivery', 'delivered', 'exception', 'returned', 'cancelled'] as const
export type TrackingStatus = (typeof trackingStatuses)[number]

export interface TrackingEvent {
  /** The courier's id for the parcel, or its tracking number: each courier's hook names one or both. */
  providerRef: string | null
  trackingNumber: string | null
  status: TrackingStatus
  at: Date
}

/** A tracking hook as it arrived, read once and verified with the account's own secret. */
export interface CourierHook {
  body: string
  headers: Headers
}

export interface CourierGateway {
  /** The cheapest rate this courier offers for the parcel; null when it serves no such route. */
  quote: (provider: CourierProvider, parcel: Parcel, signal?: AbortSignal) => Promise<CourierRate | null>
  /** Buys the cheapest service's label; null when the courier won't take the parcel (route, address or weight). */
  book: (provider: CourierProvider, request: LabelRequest, signal?: AbortSignal) => Promise<BookedLabel | null>
  /** Asks the courier to collect a booked parcel from where it left. */
  pickup: (provider: CourierProvider, shipment: { providerRef: string; from: LabelAddress }, signal?: AbortSignal) => Promise<PickupBooked>
  /** A tracking hook's events, or null when the account has no secret or the hook doesn't prove it was signed with it. */
  readHook: (account: CourierAccountKind, hook: CourierHook) => Promise<TrackingEvent[] | null>
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
/** A whole booking's calls together, which run inside the shipment's transaction (FIRST-RELEASE §19 `bookLabel`). */
export const bookingDeadlineMs = 20_000
/** A label file's cap: a courier's PDF is tens of kilobytes. */
export const maxLabelBytes = 2 * 1024 * 1024

/** A partner's couriers: which accounts it has connected, and a gateway quoting through them (#275 stores them). */
export interface PartnerCouriers {
  accounts: ReadonlySet<CourierAccountKind>
  gateway: CourierGateway
}

export interface CourierDirectory {
  forPartner: (partnerId: string) => Promise<PartnerCouriers>
}
