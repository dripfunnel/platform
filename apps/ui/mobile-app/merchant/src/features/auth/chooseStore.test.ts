import type { StoreChoice } from '../../api/auth'
import { decide } from './chooseStore'

const choice = (id: string, name: string, role = 'owner', seller: StoreChoice['seller'] = null): StoreChoice => ({ membershipId: `m-${id}`, role, tier: null, store: { id, name }, seller })

describe('what happens after a person signs in, by how many stores they belong to', () => {
  it('refuses a person who belongs to no store, rather than showing an empty app', () => {
    expect(decide([], null)).toEqual({ kind: 'none' })
  })

  it('opens the only store directly', () => {
    const decision = decide([choice('a', 'Juniper & Co.')], null)
    expect(decision).toMatchObject({ kind: 'open', entry: { acting: { storeId: 'a', supplierId: null, storeName: 'Juniper & Co.' } } })
  })

  it('shows the chooser for several stores, with the last used one first and marked', () => {
    const decision = decide([choice('a', 'Aurelia Home', 'manager'), choice('b', 'Juniper & Co.'), choice('c', 'Kala Weaves', 'supplier-member', { id: 's', name: 'Kala' })], { storeId: 'b', supplierId: null, storeName: 'Juniper & Co.' })

    expect(decision.kind).toBe('choose')
    if (decision.kind !== 'choose') return
    expect(decision.entries.map((e) => [e.acting.storeId, e.last])).toEqual([
      ['b', true],
      ['a', false],
      ['c', false],
    ])
    expect(decision.removed).toBeNull()
  })

  it('offers each supplier a person works for in a store as its own choice', () => {
    const decision = decide([choice('a', 'Store', 'supplier-member', { id: 's1', name: 'Kala' }), choice('a', 'Store', 'supplier-member', { id: 's2', name: 'Lume' })], null)
    expect(decision.kind).toBe('choose')
    if (decision.kind !== 'choose') return
    expect(decision.entries.map((e) => e.acting.supplierId)).toEqual(['s1', 's2'])
  })

  it('says the last store was removed when it is no longer among the stores held', () => {
    const decision = decide([choice('a', 'Aurelia Home'), choice('b', 'Kala Weaves')], { storeId: 'gone', supplierId: null, storeName: 'Juniper & Co.' })
    expect(decision).toMatchObject({ kind: 'choose', removed: 'Juniper & Co.' })
  })
})
