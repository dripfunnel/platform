import { describe, expect, it } from 'vitest'
import type { BookingPlaceRow } from '#db/scoped/labels'
import { fromAddressOf, parcelOf } from './labels'

const place: BookingPlaceRow = {
  store_name: 'Juniper',
  store_country: 'IN',
  store_address: { street: '4 Johari Bazaar', city: 'Jaipur', region: 'Rajasthan', postal: '302003' },
  contact_email: null,
  contact_phone: null,
  warehouse_seller_id: null,
  warehouse_address: { line1: '12 Ring Road', city: 'Pune', region: 'Maharashtra', postalCode: '411014', country: 'IN' },
  warehouse_latitude: 18.5679,
  warehouse_longitude: 73.9143,
  courier: null,
  label_account: null,
}

describe('where a label leaves from', () => {
  it('carries the location’s pin with its own address (#815)', () => {
    expect(fromAddressOf(place, 'w1')).toMatchObject({ line1: '12 Ring Road', city: 'Pune', pin: { latitude: 18.5679, longitude: 73.9143 } })
    expect(fromAddressOf({ ...place, warehouse_latitude: null, warehouse_longitude: null }, 'w1')?.pin).toBeNull()
  })

  it('never puts the location’s pin on Store info’s address, which it falls back to', () => {
    expect(fromAddressOf({ ...place, warehouse_address: {} }, 'w1')).toMatchObject({ line1: '4 Johari Bazaar', city: 'Jaipur', pin: null })
  })
})

// A label's declared value (#1368): a once-per-line customisation extra is part of what the goods are worth, spread over the
// line's units to the minor unit, so a whole line declares exactly what the shopper paid.
const bookingLine = (id: string, unit: string, quantity: number, lineExtras: string) => ({ id, name: id, sku: null, hs_code: null, unit_amount: unit, line_extras_amount: lineExtras, quantity, weight_grams: 500 })

describe('parcelOf', () => {
  it('declares a whole line at what the shopper paid, extras spread to the minor unit', () => {
    const parcel = parcelOf([bookingLine('engraved', '33000', 3, '1000'), bookingLine('plain', '5000', 3, '0')], [{ lineId: 'engraved', quantity: 3 }, { lineId: 'plain', quantity: 3 }])
    expect(parcel.amount).toBe(33000n * 3n + 1000n + 15000n)
    expect(parcel.items.map((i) => i.unitAmount)).toEqual([33333n, 5000n])
  })

  it('declares a partial pick with its units’ share of the extra', () => {
    const parcel = parcelOf([bookingLine('engraved', '33000', 3, '1000')], [{ lineId: 'engraved', quantity: 1 }])
    expect(parcel.amount).toBe(33334n)
  })
})
