import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadHandPicked, loadSupplierChoices } from './products'

// The Products list's pickers read every row, never the first fifty alone (#388).

const serve = (field: string, pages: Record<string, { nodes: unknown[]; next: string | null }>) => {
  const seen: (string | null)[] = []
  vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
    const after = (JSON.parse(String(init.body)) as { variables: { after: string | null } }).variables.after
    seen.push(after)
    const page = pages[after ?? 'first']
    return new Response(JSON.stringify({ data: { [field]: { nodes: page?.nodes ?? [], pageInfo: { hasNextPage: page?.next != null, endCursor: page?.next ?? null } } } }))
  })
  return seen
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('the pickers', () => {
  it('finds hand-picked collections past the first page, however many automatic ones come first', async () => {
    const automatic = Array.from({ length: 50 }, (_, i) => ({ id: `a${i}`, name: `Auto ${i}`, kind: 'automatic' }))
    const seen = serve('collections', { first: { nodes: automatic, next: 'c1' }, c1: { nodes: [{ id: 'm1', name: 'Diwali edit', kind: 'manual' }], next: null } })
    expect(await loadHandPicked()).toEqual([{ id: 'm1', name: 'Diwali edit' }])
    expect(seen).toEqual([null, 'c1'])
  })

  it('lists every supplier for the filter, page by page', async () => {
    const seen = serve('suppliers', { first: { nodes: [{ id: 'v1', name: 'Northwind' }], next: 'c1' }, c1: { nodes: [{ id: 'v2', name: 'Sanganer' }], next: null } })
    expect((await loadSupplierChoices()).map((s) => s.id)).toEqual(['v1', 'v2'])
    expect(seen).toEqual([null, 'c1'])
  })
})
