import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from '@tanstack/react-router'
import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { CustomerFilter } from '../../api/customers'
import { createCustomersServer, sampleCustomers } from '../../api/customersSample'
import { messages } from '../../messages'
import { textOf } from '../../testing/textOf'
import { CustomersView, type CustomersViewProps } from './CustomersView'

const words = messages.customers
const sample = createCustomersServer(sampleCustomers, () => '2026-09-30T00:00:00Z')
const noop = () => undefined

const ready = (search: string | null = null, filter: CustomerFilter = {}, size = 25) => ({ kind: 'ready' as const, page: sample.list(filter, {}, search, size) })

const render = async (props: Partial<CustomersViewProps> = {}) => {
  const result = props.result ?? ready(props.search ?? null, props.filter)
  const rootRoute = createRootRoute({
    component: () => (
      <CustomersView
        filter={{}}
        search={undefined}
        options={result.kind === 'ready' ? result.page : { partners: [], stores: [] }}
        inStore={false}
        forced={null}
        empty={words.empty}
        onFilterChange={noop}
        onSearch={noop}
        onClear={noop}
        onRetry={noop}
        pageLink={(cursor, label) => <a href={`/customers?${new URLSearchParams(cursor).toString()}`}>{label}</a>}
        {...props}
        result={result}
      />
    ),
  })
  const router = createRouter({ routeTree: rootRoute, history: createMemoryHistory({ initialEntries: ['/customers'] }) })
  await router.load()
  return renderToString(<RouterProvider router={router} />)
}

const headers = (html: string) => [...html.matchAll(/<th scope="col"[^>]*>([^<]*)<\/th>/g)].map((match) => match[1])

describe('Customers list', () => {
  it('has exactly the §5.4 columns, and drops Store and Partner on a store page', async () => {
    expect(headers(await render())).toEqual(Object.values(words.columns))
    expect(headers(await render({ inStore: true }))).toEqual(Object.values(words.columns).filter((column) => column !== words.columns.store && column !== words.columns.partner))
  })

  it('says that opening a customer is recorded, above the list', async () => {
    const html = await render()
    expect(html.indexOf(words.recorded)).toBeGreaterThan(-1)
    expect(html.indexOf(words.recorded)).toBeLessThan(html.indexOf('<table'))
  })

  it('shows the masked contacts it was given, and no full value beyond what was typed', async () => {
    const html = await render({ search: 'priya.sharma@example.com' })
    expect(textOf(html)).toContain('pr***@example.com')
    expect(html.replace('value="priya.sharma@example.com"', '')).not.toContain('priya.sharma@example.com')
    expect(html).not.toContain('98765 43210')
  })

  it('counts the accounts an exact email search found', async () => {
    expect(textOf(await render({ search: 'priya.sharma@example.com' }))).toContain('3 accounts use this email, one per store.')
  })

  it('names the countries when a number matches people in more than one', async () => {
    const text = textOf(await render({ search: '9876543210' }))
    expect(text).toContain('3 accounts match this number in India and United States.')
    expect(text).not.toContain('use this phone number')
    expect(text).toContain('United States')
  })

  it('keeps the whole count and the countries on a page holding only one of the matches', async () => {
    const page = sample.list({}, { after: 'c12' }, '9876543210', 1)
    const text = textOf(await render({ search: '9876543210', result: { kind: 'ready', page } }))
    expect(text).toContain('3 accounts match this number in India and United States.')
    expect(text).toContain('India')
  })

  it('counts a phone match in one country without naming it', async () => {
    const text = textOf(await render({ search: '+91 98765 43210' }))
    expect(text).toContain('2 accounts use this phone number, one per store.')
    expect(text).not.toContain('India')
  })

  it('pages by cursor with no total, and keeps the search term out of every link', async () => {
    const html = await render({ search: 'priya', result: { kind: 'ready', page: sample.list({}, {}, 'priya', 2) } })
    const links = [...html.matchAll(/href="([^"]*)"/g)].map((match) => match[1] ?? '')
    expect(links).toContain('/customers?after=c3')
    expect(links.some((link) => link.toLowerCase().includes('priya'))).toBe(false)
    expect(textOf(html)).not.toMatch(/\d+ customers/)
  })

  it('links each customer to their page, and their store and partner to theirs', async () => {
    const html = await render()
    for (const href of ['/customers/c1', '/stores/s1', '/partners/bz']) expect(html).toContain(`href="${href}"`)
  })

  it('writes a deleted customer as deleted, with no contact or name', async () => {
    const text = textOf(await render({ filter: { status: 'deleted' }, result: ready(null, { status: 'deleted' }) }))
    expect(text).toContain(words.deletedName)
    expect(text).toContain(words.statuses.deleted)
  })

  it('offers no action on any customer', async () => {
    const html = await render()
    expect(html.match(/<button/g) ?? []).toHaveLength(0)
    expect(textOf(html)).not.toMatch(/reset password|block|export/i)
  })

  it('says when a search matches no one, and offers to clear it', async () => {
    const text = textOf(await render({ search: 'nobody@example.com', result: ready('nobody@example.com') }))
    expect(text).toContain(words.noMatch.title)
    expect(text).toContain(words.noMatch.body)
    expect(text).toContain(words.filters.clear)
  })

  it('renders the harness states, with no denied state', async () => {
    expect(textOf(await render({ forced: 'empty' }))).toContain(words.empty.title)
    expect(textOf(await render({ forced: 'error' }))).toContain(words.error.title)
    expect(await render({ forced: 'loading' })).toContain('df-skeleton')
    expect(textOf(await render({ forced: 'nomatch' }))).toContain(words.noMatch.title)
    expect(textOf(await render({ result: { kind: 'error' } }))).toContain(words.error.title)
  })

  it('shows the store empty state on a store with no customers', async () => {
    const result = { kind: 'ready' as const, page: sample.list({ store: 's14' }, {}, null, 25) }
    expect(textOf(await render({ inStore: true, empty: words.storeEmpty, result }))).toContain(words.storeEmpty.body)
  })
})
