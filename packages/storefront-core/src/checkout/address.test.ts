import { describe, expect, it } from 'vitest'
import { addressFields, fillFromPlace, type AddressDraft, type Place } from './address'

const empty: AddressDraft = { name: 'Asha Rao', line1: '', line2: '', city: '', region: '', postalCode: '', country: 'IN', phone: '+91 98765 43210' }
const camp: Place = { line1: 'Fashion Street, Camp', city: 'Pune', region: 'Maharashtra', postalCode: '411001', country: 'IN' }
const vimanNagar: Place = { line1: 'Mhada Colony, Viman Nagar', city: 'Pune', region: 'Maharashtra', postalCode: '411014', country: 'IN' }

describe('fillFromPlace', () => {
  it('fills line 1, city, region and postal code from the address at the pin', () => {
    expect(fillFromPlace(empty, camp, ['IN'])).toEqual({ ...empty, line1: 'Fashion Street, Camp', city: 'Pune', region: 'Maharashtra', postalCode: '411001' })
  })

  it('replaces what was typed, and clears a part the new point has none of (#1615)', () => {
    const typed = { ...empty, line1: 'Flat 4, 12 MG Road', city: 'Poona', region: 'MH', postalCode: '411001' }
    expect(fillFromPlace(typed, { ...vimanNagar, region: null }, ['IN'])).toEqual({ ...typed, line1: 'Mhada Colony, Viman Nagar', city: 'Pune', region: '', postalCode: '411014' })
  })

  it('never touches the name, the phone or address line 2', () => {
    const typed = { ...empty, line2: 'Near the temple' }
    expect(fillFromPlace(typed, camp, ['IN'])).toMatchObject({ name: 'Asha Rao', phone: '+91 98765 43210', line2: 'Near the temple' })
  })

  it('sets the country of the pin when the shop sells there, even when another was chosen', () => {
    expect(fillFromPlace({ ...empty, country: '' }, camp, ['IN']).country).toBe('IN')
    expect(fillFromPlace({ ...empty, country: 'US' }, camp, ['IN', 'US']).country).toBe('IN')
  })

  it('fills nothing from a country the shop does not sell to, or from no answer', () => {
    expect(fillFromPlace({ ...empty, country: '' }, camp, ['US'])).toEqual({ ...empty, country: '' })
    expect(fillFromPlace({ ...empty, country: 'US' }, camp, ['US'])).toEqual({ ...empty, country: 'US' })
    expect(fillFromPlace(empty, null, ['IN'])).toEqual(empty)
  })
})

describe('the delivery phone', () => {
  it('is not optional in any country', () => {
    for (const country of ['IN', 'US', 'GB', 'FR']) expect(addressFields(country).find((f) => f.field === 'phone')?.optional).toBe(false)
  })
})
