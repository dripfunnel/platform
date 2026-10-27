import type { Place, PlaceInput } from '../../../api/settingsWarehouse'
import { defaultRiderKm, delivers, feeMinor, feeText, isPinned, kmText, metresOfKm } from '../ownDelivery'

/** A location's own-delivery fields as typed (DELIVERY.md §2): kilometres and the fee in major units, which `placeInputOf` turns into metres and minor units. */
export type DeliveryForm = { wasOn: boolean; pinned: boolean; on: boolean; area: string; rider: string; fee: string }

export type PlaceForm = { id: string | null; revision: number | null; name: string; line1: string; line2: string; city: string; region: string; postalCode: string; country: string; delivery: DeliveryForm | null }

export const blankPlace: PlaceForm = { id: null, revision: null, name: '', line1: '', line2: '', city: '', region: '', postalCode: '', country: '', delivery: null }

/** The store's own location in the form; `currency` is given only when the plan has own delivery, which is when the delivery fields show. */
export const formOfPlace = (place: Place, currency: string | null = null): PlaceForm => ({
  id: place.id,
  revision: place.revision,
  name: place.name,
  line1: place.address?.line1 ?? '',
  line2: place.address?.line2 ?? '',
  city: place.address?.city ?? '',
  region: place.address?.region ?? '',
  postalCode: place.address?.postalCode ?? '',
  country: place.address?.country ?? '',
  delivery:
    currency !== null && place.supplierId === null
      ? {
          wasOn: delivers(place),
          pinned: isPinned(place),
          on: delivers(place),
          area: kmText(place.deliveryRadiusM),
          rider: place.riderRadiusM == null ? String(defaultRiderKm) : kmText(place.riderRadiusM),
          fee: feeText(place, currency),
        }
      : null,
})

const isKm = (text: string): boolean => typeof metresOfKm(text) === 'number'

export type DeliveryProblem = 'area' | 'rider' | 'fee' | 'feeInvalid'

/** The first own-delivery field that can't be saved; a location that stays off has nothing to check. */
export const deliveryProblemOf = (delivery: DeliveryForm | null, currency: string): DeliveryProblem | null => {
  if (delivery === null || !delivery.on) return null
  if (!isKm(delivery.area)) return 'area'
  if (!isKm(delivery.rider)) return 'rider'
  const fee = feeMinor(delivery.fee, currency)
  return fee === 'invalid' ? 'feeInvalid' : fee === null ? 'fee' : null
}

/** The form as the API takes it: the name, only the address lines given, and the own-delivery fields only when they are on or being turned off; left out, what is saved stays. */
export const placeInputOf = (form: PlaceForm, currency = ''): PlaceInput => {
  const address: PlaceInput['address'] = {}
  for (const key of ['line1', 'line2', 'city', 'region', 'postalCode', 'country'] as const) {
    const value = form[key].trim()
    if (value) address[key] = key === 'country' ? value.toUpperCase() : value
  }
  const input: PlaceInput = { name: form.name.trim(), address }
  const { delivery } = form
  if (delivery === null || (!delivery.on && !delivery.wasOn)) return input
  if (!delivery.on) return { ...input, ownDelivery: false }
  const area = metresOfKm(delivery.area)
  const rider = metresOfKm(delivery.rider)
  const fee = feeMinor(delivery.fee, currency)
  return typeof area === 'number' && typeof rider === 'number' && typeof fee === 'string' ? { ...input, ownDelivery: true, deliveryRadiusM: area, riderRadiusM: rider, deliveryFeeAmount: fee } : input
}

export const addressLine = (place: Place): string => [place.address?.line1, place.address?.city, place.address?.region, place.address?.country].filter(Boolean).join(', ')

/** The store's own locations, the default first, and its suppliers' apart (they are read-only here). */
export const splitPlaces = (places: readonly Place[]): { own: Place[]; theirs: Place[] } => ({
  own: places.filter((place) => place.supplierId === null).sort((a, b) => Number(b.isDefault) - Number(a.isDefault)),
  theirs: places.filter((place) => place.supplierId !== null),
})
