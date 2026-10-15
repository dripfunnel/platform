import type { Place } from '../../../api/settingsWarehouse'
import { addressLine, blankPlace, formOfPlace, placeInputOf, splitPlaces } from './placeDraft'

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
