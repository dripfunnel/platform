import { afterEach, describe, expect, it, vi } from 'vitest'
import { stubApi } from '../testing/apiStub'
import { loadCustomer, loadCustomers } from './customers'

afterEach(() => void vi.unstubAllGlobals())

const account = { id: 'c1', name: 'Ana', email: 'a***@example.com', phone: null, phoneRegion: null, store: { id: 's1', name: 'Nimbus' }, partner: { id: 'p1', name: 'Northstar' }, signsInWith: 'email', status: 'active', orders: 2, createdAt: '2026-09-01T00:00:00.000Z', lastSignInAt: null }
const pageInfo = { startCursor: null, endCursor: null, hasPreviousPage: false, hasNextPage: false }

describe('loadCustomers', () => {
  it('sends only the declared filter keys, the search in the body, and reads the page with its match', async () => {
    const stub = stubApi({ data: { customers: { items: [account], pageInfo, match: { kind: 'email', accounts: 2, regions: [] }, partners: [], stores: [] } } })
    const page = await loadCustomers({ status: 'active', ...({ state: 'empty' } as object) }, {}, 'ana@example.com')
    expect(stub.calls[0]?.variables).toEqual({ filter: { status: 'active' }, search: 'ana@example.com' })
    expect(page.match).toEqual({ kind: 'email', accounts: 2, regions: [] })
    expect(page.items[0]?.email).toBe('a***@example.com')
  })

  it('refuses a status it was never promised', async () => {
    stubApi({ data: { customers: { items: [{ ...account, status: 'banned' }], pageInfo, match: null, partners: [], stores: [] } } })
    await expect(loadCustomers({}, {}, null)).rejects.toMatchObject({ code: 'BAD_RESPONSE' })
  })
})

describe('loadCustomer', () => {
  it('reads the detail with whether the contacts were masked, and null for none', async () => {
    stubApi({ data: { customer: { ...account, emailVerified: true, phoneVerified: false, contactsMasked: true, deletedAt: null, storeSuspension: null } } })
    expect(await loadCustomer('c1')).toMatchObject({ id: 'c1', contactsMasked: true })
    stubApi({ data: { customer: null } })
    expect(await loadCustomer('c2')).toBeNull()
  })
})
