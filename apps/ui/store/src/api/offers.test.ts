// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { forgetDrafts } from '../drafts'
import { loadCustomerNames, loadProductNames, offerIdLimit } from './offers'

// The editor's reads of the names an offer's ids stand for stay bounded: chunks of 50, at most the engine's 250.

afterEach(() => {
  vi.unstubAllGlobals()
  sessionStorage.clear()
})

describe('names for an offer’s ids', () => {
  it('asks a chunk at a time, never more ids than an offer can name', async () => {
    const sizes: number[] = []
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      const variables = (JSON.parse(String(init.body)) as { variables: Record<string, string> }).variables
      sizes.push(Object.keys(variables).length)
      return new Response(JSON.stringify({ data: Object.fromEntries(Object.entries(variables).map(([k, id]) => [k.replace('i', 'n'), { id, name: `Product ${id}` }])) }))
    })
    const names = await loadProductNames(Array.from({ length: 300 }, (_, i) => `p${i}`))
    expect(sizes).toEqual([50, 50, 50, 50, 50])
    expect(names.size).toBe(offerIdLimit)
    expect(names.get('p249')).toBe('Product p249')
    expect(await loadProductNames([])).toEqual(new Map())
  })

  it('names a customer without a name by their email, keeps a nameless product, and leaves out an id that’s gone', async () => {
    const answers: Record<string, unknown> = { 'C-1': { name: null, email: 'asha@example.com' }, 'C-2': null }
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      const variables = (JSON.parse(String(init.body)) as { variables: Record<string, string> }).variables
      return new Response(JSON.stringify({ data: Object.fromEntries(Object.entries(variables).map(([k, id]) => [k.replace('i', 'n'), id in answers ? answers[id] : { name: null }])) }))
    })
    expect(await loadCustomerNames(['C-1', 'C-2'])).toEqual(new Map([['C-1', 'asha@example.com']]))
    expect(await loadProductNames(['p1'])).toEqual(new Map([['p1', null]]))
  })
})

describe('signing out', () => {
  it('forgets every unsaved draft in the tab, and nothing else', () => {
    sessionStorage.setItem('df-draft:offer:s1:new', '{}')
    sessionStorage.setItem('df-draft:offer:s2:o1', '{}')
    sessionStorage.setItem('df-offer-codes:b1', 'x1')
    forgetDrafts()
    expect(Object.keys(sessionStorage)).toEqual(['df-offer-codes:b1'])
  })
})
