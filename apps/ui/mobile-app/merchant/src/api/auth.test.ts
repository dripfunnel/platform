import { createApiClient } from '../graphql'
import { loadStores, switchStore } from './auth'

const choice = (id: string, name: string) => ({ membershipId: `m-${id}`, role: 'owner', tier: null, store: { id, name }, seller: null })
const pageInfo = (more: boolean, after: string | null) => ({ startCursor: null, endCursor: after, hasPreviousPage: false, hasNextPage: more })

describe('loading the stores a person belongs to', () => {
  it('reads every page, naming the person once', async () => {
    const pages = [
      { me: { email: 'owner@example.com', name: 'Priya' }, myStores: { nodes: [choice('a', 'Aurelia Home')], pageInfo: pageInfo(true, 'a') } },
      { me: { email: 'owner@example.com', name: 'Priya' }, myStores: { nodes: [choice('b', 'Juniper & Co.')], pageInfo: pageInfo(false, 'b') } },
    ]
    const asked: unknown[] = []
    const fetchImpl = ((_url: string, init: { body: string }) => {
      asked.push(JSON.parse(init.body).variables)
      return Promise.resolve({ json: () => Promise.resolve({ data: pages[asked.length - 1] }) })
    }) as unknown as typeof fetch

    const { email, stores } = await loadStores(createApiClient({ domain: 'store.example.com', fetchImpl }))

    expect(email).toBe('owner@example.com')
    expect(stores.map((s) => s.store.name)).toEqual(['Aurelia Home', 'Juniper & Co.'])
    expect(asked).toEqual([{}, { after: 'a' }])
  })

  it('refuses an answer that is not the shape written from the schema', async () => {
    const fetchImpl = (() => Promise.resolve({ json: () => Promise.resolve({ data: { me: { email: 7 } } }) })) as unknown as typeof fetch
    await expect(loadStores(createApiClient({ domain: 'store.example.com', fetchImpl }))).rejects.toMatchObject({ code: 'BAD_RESPONSE' })
  })

  it('names the store and supplier the person opens when it switches', async () => {
    const fetchImpl = jest.fn((() => Promise.resolve({ json: () => Promise.resolve({ data: { switchStore: choice('a', 'Aurelia Home') } }) })) as unknown as typeof fetch)
    await switchStore(createApiClient({ domain: 'store.example.com', fetchImpl }), { ...choice('a', 'Aurelia Home'), seller: { id: 's1', name: 'Kala' } })
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, { body: string }]
    expect(JSON.parse(init.body).variables).toEqual({ storeId: 'a', supplierId: 's1' })
  })
})
