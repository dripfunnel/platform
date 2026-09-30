import { describe, expect, it } from 'vitest'
import { staffRoles } from '../features/shell/staffRoles'
import { createCustomersServer, sampleCustomers } from './customersSample'

const server = createCustomersServer(sampleCustomers, () => '2026-09-30T00:00:00Z')
const ids = (page: { items: readonly { id: string }[] }) => page.items.map((customer) => customer.id)
const list = (search: string | null, filter = {}) => server.list(filter, {}, search, 25)

describe('customers sample server', () => {
  it('lists newest first and pages by cursor both ways', () => {
    const first = server.list({}, {}, null, 5)
    expect(ids(first)).toEqual(['c7', 'c11', 'c2', 'c10', 'c4'])
    expect(first.pageInfo).toMatchObject({ hasPreviousPage: false, hasNextPage: true })
    const second = server.list({}, { after: first.pageInfo.endCursor ?? '' }, null, 5)
    expect(second.pageInfo.hasPreviousPage).toBe(true)
    expect(ids(server.list({}, { before: second.pageInfo.startCursor ?? '' }, null, 5))).toEqual(ids(first))
  })

  it('never puts a full email or phone in the list, whoever asks', () => {
    const text = JSON.stringify(list(null))
    for (const seed of sampleCustomers) {
      if (seed.email) expect(text).not.toContain(seed.email)
      if (seed.phone) expect(text).not.toContain(seed.phone.display)
    }
    expect(list(null).items.find((row) => row.id === 'c1')).toMatchObject({ email: 'pr***@example.com', phone: '+91 ***** 43210' })
  })

  it('matches an email only exactly, and ignores case', () => {
    expect(ids(list('PRIYA.SHARMA@example.com'))).toEqual(['c2', 'c3', 'c1'])
    expect(ids(list('priya.sharma@example'))).toEqual([])
  })

  it('matches a phone on its digits, with or without the country code, across countries', () => {
    expect(ids(list('+91 98765 43210'))).toEqual(['c2', 'c1'])
    expect(ids(list('(987) 654-3210'))).toEqual(['c2', 'c12', 'c1'])
    expect(new Set(list('9876543210').items.map((row) => row.phoneRegion))).toEqual(new Set(['IN', 'US']))
  })

  it('sums up an exact search over every match, not only the page returned', () => {
    const first = server.list({}, {}, '9876543210', 1)
    const last = server.list({}, { after: 'c12' }, '9876543210', 1)
    for (const page of [first, last]) expect(page.match).toEqual({ kind: 'phone', accounts: 3, regions: ['IN', 'US'] })
    expect(list('priya.sharma@example.com').match).toEqual({ kind: 'email', accounts: 3, regions: [] })
    expect(list('priya').match).toBeNull()
    expect(list('nobody@example.com').match).toBeNull()
  })

  it('matches part of a name, and never finds a deleted customer', () => {
    expect(ids(list('marcus'))).toEqual(['c6'])
    expect(list('deleted').items).toEqual([])
  })

  it('filters by partner, store, status, sign-in method, created and last sign-in', () => {
    expect(ids(list(null, { store: 's1' }))).toEqual(['c7', 'c11', 'c1', 'c5'])
    expect(ids(list(null, { partner: 'lt' }))).toEqual(['c8'])
    expect(ids(list(null, { status: 'unverified' }))).toEqual(['c11', 'c4'])
    expect(ids(list(null, { via: 'both' }))).toEqual(['c2', 'c12', 'c6'])
    expect(ids(list(null, { created: '7d' }))).toEqual(['c7', 'c11', 'c2'])
    expect(ids(list(null, { lastSignIn: '7d' }))).not.toContain('c3')
  })

  it('gives full contacts on the detail to Super admin and Support only', () => {
    for (const role of staffRoles) {
      const customer = server.get('c1', role)
      const full = role === 'staff-super-admin' || role === 'staff-support'
      expect(customer?.email).toBe(full ? 'priya.sharma@example.com' : 'pr***@example.com')
      expect(customer?.phone).toBe(full ? '+91 98765 43210' : '+91 ***** 43210')
      expect(customer?.contactsMasked).toBe(!full)
    }
  })

  it('keeps nothing personal for a deleted customer, and says when the store is suspended', () => {
    expect(server.get('c5', 'staff-super-admin')).toMatchObject({ name: null, email: null, phone: null, contactsMasked: false, deletedAt: '2026-08-12T00:00:00Z' })
    expect(server.get('c6', 'staff-support')?.storeSuspension).toEqual({ reason: expect.any(String) })
    expect(server.get('c1', 'staff-support')?.storeSuspension).toBeNull()
    expect(server.get('nobody', 'staff-support')).toBeNull()
  })
})
