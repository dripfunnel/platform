import { minorOf, moneyText } from '@dripfunnel/mobile-shared/format'
import { isApiError } from '@dripfunnel/mobile-shared/graphql'
import type { Place } from '../../api/settingsWarehouse'

// Own delivery's rules as the screens read them (docs/api/DELIVERY.md §2). The API decides each one again.

export const kmMin = 1
export const kmMax = 50
export const minutesMin = 1
export const minutesMax = 30
export const defaultRiderKm = 5

export type Missing = 'plan' | 'rider' | 'warehouse'
const missingKeys: readonly string[] = ['plan', 'rider', 'warehouse']

/** What turning it on still needs, from `OWN_DELIVERY_NOT_READY`'s `missing`; null for any other error. */
export const missingOf = (error: unknown): Missing[] | null => {
  if (!isApiError(error, 'OWN_DELIVERY_NOT_READY')) return null
  const { missing } = error.details
  return Array.isArray(missing) ? missing.filter((piece): piece is Missing => typeof piece === 'string' && missingKeys.includes(piece)) : []
}

/** Typed whole kilometres as the API's metres; null when empty, 'invalid' outside 1–50. */
export const metresOfKm = (text: string): number | null | 'invalid' => {
  const typed = text.trim()
  if (typed === '') return null
  if (!/^\d+$/.test(typed)) return 'invalid'
  const km = Number(typed)
  return km < kmMin || km > kmMax ? 'invalid' : km * 1000
}

export const kmText = (metres: number | null | undefined): string => (metres == null ? '' : String(Math.round(metres / 1000)))

/** Typed whole minutes, 1–30; null when empty or outside. */
export const minutesOf = (text: string): number | null => {
  const typed = text.trim()
  const minutes = /^\d+$/.test(typed) ? Number(typed) : NaN
  return minutes >= minutesMin && minutes <= minutesMax ? minutes : null
}

export const isPinned = (place: Pick<Place, 'latitude' | 'longitude'>): boolean => typeof place.latitude === 'number' && typeof place.longitude === 'number'

/** A location that delivers with the store's riders, which is what the API counts as the warehouse piece. */
export const delivers = (place: Pick<Place, 'ownDelivery'>): boolean => place.ownDelivery === true

export const feeText = (place: Pick<Place, 'deliveryFeeAmount'>, currency: string): string => (place.deliveryFeeAmount == null ? '' : moneyText({ amount: place.deliveryFeeAmount, currency }))

/** The typed fee as minor units in the store's currency; null empty, 'invalid' unreadable. */
export const feeMinor = (text: string, currency: string): string | null | 'invalid' => minorOf(text, currency)
