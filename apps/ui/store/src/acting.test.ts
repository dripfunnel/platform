import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.resetModules()
})

const storage = () => {
  const items = new Map<string, string>()
  vi.stubGlobal('localStorage', { getItem: (k: string) => items.get(k) ?? null, setItem: (k: string, v: string) => void items.set(k, v), removeItem: (k: string) => void items.delete(k) })
  return items
}

describe('the acting store', () => {
  it('names the store, and the supplier when there is one, on every request', async () => {
    storage()
    const { actingHeaders, rememberActing } = await import('./acting')
    expect(actingHeaders()).toEqual({})
    rememberActing({ storeId: 's1', supplierId: null })
    expect(actingHeaders()).toEqual({ 'x-store': 's1' })
    rememberActing({ storeId: 's1', supplierId: 'v1' })
    expect(actingHeaders()).toEqual({ 'x-store': 's1', 'x-supplier': 'v1' })
    rememberActing(null)
    expect(actingHeaders()).toEqual({})
  })

  it('ignores a remembered value that isn’t one', async () => {
    storage().set('df-store-acting', '{"nope":1}')
    const { actingStore } = await import('./acting')
    expect(actingStore()).toBeNull()
  })
})
