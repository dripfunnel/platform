import type { CourierProvider } from '#core/couriers'
import { compare, parseMinor, type Money } from '#core/money'

// The pure rules of Settings › Shipping and of pricing delivery (SetOps; DESIGN-BRIEF flows 54–55): what a save may
// hold, how a postcode is read, and which options a shopper is offered at what price.

export type ShippingRefusal =
  | 'INVALID_INPUT'
  | 'STALE'
  | 'NO_METHOD'
  | 'NO_COURIER'
  | 'NO_ADDRESS'
  | 'NO_AREA_LIST'
  | 'TOO_MANY'
  | 'COURIER_NOT_OFFERED'
  | 'NOT_CONNECTED'
  | 'NOT_FOUND'

export interface ShippingInput {
  courierRate: boolean
  flatRate: boolean
  flatAmount?: string | null | undefined
  pickup: boolean
  pickupHours?: string | null | undefined
  freeMode: string
  freeThresholdAmount?: string | null | undefined
  areaMode: string
}

export interface CleanShipping {
  courierEnabled: boolean
  flatEnabled: boolean
  flatAmount: bigint | null
  pickupEnabled: boolean
  pickupHours: string | null
  freeMode: 'never' | 'always' | 'over'
  freeThresholdAmount: bigint | null
  areaMode: 'everywhere' | 'list'
}

/** A save, cleaned: money in the store's pricing currency; a flat amount kept while it's off, as the courier's fallback. */
export const cleanShipping = (input: ShippingInput, currency: string): CleanShipping | ShippingRefusal => {
  const flat = input.flatAmount?.trim() ? parseMinor(input.flatAmount.trim(), currency) : null
  if (input.flatAmount?.trim() && !flat) return 'INVALID_INPUT'
  if (input.flatRate && !flat) return 'INVALID_INPUT'
  const hours = input.pickupHours?.trim() || null
  if ((hours?.length ?? 0) > 120 || (input.pickup && !hours)) return 'INVALID_INPUT'
  const freeMode = input.freeMode
  if (freeMode !== 'never' && freeMode !== 'always' && freeMode !== 'over') return 'INVALID_INPUT'
  const threshold = freeMode === 'over' && input.freeThresholdAmount?.trim() ? parseMinor(input.freeThresholdAmount.trim(), currency) : null
  if (freeMode === 'over' && (!threshold || threshold.amount === 0n)) return 'INVALID_INPUT'
  if (input.areaMode !== 'everywhere' && input.areaMode !== 'list') return 'INVALID_INPUT'
  if (!input.courierRate && !input.flatRate && !input.pickup) return 'NO_METHOD'
  return {
    courierEnabled: input.courierRate,
    flatEnabled: input.flatRate,
    flatAmount: flat?.amount ?? null,
    pickupEnabled: input.pickup,
    pickupHours: hours,
    freeMode,
    freeThresholdAmount: threshold?.amount ?? null,
    areaMode: input.areaMode,
  }
}

export const maxPostalCodes = 50_000

/**
 * A postcode as the list keeps it and an address is checked against it: letters and digits only, upper case; a US ZIP
 * by its first five digits (ZIP+4 is the same area). Null when it can't be one.
 */
export const normalisePostal = (country: string, code: string): string | null => {
  const compact = code.toUpperCase().replace(/[\s-]/g, '')
  const value = country === 'US' ? compact.slice(0, 5) : compact
  if (!/^[A-Z0-9]{3,10}$/.test(value) || !/\d/.test(value)) return null
  if (country === 'US' && !/^\d{5}$/.test(value)) return null
  if (country === 'IN' && !/^[1-9]\d{5}$/.test(value)) return null
  return value
}

/** The labels each region prints on (SetOps "Label size"). */
export const labelSizesFor = (country: string | null): readonly ('a6' | 'a4' | '4x6' | 'letter')[] => (country === 'US' ? ['4x6', 'letter'] : ['a6', 'a4'])

/** A version with no weight counts as half a kilogram, the smallest slab couriers price (decided on #305). */
export const defaultWeightGrams = 500

export interface DeliveryOption {
  /** Stable per kind, as a cart stores its choice: `courier`, `flat` or `pickup`. */
  id: 'courier' | 'flat' | 'pickup'
  provider: CourierProvider | null
  service: string | null
  amount: Money
  /** What it would have cost, where delivery is free. */
  before: Money | null
  minDays: number | null
  maxDays: number | null
  /** Collection hours, for pickup. */
  hours: string | null
}

export interface OptionFacts {
  currency: string
  settings: Pick<CleanShipping, 'courierEnabled' | 'flatEnabled' | 'pickupEnabled' | 'pickupHours' | 'freeMode'>
  deliverable: boolean
  /** The courier's rate already in the cart's currency, from the first courier that quoted; null when none did. */
  courier: { provider: CourierProvider; amount: Money; service: string; minDays: number | null; maxDays: number | null } | null
  /** The flat rate in the cart's currency (a market's own, or the store's converted); null when there is none. */
  flat: Money | null
  /** The free-delivery threshold in the cart's currency. */
  threshold: Money | null
  subtotal: Money
}

/**
 * The options a shopper is offered, in the order SetOps lists them. Fallback (SetOps): the pricing courier, the next
 * connected one, then the flat rate; collection in person needs no delivery area.
 */
export const deliveryOptions = (f: OptionFacts): DeliveryOption[] => {
  const free = f.settings.freeMode === 'always' || (f.settings.freeMode === 'over' && f.threshold !== null && compare(f.subtotal, f.threshold) >= 0)
  const priced = (amount: Money) => (free ? { amount: { amount: 0n, currency: f.currency }, before: amount.amount === 0n ? null : amount } : { amount, before: null })
  const options: DeliveryOption[] = []
  if (f.deliverable && f.settings.courierEnabled && f.courier) {
    options.push({ id: 'courier', provider: f.courier.provider, service: f.courier.service, ...priced(f.courier.amount), minDays: f.courier.minDays, maxDays: f.courier.maxDays, hours: null })
  }
  const fallback = f.settings.courierEnabled && !f.courier
  if (f.deliverable && f.flat && (f.settings.flatEnabled || fallback)) {
    options.push({ id: 'flat', provider: null, service: null, ...priced(f.flat), minDays: null, maxDays: null, hours: null })
  }
  if (f.settings.pickupEnabled) options.push({ id: 'pickup', provider: null, service: null, amount: { amount: 0n, currency: f.currency }, before: null, minDays: null, maxDays: null, hours: f.settings.pickupHours })
  return options
}
