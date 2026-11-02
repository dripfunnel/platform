// @vitest-environment happy-dom
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { later, Provided, shopAnswering, type Asked } from '../../test/shop'
import { navigate } from '../platform/browser/router'
import { useCollection } from '../collections/collections'
import { useSearch } from '../search/search'
import { listingState, pageSize } from './listing'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})
beforeEach(() => history.replaceState(null, '', '/'))

const product = (n: number) => ({ id: `p${n}`, name: `Shirt ${n}`, slug: `shirt-${n}`, productType: 'physical', inStock: n !== 2, price: { amount: `${1000 * n}`, currency: 'USD' }, compareAt: null, maxPrice: { amount: `${1000 * n + (n === 1 ? 500 : 0)}`, currency: 'USD' }, photo: null, badges: n === 1 ? [{ label: 'New', tone: 'info' }] : [] })
const facets = [{ id: 'f1', name: 'Fabric', values: [{ id: 'linen', name: 'Linen', count: 3 }, { id: 'cotton', name: 'Cotton', count: 2 }] }]
const page = (nodes: number[], next: string | null) => ({ data: { products: { nodes: nodes.map(product), pageInfo: { endCursor: next ?? 'end', hasNextPage: next !== null, hasPreviousPage: false, startCursor: 'start' }, facets } } })

const Collection = () => {
  const c = useCollection()
  return (
    <div>
      <h1>{c.collection?.name ?? c.found}</h1>
      <p data-testid="status">{c.status}</p>
      <ul>
        {c.items.map((p) => (
          <li key={p.id}>
            {p.name} {p.from ? 'from' : ''} {p.stock.inStock ? 'in' : 'out'} {p.badges.map((b) => b.label).join()}
          </li>
        ))}
      </ul>
      <p data-testid="chips">{c.selected.map((s) => s.name).join()}</p>
      <p data-testid="facets">{c.facets.flatMap((f) => f.values.map((v) => `${v.name}:${v.selected ? 'on' : 'off'}`)).join()}</p>
      <button type="button" onClick={() => c.toggle('linen')}>linen</button>
      <button type="button" onClick={() => c.setSort('price-low')}>cheap</button>
      <button type="button" onClick={c.fetchMore} disabled={!c.hasMore}>
        more
      </button>
      <p data-testid="next">{c.nextHref}</p>
      <p data-testid="canonical">{c.canonical}</p>
    </div>
  )
}

const collectionAnswer = (listing: (a: Asked) => unknown) => (a: Asked) =>
  a.query.startsWith('query Collection(') ? { data: { collection: a.variables['slug'] === 'linen' ? { id: 'c1', name: 'Linen', slug: 'linen', description: 'All linen', seoTitle: null, seoDescription: null, image: null } : null } } : listing(a)

describe('useCollection', () => {
  it('reads the collection from the address and its filters, sort and page from the query', async () => {
    history.replaceState(null, '', '/collections/linen/?filter=cotton&sort=price-high&after=c9&utm=x')
    const asked = shopAnswering(collectionAnswer(() => page([1, 2], 'c2')))
    render(<Provided><Collection /></Provided>)
    await screen.findByText('Linen')
    await screen.findByText(/Shirt 1/)
    const listing = asked.find((a) => a.query.startsWith('query Listing'))
    expect(listing?.variables).toEqual({ collection: 'linen', search: null, filters: ['cotton'], sort: 'PRICE_HIGH', first: pageSize, after: 'c9', before: null })
    expect(screen.getByText(/Shirt 1/).textContent).toContain('from in New')
    expect(screen.getByText(/Shirt 2/).textContent).toContain('out')
    expect(screen.getByTestId('chips').textContent).toBe('Cotton')
    expect(screen.getByTestId('canonical').textContent).toBe('/collections/linen/?after=c9')
    expect(document.title).toBe('Linen')
  })

  it('puts a filter and the sort in the address, back at the first page, and loads the list again', async () => {
    history.replaceState(null, '', '/collections/linen/?after=c9')
    const asked = shopAnswering(collectionAnswer(() => page([1], 'c2')))
    render(<Provided><Collection /></Provided>)
    await screen.findByText(/Shirt 1/)
    act(() => screen.getByText('linen').click())
    expect(location.search).toBe('?filter=linen')
    await waitFor(() => expect(screen.getByTestId('facets').textContent).toBe('Linen:on,Cotton:off'))
    act(() => screen.getByText('cheap').click())
    expect(location.search).toBe('?filter=linen&sort=price-low')
    await waitFor(() => expect(asked.filter((a) => a.query.startsWith('query Listing')).at(-1)?.variables).toMatchObject({ filters: ['linen'], sort: 'PRICE_LOW', after: null }))
    act(() => history.back())
    await waitFor(() => expect(location.search).toBe('?filter=linen'))
  })

  it('keeps the filters while the next filter loads', async () => {
    history.replaceState(null, '', '/collections/linen/')
    const slow = later<unknown>()
    shopAnswering(collectionAnswer((a) => (a.variables['filters'] === null ? page([1], null) : slow.promise)))
    render(<Provided><Collection /></Provided>)
    await screen.findByText(/Shirt 1/)
    act(() => screen.getByText('linen').click())
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('loading'))
    expect(screen.getByTestId('facets').textContent).toBe('Linen:on,Cotton:off')
    await act(async () => slow.settle(page([4], null)))
    await screen.findByText(/Shirt 4/)
  })

  it('shows no filters of the last collection while another loads', async () => {
    history.replaceState(null, '', '/collections/linen/')
    const slow = later<unknown>()
    shopAnswering(collectionAnswer((a) => (a.variables['collection'] === 'linen' ? page([1], null) : slow.promise)))
    render(<Provided><Collection /></Provided>)
    await screen.findByText(/Shirt 1/)
    // In place: another page loads whole (location.assign), which tells a listing nothing (#1152).
    act(() => navigate('/collections/cotton/', { inPlace: true }))
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('loading'))
    expect(screen.getByTestId('facets').textContent).toBe('')
  })

  it('appends the next page with fetchMore, and stops when there is none', async () => {
    history.replaceState(null, '', '/collections/linen/')
    const asked = shopAnswering(collectionAnswer((a) => (a.variables['after'] === 'c2' ? page([3], null) : page([1, 2], 'c2'))))
    render(<Provided><Collection /></Provided>)
    await screen.findByText(/Shirt 2/)
    expect(screen.getByTestId('next').textContent).toBe('/collections/linen/?after=c2')
    act(() => screen.getByText('more').click())
    await screen.findByText(/Shirt 3/)
    expect(screen.getAllByRole('listitem')).toHaveLength(3)
    expect(screen.getByText('more').hasAttribute('disabled')).toBe(true)
    expect(location.search).toBe('')
    expect(asked.filter((a) => a.query.startsWith('query Listing'))).toHaveLength(2)
  })

  it('drops a late answer to an earlier filter', async () => {
    history.replaceState(null, '', '/collections/linen/')
    const slow = later<unknown>()
    shopAnswering(collectionAnswer((a) => (a.variables['filters'] === null ? slow.promise : page([4], null))))
    render(<Provided><Collection /></Provided>)
    await screen.findByText('Linen')
    act(() => screen.getByText('linen').click())
    await screen.findByText(/Shirt 4/)
    await act(async () => slow.settle(page([1], null)))
    expect(screen.queryByText(/Shirt 1/)).toBeNull()
  })

  it('drops a fetchMore begun before the filter changed', async () => {
    history.replaceState(null, '', '/collections/linen/')
    const slowMore = later<unknown>()
    shopAnswering(collectionAnswer((a) => (a.variables['after'] === 'c2' ? slowMore.promise : a.variables['filters'] === null ? page([1, 2], 'c2') : page([4], null))))
    render(<Provided><Collection /></Provided>)
    await screen.findByText(/Shirt 2/)
    act(() => screen.getByText('more').click())
    act(() => screen.getByText('linen').click())
    await screen.findByText(/Shirt 4/)
    await act(async () => slowMore.settle(page([3], null)))
    expect(screen.queryByText(/Shirt 3/)).toBeNull()
    expect(screen.getAllByRole('listitem')).toHaveLength(1)
  })

  it('names a collection the store has not got as missing, and keeps it out of search engines', async () => {
    history.replaceState(null, '', '/collections/gone/')
    shopAnswering(collectionAnswer(() => page([], null)))
    render(<Provided mode="live"><Collection /></Provided>)
    await screen.findByText('missing')
    expect(document.head.querySelector('meta[name="robots"]')?.getAttribute('content')).toBe('noindex, nofollow')
  })
})

const Search = () => {
  const s = useSearch()
  return (
    <div>
      <p data-testid="status">{s.status}</p>
      <p data-testid="query">{s.query}</p>
      {s.items.map((p) => (
        <p key={p.id}>{p.name}</p>
      ))}
      <button type="button" onClick={() => s.setQuery('  linen  ')}>search</button>
    </div>
  )
}

describe('useSearch', () => {
  it('asks nothing without words, then searches the words the address holds', async () => {
    history.replaceState(null, '', '/search/?filter=cotton')
    const asked = shopAnswering(() => page([1], null))
    render(<Provided><Search /></Provided>)
    expect(screen.getByTestId('status').textContent).toBe('idle')
    act(() => screen.getByText('search').click())
    expect(location.search).toBe('?q=linen')
    await screen.findByText('Shirt 1')
    expect(asked[0]?.variables).toMatchObject({ search: 'linen', filters: null, collection: null })
    expect(document.head.querySelector('meta[name="robots"]')?.getAttribute('content')).toBe('noindex, nofollow')
  })
})

describe('listingState', () => {
  it('keeps only well-formed filters, a known sort and one cursor', () => {
    const state = listingState(new URLSearchParams('filter=b&filter=a&filter=a&filter=<x>&sort=cheapest&after=c1&before=c0'))
    expect(state).toEqual({ filters: ['a', 'b'], sort: 'featured', after: 'c1', before: null })
  })
})

describe('every product', () => {
  it('lists every product at /collections/all/ unless the store has a collection there', async () => {
    history.replaceState(null, '', '/collections/all/')
    const asked = shopAnswering(collectionAnswer(() => page([1], null)))
    const All = () => {
      const c = useCollection()
      return <p>{`${c.found}|${c.all}|${c.items.length}`}</p>
    }
    render(<Provided><All /></Provided>)
    await screen.findByText('found|true|1')
    expect(asked.find((a) => a.query.startsWith('query Listing'))?.variables).toMatchObject({ collection: null, sort: null })
  })
})
