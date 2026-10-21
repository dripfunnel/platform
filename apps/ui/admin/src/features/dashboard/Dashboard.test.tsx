import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from '@tanstack/react-router'
import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { DashboardData } from '../../api/dashboard'
import { messages } from '../../messages'
import { textOf } from '../../testing/textOf'
import { Dashboard, type DashboardProps } from './Dashboard'

const words = messages.dashboard
const noop = () => undefined

const partnerOptions = [
  { id: 'df', name: 'DripFunnel' },
  { id: 'ns', name: 'Northstar Commerce' },
  { id: 'bz', name: 'Bazaar Cloud' },
  { id: 'kl', name: 'Kaufladen Digital' },
  { id: 'lt', name: 'Loom & Thread' },
  { id: 'ts', name: 'Tallis Studio' },
  { id: 'nl', name: 'Nordlicht Media' },
]

// What the API answers for the prototype's platform (designs/admin-data.js), already counted.
const allPartners: DashboardData = {
  partnerId: null,
  partnerOptions,
  asOf: '2026-09-28T10:42:00Z',
  partners: { live: 4, awaiting: 1, draft: 2, paused: 0 },
  awaiting: { count: 1, oldest: { id: 'kl', name: 'Kaufladen Digital', submittedAt: '2026-09-26T09:40:00Z', waitingSeconds: 176_520 } },
  stores: {
    total: 1679,
    newThisWeek: 65,
    newThisWeekByPartner: [
      { id: 'df', name: 'DripFunnel', count: 38 },
      { id: 'bz', name: 'Bazaar Cloud', count: 21 },
      { id: 'ns', name: 'Northstar Commerce', count: 6 },
    ],
  },
  attention: {
    pastDue: 1,
    suspended: 1,
    setupFailed: 1,
    setupStuck: 1,
    total: 4,
    stores: [
      { id: 's13', name: 'Peak Supply Co.', partnerName: 'DripFunnel', reason: { kind: 'setup', state: 'failed', step: 'repo', attempt: 2 } },
      { id: 's5', name: 'Fjord Outdoor', partnerName: 'DripFunnel', reason: { kind: 'setup', state: 'stuck', step: 'firstBuild', attempt: 2 } },
      { id: 's4', name: 'Redline Moto Parts', partnerName: 'Northstar Commerce', reason: { kind: 'suspended', reason: 'Chargeback' } },
      { id: 's3', name: 'Kiko Kids', partnerName: 'Bazaar Cloud', reason: { kind: 'pastDue', daysPastDue: 9 } },
    ],
  },
  signups: { started: 73, completed: 67, failed: 2, medianSecondsToReady: 372 },
}

const bazaarOnly: DashboardData = {
  ...allPartners,
  partnerId: 'bz',
  partners: { live: 1, awaiting: 0, draft: 0, paused: 0 },
  awaiting: { count: 0, oldest: null },
  stores: { total: 312, newThisWeek: 21, newThisWeekByPartner: [{ id: 'bz', name: 'Bazaar Cloud', count: 21 }] },
  attention: { pastDue: 1, suspended: 0, setupFailed: 0, setupStuck: 0, total: 1, stores: [{ id: 's3', name: 'Kiko Kids', partnerName: 'Bazaar Cloud', reason: { kind: 'pastDue', daysPastDue: 9 } }] },
  signups: { started: 23, completed: 22, failed: 1, medianSecondsToReady: 425 },
}

const render = async (props: Partial<DashboardProps> = {}) => {
  const rootRoute = createRootRoute({
    component: () => (
      <Dashboard
        data={allPartners}
        forced={null}
        canCreatePartner
        onPartnerChange={noop}
        onReload={noop}
        {...props}
      />
    ),
  })
  const router = createRouter({ routeTree: rootRoute, history: createMemoryHistory({ initialEntries: ['/dashboard'] }) })
  await router.load()
  return renderToString(<RouterProvider router={router} />)
}

const hrefs = (html: string) => [...html.matchAll(/href="([^"]*)"/g)].map((match) => (match[1] ?? '').replace(/&amp;/g, '&'))

describe('Dashboard', () => {
  it('shows the five cards FIRST-RELEASE §3 names, and no others', async () => {
    const titles = [...(await render()).matchAll(/<h2[^>]*>([^<]*)<\/h2>/g)].map((match) => match[1])
    expect(titles).toEqual([
      words.partners.title,
      words.awaiting.title,
      words.stores.title,
      words.attention.title,
      words.signups.title,
    ])
  })

  it('links every partner count to the Partners list filtered by that state', async () => {
    const links = hrefs(await render())
    for (const state of ['live', 'awaiting', 'draft', 'paused']) expect(links).toContain(`/partners?status=${state}`)
  })

  it('shows the partner waiting longest, and how long, from the API', async () => {
    const html = await render()
    expect(hrefs(html)).toContain('/partners/kl')
    const text = textOf(html)
    expect(text).toContain('Kaufladen Digital')
    expect(text).toContain('2 days 1 hr')
    expect(text).toContain('Submitted Sep 26, 2026, 09:40 UTC')
  })

  it('links store numbers to the Stores list, with the filter already applied', async () => {
    const html = await render()
    const links = hrefs(html)
    expect(textOf(html)).toContain('1,679')
    expect(links).toContain('/stores')
    expect(links).toContain('/stores?created=7d')
    expect(links).toContain('/stores?partner=df&created=7d')
    expect(links).toContain('/stores?status=pastdue')
    expect(links).toContain('/stores?status=suspended')
    expect(links).toContain('/stores?setup=failed')
    expect(links).toContain('/stores?setup=stuck')
    expect(links).toContain('/stores?created=7d&setup=done')
    expect(links).toContain('/stores?created=7d&setup=failed')
  })

  it('lists the stores that need attention, each linking to its store', async () => {
    const html = await render()
    for (const id of ['s3', 's4', 's5', 's13']) expect(hrefs(html)).toContain(`/stores/${id}`)
    const text = textOf(html)
    expect(text).toContain('Past due · 9 days')
    expect(text).toContain('Setup at “First build”, attempt 2')
  })

  it('says one day, not one days, for a store a day past due', async () => {
    const oneDay: DashboardData = {
      ...allPartners,
      attention: {
        ...allPartners.attention,
        stores: [{ id: 's9', name: 'Tiny Shop', partnerName: 'Bazaar Cloud', reason: { kind: 'pastDue', daysPastDue: 1 } }],
      },
    }
    expect(textOf(await render({ data: oneDay }))).toContain('Past due · 1 day')
    expect(textOf(await render({ data: oneDay }))).not.toContain('1 days')
  })

  it('says when the list of stores needing attention is cut short', async () => {
    const capped: DashboardData = { ...allPartners, attention: { ...allPartners.attention, total: 12 } }
    expect(textOf(await render({ data: capped }))).toContain('Showing 4 of 12. The links above open each list in full.')
    expect(textOf(await render())).not.toContain('Showing')
  })

  it('carries the partner filter into every link that the list can filter by', async () => {
    const html = await render({ data: bazaarOnly })
    const links = hrefs(html)
    expect(links).toContain('/stores?partner=bz')
    expect(links).toContain('/stores?partner=bz&created=7d')
    expect(links).toContain('/stores?partner=bz&status=pastdue')
    expect(links).toContain('/stores?partner=bz&created=7d&setup=failed')
    expect(textOf(html)).toContain('Every card shows Bazaar Cloud only')
    expect(html).toMatch(/<option value="bz" selected="">/)
  })

  it('shows no revenue, usage or money figures', async () => {
    expect(textOf(await render())).not.toMatch(/[$€£₹]|revenue|MRR/i)
  })

  it('loads as skeletons with no numbers, never a zero that becomes real', async () => {
    const html = await render({ forced: 'loading' })
    expect(html).toContain('df-skeleton')
    expect(textOf(html)).not.toMatch(/\d/)
  })

  it('reads like a first run when the platform has no partners', async () => {
    const empty: DashboardData = { ...allPartners, partnerOptions: [] }
    for (const html of [await render({ data: empty }), await render({ forced: 'empty' })]) {
      const text = textOf(html)
      expect(text).toContain(words.empty.title)
      expect(text).toContain(words.empty.body)
      expect(html).toMatch(/<a[^>]*href="\/partners"[^>]*>Create partner<\/a>/)
      expect(html).not.toContain('role="alert"')
    }
  })

  it('shows Create partner disabled, with the reason, to roles that cannot create one', async () => {
    const html = await render({ forced: 'empty', canCreatePartner: false })
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Create partner<\/button>/)
    expect(textOf(html)).toContain(words.empty.denied)
    expect(html).not.toMatch(/<a[^>]*>Create partner<\/a>/)
  })

  it('explains an error in plain words, with a retry', async () => {
    const html = await render({ forced: 'error' })
    expect(html).toContain('role="alert"')
    const text = textOf(html)
    expect(text).toContain(words.error.title)
    expect(text).toContain(words.error.retry)
  })

  it.each([
    ['stale', 'Numbers from Sep 28, 2026, 10:42 UTC.'],
    ['offline', words.offline.title],
  ] as const)('keeps the numbers and says so when %s', async (forced, title) => {
    const text = textOf(await render({ forced }))
    expect(text).toContain(title)
    expect(text).toContain(words.refresh)
    expect(text).toContain('1,679')
  })

  it('announces the stale notice through a status region that starts empty', async () => {
    const html = await render({ forced: 'stale' })
    expect(html).toContain('<p role="status" class="df-visually-hidden"></p>')
    expect(html).not.toMatch(/class="df-stale"[^>]*role=/)
  })
})
