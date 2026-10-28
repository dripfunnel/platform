import { isApiError } from '@dripfunnel/shared/graphql'
import { minorOf, moneyText } from '@dripfunnel/shared/format'
import type { Place } from '../../api/stock'
import type { ShippingInput, ShippingSettings } from '../../api/shipping'

// Own delivery's rules as the screens read them (docs/api/DELIVERY.md §2).

export const kmMin = 1
export const kmMax = 50
export const minutesMin = 1
export const minutesMax = 30
export const defaultRiderKm = 5

export type Missing = 'plan' | 'rider' | 'warehouse'
const missingKeys: readonly string[] = ['plan', 'rider', 'warehouse']

/** What turning it on still needs, from OWN_DELIVERY_NOT_READY's `missing`; null for any other error. */
export const missingOf = (error: unknown): Missing[] | null => {
  if (!isApiError(error, 'OWN_DELIVERY_NOT_READY')) return null
  const { missing } = error.details
  return Array.isArray(missing) ? missing.filter((m): m is Missing => typeof m === 'string' && missingKeys.includes(m)) : []
}

/** Typed whole kilometres as the API's metres; null when empty, 'invalid' outside 1–50. */
export const metresOfKm = (text: string): number | null | 'invalid' => {
  const t = text.trim()
  if (t === '') return null
  if (!/^\d+$/.test(t)) return 'invalid'
  const km = Number(t)
  return km < kmMin || km > kmMax ? 'invalid' : km * 1000
}

export const kmText = (metres: number | null | undefined): string => (metres == null ? '' : String(Math.round(metres / 1000)))

/** Typed whole minutes, 1–30; null when empty or outside. */
export const minutesOf = (text: string): number | null => {
  const t = text.trim()
  const n = /^\d+$/.test(t) ? Number(t) : NaN
  return n >= minutesMin && n <= minutesMax ? n : null
}

/** The saved shipping fields as a save sends them, so the own-delivery card never carries the form's unsaved edits. */
export const inputOfSaved = (s: ShippingSettings): ShippingInput => ({
  courierRate: s.courierRate,
  flatRate: s.flatRate,
  flatAmount: s.flatAmount,
  pickup: s.pickup,
  pickupHours: s.pickupHours,
  freeMode: s.freeMode,
  freeThresholdAmount: s.freeThresholdAmount,
  areaMode: s.areaMode,
})

export const isPinned = (p: Place): boolean => typeof p.latitude === 'number' && typeof p.longitude === 'number'

/** The store's own locations: a supplier's never carry delivery settings. */
export const ownPlaces = (places: readonly Place[]): Place[] => places.filter((p) => p.supplierId === null)

/** A location that delivers with the store's riders, which is what the API counts as the warehouse piece. */
export const delivers = (p: Place): boolean => p.ownDelivery === true

export const feeText = (p: Place, currency: string): string => (p.deliveryFeeAmount == null ? '' : moneyText({ amount: Number(p.deliveryFeeAmount), currency }))

/** The typed fee as minor units in the store's currency; null empty, 'invalid' unreadable. */
export const feeMinor = (text: string, currency: string): string | null | 'invalid' => {
  const minor = minorOf(text, currency)
  return minor === 'invalid' ? 'invalid' : minor === null ? null : String(minor)
}
