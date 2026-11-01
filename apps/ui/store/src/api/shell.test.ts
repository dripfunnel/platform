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

describe('badgesOf', () => {
  it('reads the orders to ship and the products to approve, and draws no badge for a count left out or refused', async () => {
    const { badgesOf } = await import('./shell')
    expect(badgesOf({ products: 2, toShip: 5 })).toEqual({ ordersToShip: 5, productsToApprove: 2 })
    expect(badgesOf({ products: null, toShip: null })).toEqual({ ordersToShip: 0, productsToApprove: 0 })
    expect(badgesOf(null)).toEqual({ ordersToShip: 0, productsToApprove: 0 })
  })
})

describe('readShell', () => {
  it('asks for me, the first page of stores, the store’s state and the badges in one request, and reports refused fields beside the rest', async () => {
    const { vi } = await import('vitest')
    const sent: string[] = []
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      sent.push((JSON.parse(String(init.body)) as { query: string }).query)
      const me = { id: 'u1', name: 'Farhan', email: 'f@example.com', acting: null }
      return new Response(JSON.stringify({ data: { me, myStores: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } }, storeState: null, navBadges: null }, errors: [{ message: 'no store', path: ['storeState'], extensions: { code: 'STORE_REQUIRED' } }] }))
    })
    const { readShell } = await import('./shell')
    const { data, errors } = await readShell()
    expect(sent).toHaveLength(1)
    for (const field of ['me {', 'myStores(first: 50)', 'storeState {', 'navBadges {']) expect(sent[0]).toContain(field)
    expect(data.me?.acting).toBeNull()
    expect(errors).toEqual([{ path: ['storeState'], error: expect.objectContaining({ code: 'STORE_REQUIRED' }) }])
    vi.unstubAllGlobals()
  })
})

describe('loadMyStores and signOut', () => {
  const choice = (id: string) => ({ membershipId: `m-${id}`, store: { id, name: id }, role: 'owner', tier: null, seller: null })

  it('pages through every store, past the API’s fifty', async () => {
    const { vi } = await import('vitest')
    const seen: (string | null)[] = []
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      const after = (JSON.parse(String(init.body)) as { variables: { after: string | null } }).variables.after
      seen.push(after)
      const page = after === null ? { nodes: [choice('a'), choice('b')], pageInfo: { hasNextPage: true, endCursor: 'c1' } } : { nodes: [choice('c')], pageInfo: { hasNextPage: false, endCursor: 'c2' } }
      return new Response(JSON.stringify({ data: { myStores: page } }))
    })
    const { loadMyStores } = await import('./shell')
    expect((await loadMyStores()).map((c) => c.store.id)).toEqual(['a', 'b', 'c'])
    expect(seen).toEqual([null, 'c1'])
    vi.unstubAllGlobals()
  })

  it('fails rather than returning part of the list when a page promises more without a new cursor', async () => {
    const { vi } = await import('vitest')
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ data: { myStores: { nodes: [choice('a')], pageInfo: { hasNextPage: true, endCursor: 'same' } } } })))
    const { loadMyStores } = await import('./shell')
    await expect(loadMyStores()).rejects.toThrow()
    vi.unstubAllGlobals()
  })

  it('remembers a store only once the server confirms it, so a refused switch keeps the old one', async () => {
    const { vi } = await import('vitest')
    const items = new Map<string, string>([['df-store-acting', '{"storeId":"s1","supplierId":null}']])
    vi.stubGlobal('localStorage', { getItem: (k: string) => items.get(k) ?? null, setItem: (k: string, v: string) => void items.set(k, v), removeItem: (k: string) => void items.delete(k) })
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ data: null, errors: [{ message: 'not yours', extensions: { code: 'FORBIDDEN' } }] })))
    const { openStore } = await import('./shell')
    await expect(openStore({ store: { id: 's2', name: 's2' }, seller: null })).rejects.toThrow()
    expect(items.get('df-store-acting')).toBe('{"storeId":"s1","supplierId":null}')
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ data: { switchStore: choice('s2') } })))
    await openStore({ store: { id: 's2', name: 's2' }, seller: null })
    expect(items.get('df-store-acting')).toBe('{"storeId":"s2","supplierId":null}')
    vi.unstubAllGlobals()
  })

  it('forgets the acting store, then posts a form the browser follows to the server’s answer', async () => {
    const { vi } = await import('vitest')
    const items = new Map<string, string>([['df-store-acting', '{"storeId":"s1","supplierId":null}']])
    vi.stubGlobal('localStorage', { getItem: (k: string) => items.get(k) ?? null, setItem: (k: string, v: string) => void items.set(k, v), removeItem: (k: string) => void items.delete(k) })
    const form = { method: '', action: '', submit: vi.fn(() => expect(items.has('df-store-acting')).toBe(false)) }
    vi.stubGlobal('document', { createElement: () => form, body: { append: vi.fn() } })
    const { signOut } = await import('./shell')
    signOut()
    expect(form).toMatchObject({ method: 'post', action: '/api/auth/sign-out' })
    expect(form.submit).toHaveBeenCalledOnce()
    vi.unstubAllGlobals()
  })
})
