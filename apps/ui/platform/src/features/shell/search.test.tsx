import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { StoreMatch } from '../../api/search'
import { messages } from '../../messages'
import { SearchResults } from './SearchResults'

const textOf = (html: string) => html.replace(/<[^>]+>/g, '').replace(/&#x27;/g, '’').replace(/&amp;/g, '&')
const render = async (element: ReactNode) => {
  const router = createRouter({ routeTree: createRootRoute({ component: () => element }), history: createMemoryHistory({ initialEntries: ['/dashboard'] }) })
  await router.load()
  return renderToString(<RouterProvider router={router} />)
}
const matches: readonly StoreMatch[] = [
  { id: 'st-maple', name: 'Maple & Pine', code: 'maple', status: 'active', domain: 'shop.mapleandpine.ca', ownerEmail: 'chloe@mapleandpine.ca' },
  { id: 'st-maple-2', name: 'Maple Outlet', code: 'maple-outlet', status: 'closed', domain: null, ownerEmail: null },
]
const words = messages.shell.search

describe('the header search over stores', () => {
  it('hints before typing, then lists matches with owner email, domain and status, and a way to the whole list', async () => {
    expect(textOf(await render(<SearchResults query="" matches={null} onPick={() => undefined} />))).toContain(words.hint)
    // One letter matches nothing at the API, so it is a hint, never "no store matches".
    expect(textOf(await render(<SearchResults query="m" matches={[]} onPick={() => undefined} />))).toContain(words.hint)
    const html = await render(<SearchResults query="maple" matches={matches} onPick={() => undefined} />)
    const text = textOf(html)
    expect(text).toContain('Maple & Pine')
    expect(text).toContain('chloe@mapleandpine.ca · shop.mapleandpine.ca')
    expect(text).toContain(messages.stores.statuses.active)
    // No domain and no owner: the code alone, and every status the API sends has words.
    expect(text).toContain('Maple Outletmaple-outlet')
    expect(text).toContain(messages.stores.statuses.closed)
    expect(html).toContain('href="/stores/st-maple"')
    expect(html).toContain('href="/stores?q=maple"')
  })

  it('says when nothing matches, naming what was typed, and when the API did not answer', async () => {
    const text = textOf(await render(<SearchResults query="zzz" matches={[]} onPick={() => undefined} />))
    expect(text).toContain('No store matches “zzz”')
    const failed = await render(<SearchResults query="zzz" matches="failed" onPick={() => undefined} />)
    expect(failed).toContain('role="alert"')
    expect(textOf(failed)).toContain(words.failed)
  })
})
