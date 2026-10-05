import { describe, expect, it } from 'vitest'
import { seatOf, type Acting } from './shell'

const acting = (over: Partial<Acting>): Acting => ({ store: { id: 's1', name: 'Kesari Threads' }, role: 'owner', tier: null, seller: null, plan: null, permissions: [], ...over })

describe('seatOf', () => {
  it('reads the merchant side’s role and a supplier’s tier and admin', () => {
    expect(seatOf(acting({ role: 'manager' }))).toEqual({ side: 'merchant', role: 'manager' })
    expect(seatOf(acting({ role: 'supplier-admin', tier: 'vendor-stock', seller: { id: 'v1', name: 'Northwind' } }))).toEqual({ side: 'supplier', tier: 'vendor-stock', admin: true })
    expect(seatOf(acting({ role: 'supplier-member', tier: 'vendor-orders-read', seller: { id: 'v1', name: 'Northwind' } }))).toEqual({ side: 'supplier', tier: 'vendor-orders-read', admin: false })
  })

  it('gives a role or tier it doesn’t know no seat, so no menu', () => {
    expect(seatOf(acting({ role: 'chief' }))).toBeNull()
    expect(seatOf(acting({ role: 'supplier-admin', tier: 'vendor-everything', seller: { id: 'v1', name: 'Northwind' } }))).toBeNull()
  })
})
