import type { Place, PlaceInput } from '../../../api/settingsWarehouse'

export type PlaceForm = { id: string | null; revision: number | null; name: string; line1: string; line2: string; city: string; region: string; postalCode: string; country: string }

export const blankPlace: PlaceForm = { id: null, revision: null, name: '', line1: '', line2: '', city: '', region: '', postalCode: '', country: '' }

export const formOfPlace = (place: Place): PlaceForm => ({
  id: place.id,
  revision: place.revision,
  name: place.name,
  line1: place.address?.line1 ?? '',
  line2: place.address?.line2 ?? '',
  city: place.address?.city ?? '',
  region: place.address?.region ?? '',
  postalCode: place.address?.postalCode ?? '',
  country: place.address?.country ?? '',
})

/** The form as the API takes it: the name, and only the address lines given. */
export const placeInputOf = (form: PlaceForm): PlaceInput => {
  const address: PlaceInput['address'] = {}
  for (const key of ['line1', 'line2', 'city', 'region', 'postalCode', 'country'] as const) {
    const value = form[key].trim()
    if (value) address[key] = key === 'country' ? value.toUpperCase() : value
  }
  return { name: form.name.trim(), address }
}

export const addressLine = (place: Place): string => [place.address?.line1, place.address?.city, place.address?.region, place.address?.country].filter(Boolean).join(', ')

/** The store's own locations, the default first, and its suppliers' apart (they are read-only here). */
export const splitPlaces = (places: readonly Place[]): { own: Place[]; theirs: Place[] } => ({
  own: places.filter((place) => place.supplierId === null).sort((a, b) => Number(b.isDefault) - Number(a.isDefault)),
  theirs: places.filter((place) => place.supplierId !== null),
})
