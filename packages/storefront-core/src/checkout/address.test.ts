import { describe, expect, it } from 'vitest'
import { fillFromPlace, type AddressDraft, type Place } from './address'

const empty: AddressDraft = { name: 'Asha Rao', line1: '', line2: '', city: '', region: '', postalCode: '', country: 'IN', phone: '' }
const camp: Place = { line1: 'Fashion Street, Camp', city: 'Pune', region: 'Maharashtra', postalCode: '411001', country: 'IN' }
const vimanNagar: Place = { line1: 'Mhada Colony, Viman Nagar', city: 'Pune', region: 'Maharashtra', postalCode: '411014', country: 'IN' }

describe('fillFromPlace', () => {
  it('fills every empty field from the address at the pin, and remembers what it wrote', () => {
    expect(fillFromPlace(empty, camp, ['IN'])).toEqual({
      draft: { ...empty, line1: 'Fashion Street, Camp', city: 'Pune', region: 'Maharashtra', postalCode: '411001' },
      filled: { line1: 'Fashion Street, Camp', city: 'Pune', region: 'Maharashtra', postalCode: '411001' },
    })
  })

  it('replaces what the map wrote when the pin moves, and clears a part the new point has none of', () => {
    const first = fillFromPlace(empty, camp, ['IN'])
    const moved = fillFromPlace(first.draft, { ...vimanNagar, region: null }, ['IN'], first.filled)
    expect(moved.draft).toEqual({ ...empty, line1: 'Mhada Colony, Viman Nagar', city: 'Pune', region: '', postalCode: '411014' })
  })

  it('never replaces what the shopper typed, including a field the map filled and the shopper then changed', () => {
    const first = fillFromPlace({ ...empty, city: 'Poona' }, camp, ['IN'])
    expect(first.draft.city).toBe('Poona')
    const edited = { ...first.draft, line1: 'Flat 4, 12 MG Road' }
    const moved = fillFromPlace(edited, vimanNagar, ['IN'], first.filled)
    expect(moved.draft).toMatchObject({ line1: 'Flat 4, 12 MG Road', city: 'Poona', postalCode: '411014' })
  })

  it('takes the country only when none is chosen and the store sells there', () => {
    expect(fillFromPlace({ ...empty, country: '' }, camp, ['IN']).draft.country).toBe('IN')
    expect(fillFromPlace({ ...empty, country: '' }, camp, ['US']).draft).toEqual({ ...empty, country: '' })
  })

  it('fills nothing from a pin in another country than the one chosen, or from no answer, and forgets nothing', () => {
    const filled = { city: 'Pune' }
    expect(fillFromPlace({ ...empty, country: 'US' }, camp, ['IN', 'US'], filled)).toEqual({ draft: { ...empty, country: 'US' }, filled })
    expect(fillFromPlace(empty, null, ['IN'], filled)).toEqual({ draft: empty, filled })
  })
})
