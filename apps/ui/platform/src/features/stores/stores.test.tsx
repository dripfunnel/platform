import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { Me } from '../../api/me'
import type { StoreFilter, StorePage } from '../../api/stores'
import { messages } from '../../messages'
import type { PartnerRole } from '../shell/partnerRoles'
import { NotLive } from '../shell/NotLive'
import { Stores, type StoresProps } from './Stores'
import { storePage } from './storesTestData'

const textOf = (html: string) => html.replace(/<[^>]+>/g, '').replace(/&#x27;/g, '’').replace(/&amp;/g, '&')
const hrefs = (html: string) => [...html.matchAll(/href="([^"]*)"/g)].map((match) => (match[1] ?? '').replace(/&amp;/g, '&'))
const render = async (element: ReactNode, path = '/stores') => {
  const router = createRouter({ routeTree: createRootRoute({ component: () => element }), history: createMemoryHistory({ initialEntries: [path] }) })
  await router.load()
  return renderToString(<RouterProvider router={router} />)
}
const owner: Me = { id: 'pu-1', name: 'Maya Ortiz', email: 'maya@northstar.com', role: 'partner-owner', partner: { id: 'p-1', name: 'Northstar Commerce', product: 'Northstar Shops', host: 'store.northstar.com', state: 'live' } }
const as = (role: PartnerRole): Me => ({ ...owner, role })
// Which recorded page a filter and role read (storesTestData.ts).
const named: Record<string, string> = {
  '{}': 'all',
  '{"status":"trial"}': 'trial',
  '{"status":"pastdue"}': 'pastdue',
  '{"status":"suspended"}': 'suspended',
  '{"status":"cancelled"}': 'cancelled',
  '{"status":"active"}': 'active',
  '{"storefront":"own"}': 'own',
  '{"near":"yes"}': 'near',
  '{"q":"maple"}': 'maple',
  '{"q":"juniper"}': 'juniper',
  '{"q":"fieldnote"}': 'fieldnote',
  '{"status":"trial","created":"month"}': 'trialMonth',
  '{"q":"zzzz"}': 'nomatch',
}
const pageOf = (filter: StoreFilter, role: PartnerRole) => {
  const key = named[JSON.stringify(filter)] ?? 'all'
  return storePage(key === 'all' ? `all:${role}` : key)
}
const noop = () => undefined
const words = messages.stores

// The test router's URL carries the filter, so the chips' links are built from it as in the app.
const urlOf = (filter: StoreFilter) => {
  const query = new URLSearchParams(Object.entries(filter).filter((entry): entry is [string, string] => typeof entry[1] === 'string')).toString()
  return query ? `/stores?${query}` : '/stores'
}

const list = (filter: StoreFilter = {}, role: PartnerRole = 'partner-owner', props: Partial<StoresProps> = {}) =>
  render(
    <Stores
      me={as(role)}
      page={pageOf(filter, role)}
      filter={filter}
      forced={null}
      onFilterChange={noop}
      onReload={noop}
      loadMore={() => Promise.resolve(pageOf(filter, role))}
      exportJob={null}
      onExport={noop}
      onBillingStatus={noop}
      {...props}
    />,
    urlOf(filter),
  )

describe('the partner Stores list', () => {
  it('has the prototype columns in order, the search and the five filters, newest first', async () => {
    const html = await list()
    const headers = [...html.matchAll(/<th scope="col"[^>]*>([^<]*)<\/th>/g)].map((match) => match[1])
    expect(headers).toEqual(Object.values(words.columns))
    expect(html.match(/<select/g)).toHaveLength(5)
    expect(html).toContain('type="search"')
    expect(textOf(html)).toContain(words.newestFirst)
  })

  it('makes the five statuses unmistakable: word, icon and the API’s line under each', async () => {
    const trials = textOf(await list({ status: 'trial' }))
    expect(trials).toContain(words.statuses.trial)
    expect(trials).toContain('2 days left')
    expect(trials).toContain(words.statusSub.trialTomorrow)
    expect(trials).not.toContain(words.statusSub.trialToday)
    const pastDue = textOf(await list({ status: 'pastdue' }))
    expect(pastDue).toContain('9 days · changes blocked, still selling')
    expect(textOf(await list({ status: 'suspended' }))).toContain('Chargebacks on 3 orders ($2,840).')
    expect(textOf(await list({ status: 'cancelled' }))).toContain('Since Sep 2, 2026')
    expect(textOf(await list({ status: 'active' }))).toContain(words.statuses.active)
    expect(textOf(await list({ storefront: 'own' }))).toContain(words.storefronts.own)
    expect(textOf(await list({ near: 'yes' }))).toContain('100% of staff seats')
    const maple = textOf(await list({ q: 'maple' }))
    expect(maple).toContain(words.domainStatus.waiting)
    expect(maple).toContain('CA$8,760.00')
    expect(textOf(await list({ q: 'juniper' }))).toContain('$18,420.00')
    expect(textOf(await list({ q: 'fieldnote' }))).toContain(words.noSales)
    const pills = (await list({ status: 'trial' })).match(/class="df-pill df-pill--info"/g) ?? []
    expect(pills.length).toBeGreaterThan(0)
  })

  it('shows every applied filter as a removable chip with Clear all, and "Show 25 more" with no total', async () => {
    const html = await list({ status: 'trial', created: 'month' })
    const text = textOf(html)
    expect(text).toContain(`${words.filters.status}: ${words.statuses.trial}`)
    expect(text).toContain(`${words.filters.created}: ${words.filters.month}`)
    expect(text).toContain(words.filters.clearAll)
    const links = hrefs(html)
    expect(links).toContain('/stores?created=month')
    expect(links).toContain('/stores?status=trial')
    expect(links).toContain('/stores')
    const first = await list()
    expect(textOf(first)).toContain('Show 25 more')
    expect(textOf(first)).not.toMatch(/\d+ of \d+ stores/)
    expect(hrefs(first).some((href) => /[?&]page=/.test(href))).toBe(false)
  })

  it('links a store to its page and never to an order, customer or product', async () => {
    const html = await list()
    const links = hrefs(html)
    expect(links).toContain('/stores/st-fieldnote')
    expect(links.some((href) => /orders|customers|products/.test(href))).toBe(false)
    const headers = [...html.matchAll(/<th scope="col"[^>]*>([^<]*)<\/th>/g)].map((match) => match[1])
    expect(headers).not.toContain('Orders')
  })

  it('offers Create store to Owners and Admins, and disables it with the reason for the others', async () => {
    expect(hrefs(await list({}, 'partner-admin'))).toContain('/stores/new')
    for (const role of ['partner-support', 'partner-finance', 'partner-read-only'] as const) {
      const html = await list({}, role)
      expect(hrefs(html)).not.toContain('/stores/new')
      expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Create store<\/button>/)
      expect(textOf(html)).toContain(words.refused.OWNERS_AND_ADMINS_ONLY)
    }
    expect(textOf(await list({}, 'partner-read-only'))).toContain(messages.states.readonly.title)
  })

  it('shows the empty, no-match and forced states in this console’s words', async () => {
    const emptyPage: StorePage = { items: [], pageInfo: { startCursor: null, endCursor: null, hasPreviousPage: false, hasNextPage: false }, plans: [], billingMode: 'dripfunnel', actions: { create: { allowed: true }, export: { allowed: true } } }
    const empty = await list({}, 'partner-owner', { page: emptyPage })
    expect(textOf(empty)).toContain(words.empty.title)
    expect(textOf(empty)).toContain('store.northstar.com/signup')
    expect(textOf(empty)).toContain(words.empty.action)
    const none = await list({ q: 'zzzz' })
    expect(textOf(none)).toContain(words.noMatch.title)
    expect(textOf(none)).toContain(words.filters.clear)
    expect(await list({}, 'partner-owner', { forced: 'loading' })).toContain('df-skeleton')
    expect(textOf(await list({}, 'partner-owner', { forced: 'error' }))).toContain(words.error.title)
    expect(textOf(await list({}, 'partner-owner', { forced: 'empty' }))).toContain(words.empty.title)
  })

  it('offers Export accounts (CSV) to every role, says what it never includes, and shows the job’s state', async () => {
    const html = await list({}, 'partner-read-only')
    expect(html).toMatch(/<button type="button" class="df-button"(?! disabled)[^>]*>Export accounts \(CSV\)<\/button>/)
    expect(textOf(html)).toContain(words.export.note)
    const preparing = await list({}, 'partner-owner', { exportJob: { id: 'sx1', state: 'preparing', entries: null, url: null, expiresAt: null } })
    expect(preparing).toMatch(/<button[^>]*disabled=""[^>]*>Export accounts \(CSV\)<\/button>/)
    expect(textOf(preparing)).toContain(words.export.preparing)
    const ready = await list({}, 'partner-owner', { exportJob: { id: 'sx1', state: 'ready', entries: 86, url: 'blob:stores', expiresAt: '2026-09-29T18:42:00Z' } })
    expect(textOf(ready)).toContain('Your export of 86 store accounts is ready.')
    expect(ready).toContain('href="blob:stores"')
  })

  it('adds the Billing status column only in own-billing mode, set by Owners, Admins and Finance and refused for the rest', async () => {
    expect(textOf(await list())).not.toContain(words.billingStatus.column)
    const own = (role: PartnerRole) => list({}, role, { page: storePage(`ownBilling:${role}`) })
    const owner = await own('partner-owner')
    expect(textOf(owner)).toContain(words.billingStatus.column)
    expect(textOf(owner)).toContain(words.billingStatus.note)
    expect(owner).toMatch(/<select class="df-billing-select"(?! disabled)/)
    expect(await own('partner-finance')).toMatch(/<select class="df-billing-select"(?! disabled)/)
    const support = await own('partner-support')
    expect(textOf(support)).toContain('Your role can’t set billing status. Owners, Admins and Finance can.')
    expect(support).toMatch(/<select class="df-billing-select"[^>]*disabled=""/)
    expect(storePage('ownBilling:partner-support').actions.billingStatus).toEqual({ allowed: false, reason: 'BILLING_ROLES_ONLY' })
  })

  it('points a partner that is not live at the checklist instead of a list', async () => {
    const draft = await render(<NotLive what={messages.screens.stores.title} me={{ ...owner, partner: { ...owner.partner, state: 'draft' } }} />)
    expect(textOf(draft)).toContain('Stores appear once Northstar Shops is live')
    expect(textOf(draft)).toContain(messages.shell.notLive.draft)
    expect(hrefs(draft)).toContain('/dashboard')
    const awaiting = await render(<NotLive what={messages.screens.stores.title} me={{ ...owner, partner: { ...owner.partner, state: 'awaiting' } }} />)
    expect(textOf(awaiting)).toContain(messages.shell.notLive.awaiting)
  })
})
