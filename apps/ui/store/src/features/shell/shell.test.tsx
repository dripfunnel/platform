import { SideNav } from '@dripfunnel/shared/ui'
import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { Acting, StoreState } from '../../api/shell'
import type { Seat } from '../../nav'
import { importRun } from '../imports/importRun'
import { navRowsFor } from './navWords'
import { StoreBanners } from './StoreBanners'
import { trialDaysLeft } from './trial'

const render = async (element: ReactNode, path = '/home') => {
  const router = createRouter({ routeTree: createRootRoute({ component: () => element }), history: createMemoryHistory({ initialEntries: [path] }) })
  await router.load()
  return renderToString(<RouterProvider router={router} />)
}

const owner: Seat = { side: 'merchant', role: 'owner' }
const manager: Seat = { side: 'merchant', role: 'manager' }
const supplier: Seat = { side: 'supplier', tier: 'vendor-orders-fulfil', admin: true }
const acting: Acting = { store: { id: 's1', name: 'Kesari Threads' }, role: 'owner', tier: null, seller: null, plan: { id: 'p1', name: 'Business' }, permissions: [] }
const day = 24 * 60 * 60 * 1000
const state = (over: Partial<StoreState>): StoreState => ({ readOnly: false, status: 'active', trialEndsAt: null, pastDueSince: null, provisioning: null, support: null, ...over })
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, '’').replace(/\s+/g, ' ')

describe('the store menu', () => {
  it('draws the group headings, the badges with spoken labels and Billing’s days left', async () => {
    const html = await render(<SideNav rows={navRowsFor(owner, { ordersToShip: 3, productsToApprove: 0 }, 7)} variant="bar" label="Store" footer={null} />)
    expect(html).toContain('<h2 class="df-nav-group">Catalogue</h2>')
    expect(html).toContain('<h2 class="df-nav-group">Your shop</h2>')
    expect(html).toContain('<h2 class="df-nav-group">Admin</h2>')
    expect(html).toContain('<span class="df-visually-hidden">3 orders to ship</span>')
    expect(html).not.toContain('waiting for approval')
    expect(html).toContain('<span class="df-nav-note">7 days left</span>')
  })

  it('leaves out what a role can’t use, never greys it', async () => {
    const html = await render(<SideNav rows={navRowsFor(manager, { ordersToShip: 0, productsToApprove: 0 }, null)} variant="bar" label="Store" footer={null} />)
    expect(html).not.toContain('href="/settings"')
    expect(html).not.toContain('href="/billing"')
    expect(html).not.toContain('Admin</h2>')
    const vendor = await render(<SideNav rows={navRowsFor(supplier, { ordersToShip: 1, productsToApprove: 0 }, null)} variant="bar" label="Store" footer={null} />)
    expect(text(vendor)).toContain('Your products')
    expect(text(vendor)).toContain('Your team')
    expect(vendor).not.toContain('df-nav-group')
    expect(vendor).not.toContain('disabled')
  })

  it('notes "stock only" on a Stock-only supplier’s products, and on no other tier’s (FIRST-RELEASE §3.1)', async () => {
    const stock = await render(<SideNav rows={navRowsFor({ side: 'supplier', tier: 'vendor-stock', admin: false }, { ordersToShip: 0, productsToApprove: 0 }, null)} variant="bar" label="Store" footer={null} />)
    expect(stock).toContain('<span class="df-nav-note">stock only</span>')
    const catalogue = await render(<SideNav rows={navRowsFor({ side: 'supplier', tier: 'vendor-catalogue', admin: true }, { ordersToShip: 0, productsToApprove: 0 }, null)} variant="bar" label="Store" footer={null} />)
    expect(catalogue).not.toContain('stock only')
  })
})

describe('the shell’s banners', () => {
  const banners = (seat: Seat, s: StoreState, path?: string) => render(<StoreBanners seat={seat} acting={acting} state={s} brand={null} />, path)

  it('follows a running import on every screen but Import & export itself, with the way back to it', async () => {
    const running = { id: 'i1', state: 'running', source: 'csv', products: 10, ready: 8, matched: 0, done: 3, created: 0, updated: 0, skipped: 0, failed: 0, photosPending: 0, problemCount: 0, problems: [], problemsCsv: null } as const
    importRun.set({ ...running, problems: [] })
    try {
      const home = await banners(owner, state({}))
      expect(text(home)).toContain('Importing products — 3 of 8 done. Keep working — we’ll tell you when it’s finished.')
      expect(home).toContain('href="/products/import"')
      expect(text(await banners(owner, state({}), '/products/import'))).not.toContain('Importing products')
      importRun.set({ ...running, problems: [], state: 'done' })
      expect(text(await banners(owner, state({})))).not.toContain('Importing products')
    } finally {
      importRun.set(null)
    }
  })

  it('shows the Owner the trial and its plan, with Choose a plan, and nobody else', async () => {
    const trial = state({ status: 'trial', trialEndsAt: new Date(Date.now() + 7 * day - 60_000).toISOString() })
    expect(text(await banners(owner, trial))).toContain('Free trial · 7 days left. You have everything in Business. No card needed.')
    expect(await banners(owner, trial)).toContain('href="/billing"')
    expect(text(await banners(manager, trial))).not.toContain('Free trial')
  })

  it('turns the last day into the warning to choose what to keep', async () => {
    const ending = state({ status: 'trial', trialEndsAt: new Date(Date.now() + day - 60_000).toISOString() })
    expect(text(await banners(owner, ending))).toContain('Your trial ends tomorrow.')
    expect(await banners(owner, ending)).toContain('href="/billing/keep"')
  })

  it('says past due is view-only, and only the Owner gets the way to pay', async () => {
    const pastDue = state({ status: 'past_due', readOnly: true })
    expect(text(await banners(owner, pastDue))).toContain('Your store is view-only.')
    expect(await banners(owner, pastDue)).toContain('href="/billing"')
    expect(await banners(manager, pastDue)).not.toContain('href="/billing"')
  })

  it('names the partner’s support on a support session, never DripFunnel', async () => {
    const html = text(await banners(manager, state({ support: { partnerName: 'Northstar Commerce', agentFirstName: 'Priya', endsAt: new Date(Date.now() + 28 * 60_000).toISOString() } })))
    expect(html).toContain('Northstar Commerce support (Priya) is viewing your store.')
    expect(html).not.toContain('DripFunnel')
  })

  it('shows a supplier none of the plan, trial or billing banners', async () => {
    expect(text(await banners(supplier, state({ status: null, trialEndsAt: null }))).trim()).toBe('')
  })
})

describe('trialDaysLeft', () => {
  it('counts today, and never goes below zero', () => {
    const now = new Date('2026-10-05T09:00:00Z')
    expect(trialDaysLeft('2026-10-12T09:00:00Z', now)).toBe(7)
    expect(trialDaysLeft('2026-10-05T10:00:00Z', now)).toBe(1)
    expect(trialDaysLeft('2026-10-01T00:00:00Z', now)).toBe(0)
    expect(trialDaysLeft(null, now)).toBeNull()
  })
})
