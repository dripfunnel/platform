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

  it('forgets the acting store before it signs out, and resolves only once the server answered', async () => {
    const { vi } = await import('vitest')
    const items = new Map<string, string>([['df-store-acting', '{"storeId":"s1","supplierId":null}']])
    vi.stubGlobal('localStorage', { getItem: (k: string) => items.get(k) ?? null, setItem: (k: string, v: string) => void items.set(k, v), removeItem: (k: string) => void items.delete(k) })
    let answered = false
    vi.stubGlobal('fetch', async () => {
      expect(items.has('df-store-acting')).toBe(false)
      await new Promise((resolve) => setTimeout(resolve, 5))
      answered = true
      return new Response(null, { status: 302 })
    })
    const { signOut } = await import('./shell')
    await signOut()
    expect(answered).toBe(true)
    vi.unstubAllGlobals()
  })
})
