import type { Place } from '../../../api/settingsWarehouse'
import { addressLine, blankPlace, deliveryProblemOf, formOfPlace, placeInputOf, splitPlaces } from './placeDraft'

const place = (over: Partial<Place> = {}): Place => ({
  id: 'w1',
  name: 'Main godown',
  isDefault: false,
  units: 12,
  revision: 2,
  address: { line1: '14 Johari Bazaar', line2: null, city: 'Jaipur', region: 'Rajasthan', postalCode: '302003', country: 'IN' },
  supplierId: null,
  supplierName: null,
  ...over,
})

describe('a stock location', () => {
  it('goes back to the API with its name and only the address lines given, the country upper-case', () => {
    expect(placeInputOf({ ...blankPlace, name: ' Back room ', city: 'Jaipur', country: 'in' })).toEqual({ name: 'Back room', address: { city: 'Jaipur', country: 'IN' } })
    expect(placeInputOf(formOfPlace(place()))).toEqual({ name: 'Main godown', address: { line1: '14 Johari Bazaar', city: 'Jaipur', region: 'Rajasthan', postalCode: '302003', country: 'IN' } })
  })

  it('opens an edit at its revision, and an empty address as empty text', () => {
    expect(formOfPlace(place())).toMatchObject({ id: 'w1', revision: 2, line2: '' })
    expect(formOfPlace(place({ address: null }))).toMatchObject({ line1: '', country: '' })
  })

  it('draws its address on one line', () => {
    expect(addressLine(place())).toBe('14 Johari Bazaar, Jaipur, Rajasthan, IN')
    expect(addressLine(place({ address: null }))).toBe('')
  })

  it('lists the store’s own with the default first, and its suppliers’ apart', () => {
    const own = place({ id: 'w2', isDefault: true })
    const theirs = place({ id: 'w3', supplierId: 's1', supplierName: 'Northwind' })
    expect(splitPlaces([place(), theirs, own])).toEqual({ own: [own, place()], theirs: [theirs] })
  })
})

describe('a location’s own delivery', () => {
  const pinned = { latitude: 26.9, longitude: 75.8 }
  const delivering = place({ ...pinned, ownDelivery: true, deliveryRadiusM: 5000, riderRadiusM: 7000, deliveryFeeAmount: '4900' })

  it('opens as typed: kilometres and the fee in major units, the rider distance 5 km when none was saved', () => {
    expect(formOfPlace(delivering, 'INR').delivery).toEqual({ wasOn: true, pinned: true, on: true, area: '5', rider: '7', fee: '49.00' })
    expect(formOfPlace(place(), 'INR').delivery).toEqual({ wasOn: false, pinned: false, on: false, area: '', rider: '5', fee: '' })
  })

  it('has no delivery fields without own delivery in the plan, or on a supplier’s location', () => {
    expect(formOfPlace(delivering).delivery).toBeNull()
    expect(formOfPlace(place({ supplierId: 's1' }), 'INR').delivery).toBeNull()
  })

  it('goes to the API in metres and minor units when on', () => {
    expect(placeInputOf(formOfPlace(delivering, 'INR'), 'INR')).toMatchObject({ ownDelivery: true, deliveryRadiusM: 5000, riderRadiusM: 7000, deliveryFeeAmount: '4900' })
    const edited = { ...formOfPlace(delivering, 'INR') }
    edited.delivery = { ...(edited.delivery as NonNullable<typeof edited.delivery>), area: '12', fee: '60' }
    expect(placeInputOf(edited, 'INR')).toMatchObject({ deliveryRadiusM: 12000, deliveryFeeAmount: '6000' })
  })

  it('sends only ownDelivery false when turned off, and nothing when it stays off, so what is saved stays', () => {
    const off = formOfPlace(delivering, 'INR')
    off.delivery = { ...(off.delivery as NonNullable<typeof off.delivery>), on: false }
    expect(placeInputOf(off, 'INR')).toMatchObject({ ownDelivery: false })
    expect(placeInputOf(off, 'INR')).not.toHaveProperty('deliveryRadiusM')
    expect(placeInputOf(formOfPlace(place(), 'INR'), 'INR')).toEqual({ name: 'Main godown', address: expect.any(Object) })
  })

  it('names the first thing that cannot be saved while on, and checks nothing while off', () => {
    const on = (patch: Partial<NonNullable<ReturnType<typeof formOfPlace>['delivery']>>) => ({ wasOn: false, pinned: true, on: true, area: '5', rider: '5', fee: '49', ...patch })
    expect(deliveryProblemOf(on({}), 'INR')).toBeNull()
    expect(deliveryProblemOf(on({ area: '0' }), 'INR')).toBe('area')
    expect(deliveryProblemOf(on({ rider: '51' }), 'INR')).toBe('rider')
    expect(deliveryProblemOf(on({ fee: '' }), 'INR')).toBe('fee')
    expect(deliveryProblemOf(on({ fee: 'free' }), 'INR')).toBe('feeInvalid')
    expect(deliveryProblemOf(on({ on: false, area: '' }), 'INR')).toBeNull()
    expect(deliveryProblemOf(null, 'INR')).toBeNull()
  })
})
