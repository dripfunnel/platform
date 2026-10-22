import { describe, expect, it } from 'vitest'
import type { BookingPlaceRow } from '#db/scoped/labels'
import { fromAddressOf } from './labels'

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
