import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from '@tanstack/react-router'
import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { createStoresServer, sampleStores } from '../../api/storesSample'
import { messages } from '../../messages'
import { textOf } from '../../testing/textOf'
import { Stores, type StoresProps } from './Stores'

const words = messages.stores
const sample = createStoresServer(sampleStores, () => '2026-09-30T00:00:00Z')
const noop = () => undefined

const render = async (props: Partial<StoresProps> = {}) => {
  const rootRoute = createRootRoute({
    component: () => (
      <Stores page={sample.list({}, {}, 25)} filter={{}} forced={null} readOnly={false} onFilterChange={noop} onReload={noop} {...props} />
    ),
  })
  const router = createRouter({ routeTree: rootRoute, history: createMemoryHistory({ initialEntries: ['/stores'] }) })
  await router.load()
  return renderToString(<RouterProvider router={router} />)
}

const hrefs = (html: string) => [...html.matchAll(/href="([^"]*)"/g)].map((match) => (match[1] ?? '').replace(/&amp;/g, '&'))

describe('Stores list', () => {
  it('has the prototype columns, in order', async () => {
    const headers = [...(await render()).matchAll(/<th scope="col"[^>]*>([^<]*)<\/th>/g)].map((match) => match[1])
    expect(headers).toEqual(Object.values(words.columns))
  })

  it('has the prototype four filters plus Category, and no Setup control', async () => {
    const html = await render()
    expect(html.match(/<select/g)).toHaveLength(5)
    expect(textOf(html)).not.toContain('Any setup')
  })

  it('still narrows to a setup state from a Dashboard link, which Clear filters removes', async () => {
    const text = textOf(await render({ page: sample.list({ setup: 'stuck' }, {}, 25), filter: { setup: 'stuck' } }))
    expect(text).toContain('Fjord Outdoor')
    expect(text).not.toContain('Mehta Textiles')
    expect(text).toContain(words.filters.clear)
  })

  it('shows each store’s category, or a dash before its Owner picks, and filters by one (DATA-MODEL §7.2)', async () => {
    const base = sample.list({}, {}, 25)
    const page = { ...base, items: base.items.map((item, i) => (i === 0 ? { ...item, category: { id: 'c1', name: 'Footwear' } } : item)), categories: [{ id: 'c1', name: 'Footwear' }] }
    const html = await render({ page, filter: { category: 'c1' } })
    const text = textOf(html)
    expect(text).toContain('Footwear')
    expect(text).toContain(words.noCategory)
    expect(text).toContain(words.filters.anyCategory)
    expect(html).toMatch(/<option value="c1" selected="">Footwear<\/option>/)
  })

  it('links each store to its page and its partner to theirs', async () => {
    const links = hrefs(await render())
    expect(links).toContain('/stores/s13')
    expect(links).toContain('/partners/bz')
  })

  it('shows status, storefront and domain in the prototype words, with no Retry on the rows', async () => {
    const text = textOf(await render())
    expect(text).toContain('Past due · 9 days')
    expect(text).toContain(words.statusSub.pastdue)
    expect(text).toContain('Chargeback · by Arjun Menon · storefront shows a notice')
    expect(text).toContain('Trial · ends tomorrow')
    expect(text).toContain(words.storefronts.own)
    expect(text).toContain('Trial ends Oct 8, 2026')
    expect(text).toContain(words.customLive)
    expect(text).toContain(messages.store.domains.status.waiting)
    expect(text).not.toMatch(/[$€£₹]/)
    expect(text).not.toContain(messages.store.retrySetup)
  })

  it('pages by cursor with no total', async () => {
    const html = await render({ page: sample.list({}, {}, 5) })
    expect(hrefs(html)).toContain('/stores?after=s9')
    expect(textOf(html)).not.toMatch(/\d+ stores/)
  })

  it('says when nothing matches, and offers to clear the filters', async () => {
    const text = textOf(await render({ page: sample.list({ q: 'nothing like this' }, {}, 25), filter: { q: 'nothing like this' } }))
    expect(text).toContain(words.noMatch.title)
    expect(text).toContain(words.filters.clear)
  })

  it('renders the harness states', async () => {
    expect(textOf(await render({ forced: 'empty' }))).toContain(words.empty.title)
    expect(textOf(await render({ forced: 'error' }))).toContain(words.error.title)
    expect(textOf(await render({ readOnly: true }))).toContain(words.readOnly.title)
  })
})
