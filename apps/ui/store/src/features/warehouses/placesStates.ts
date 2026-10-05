import type { Place } from '../../api/stock'

// The Warehouses tab's states under ?state= (ui/README.md §6): loading, error, empty, list.
export const placesStates = ['loading', 'error', 'empty', 'list'] as const

export type PlacesState = (typeof placesStates)[number]

const address = (city: string) => ({ line1: '12 Station Road', line2: null, city, region: 'UP', postalCode: '244001', country: 'IN' })

// A build-time constant Vite folds, so a production bundle carries none of these literals.
const places: Place[] =
  import.meta.env.DEV || import.meta.env.VITE_STATE_HARNESS === '1'
    ? [
        { id: 'w-workshop', name: 'Workshop', isDefault: true, units: 312, revision: 2, address: address('Moradabad'), supplierId: null },
        { id: 'w-back', name: 'Back room', isDefault: false, units: 40, revision: 1, address: address('Moradabad'), supplierId: null },
      ]
    : []

export const placesSample = (state: PlacesState | null): Place[] | null => (places.length === 0 || (state !== 'list' && state !== 'empty') ? null : state === 'empty' ? [] : places)
