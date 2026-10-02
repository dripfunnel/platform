import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { Me } from '../../api/me'
import { storeActions, storeTabs, type Store, type StoreAction, type StoreTab } from '../../api/stores'
import { createStoresServer, sampleStores } from '../../api/storesSample'
import { messages } from '../../messages'
import type { PartnerRole } from '../shell/partnerRoles'
import { StoreDetail } from './StoreDetail'
import { storeDialog } from './storeDialog'

const textOf = (html: string) => html.replace(/<[^>]+>/g, '').replace(/&#x27;/g, '’').replace(/&amp;/g, '&')
const hrefs = (html: string) => [...html.matchAll(/href="([^"]*)"/g)].map((match) => (match[1] ?? '').replace(/&amp;/g, '&'))
const render = async (element: ReactNode, path = '/stores/st-juniper') => {
  const router = createRouter({ routeTree: createRootRoute({ component: () => element }), history: createMemoryHistory({ initialEntries: [path] }) })
  await router.load()
  return renderToString(<RouterProvider router={router} />)
}
const owner: Me = { id: 'pu-1', name: 'Maya Ortiz', email: 'maya@northstar.com', role: 'partner-owner', partner: { id: 'p-1', name: 'Northstar Commerce', product: 'Northstar Shops', host: 'store.northstar.com', state: 'live' } }
const server = createStoresServer(sampleStores)
const noop = () => undefined
const words = messages.store
const get = (id: string, role: PartnerRole = 'partner-owner') => {
  const store = server.get(id, role)
  if (!store) throw new Error(id)
  return store
}
const detail = (store: Store, tab: StoreTab = 'overview', role: PartnerRole = 'partner-owner') =>
  render(<StoreDetail me={{ ...owner, role }} store={store} tab={tab} forced={null} onAction={noop} onRecheck={() => Promise.resolve()} onReload={noop} />)

describe('the partner Store detail', () => {
  it('draws the header, the eight tabs and the account-level sentence, and never an order, customer or product', async () => {
    const html = await detail(get('st-juniper'))
    const text = textOf(html)
    expect(text).toContain('Store · Northstar Shops')
    expect(text).toContain('Juniper & Co.')
    expect(text).toContain('juniper-co')
    for (const tab of storeTabs) expect(text).toContain(words.tabs[tab])
    expect(text).toContain(words.overview.note)
    expect(text).toContain('Pro · $99.00 / month, charged by DripFunnel for Northstar')
    expect(text).toContain('9 people · 3 suppliers')
    expect(text).toContain('$18,420.00 · 612 orders (totals)')
    expect(text).toContain('Growth → Pro')
    expect(hrefs(html).some((href) => /orders|customers|products/.test(href))).toBe(false)
    expect(hrefs(html)).toContain('/stores/st-juniper?tab=plan')
  })

  it('states a suspended and a past-due store in the API’s words', async () => {
    const suspended = textOf(await detail(get('st-redline')))
    expect(suspended).toContain('Suspended on Sep 24, 2026: Chargebacks on 3 orders ($2,840).')
    const pastDue = textOf(await detail(get('st-tidewater')))
    expect(pastDue).toContain('Past due for 9 days. Marco’s team can’t make changes, but the shop is still selling. We retry the card on Sep 30, 2026.')
  })

  it('shows each tab’s contents from the fixture', async () => {
    const plan = textOf(await detail(get('st-oakline'), 'plan'))
    expect(plan).toContain(words.plan.at)
    expect(plan).toContain('5 of 5')
    expect(plan).toContain(words.plan.noOverrides)
    const overrides = textOf(await detail(get('st-juniper'), 'plan'))
    expect(overrides).toContain('+10 “Publish now” presses this month')
    expect(overrides).toContain('Diwali and holiday launches')
    const billing = textOf(await detail(get('st-harbor'), 'billing'))
    expect(billing).toContain('First charge Oct 1, 2026, when the trial ends')
    expect(billing).toContain(words.billing.payments.noCard)
    expect(billing).toContain(words.billing.noInvoices)
    const paidBilling = textOf(await detail(get('st-juniper'), 'billing'))
    expect(paidBilling).toContain('Card ending 4417')
    expect(paidBilling).not.toMatch(/\d{12,}/)
    const storefront = textOf(await detail(get('st-copperline'), 'storefront'))
    expect(storefront).toContain('This merchant runs its own storefront')
    expect(storefront).toContain(words.storefront.readOnly)
    const domains = await detail(get('st-maple'), 'domains')
    expect(textOf(domains)).toContain('Waiting since Sep 26, 2026')
    expect(textOf(domains)).toContain('shops.edge.dripfunnel.net')
    expect(textOf(domains)).toContain(words.domains.nothingFound)
    expect(textOf(domains)).toContain(words.domains.recheck)
    const setup = textOf(await detail(get('st-fieldnote'), 'setup'))
    expect(setup).toContain(words.setup.states.slow)
    expect(setup).toContain('Running for 43 min. It usually takes under two minutes.')
    expect(setup).toContain(words.actions.retryStep)
    const support = textOf(await detail(get('st-maple'), 'support'))
    expect(support).toContain('Chloé has turned partner support off for Maple & Pine.')
    expect(support).toContain(words.support.readOnly)
    const sessions = textOf(await detail(get('st-juniper'), 'support'))
    expect(sessions).toContain('Priya Nair as Anjali Nair')
    expect(sessions).toContain(words.support.how.ended)
    const activity = textOf(await detail(get('st-juniper'), 'activity'))
    expect(activity).toContain('Growth → Pro')
    expect(activity).toContain(words.activity.results.success)
  })

  it('offers each action as the fixture allows it per role, disabled with the reason otherwise', async () => {
    const asRole = async (id: string, role: PartnerRole) => {
      const store = get(id, role)
      return { store, html: await detail(store, 'overview', role) }
    }
    const ownerView = await asRole('st-harbor', 'partner-owner')
    expect(Object.keys(ownerView.store.actions).sort()).toEqual(['addOverride', 'changePlan', 'extendTrial', 'resendInvite', 'suspend'])
    expect(Object.values(ownerView.store.actions).every((permission) => permission.allowed)).toBe(true)
    expect(ownerView.html).toMatch(/<button[^>]*class="df-button df-button--danger"[^>]*>Suspend<\/button>/)
    const finance = await asRole('st-harbor', 'partner-finance')
    expect(finance.store.actions.extendTrial).toEqual({ allowed: true })
    expect(finance.store.actions.suspend).toEqual({ allowed: false, reason: 'OWNERS_AND_ADMINS_ONLY' })
    expect(textOf(finance.html)).toContain('Your role can’t suspend stores. Owners and Admins can.')
    for (const role of ['partner-support', 'partner-read-only'] as const) {
      const view = await asRole('st-harbor', role)
      expect(Object.values(view.store.actions).every((permission) => !permission.allowed)).toBe(true)
      expect(textOf(view.html)).toContain('Your role can’t extend trials. Owners, Admins and Finance can.')
      expect(view.html).toMatch(/<button[^>]*disabled=""[^>]*>Extend trial<\/button>/)
    }
    expect(Object.keys(get('st-summit').actions)).toEqual(['resendInvite'])
    expect(Object.keys(get('st-redline').actions).sort()).toEqual(['addOverride', 'changePlan', 'resendInvite', 'restore'])
    expect(get('st-fieldnote').actions.retryStep).toEqual({ allowed: true })
    expect(get('st-fieldnote', 'partner-support').actions.retryStep).toEqual({ allowed: false, reason: 'OWNERS_AND_ADMINS_ONLY' })
  })

  it('states each action’s consequence before the confirm, names the target, and makes Suspend type the store name', () => {
    const store = get('st-harbor')
    const options = server.changePlanOptions(store.id)
    const consequenceOf = (action: StoreAction, picks: Record<string, string> = {}, value = '') => {
      const dialog = storeDialog(action, store, options)
      return typeof dialog.consequence === 'function' ? dialog.consequence(value, picks) : dialog.consequence
    }
    const suspend = storeDialog('suspend', store, null)
    expect(suspend.target).toBe('Harbor Coffee Co.')
    expect(suspend.consequence).toBe('Its shop stops taking orders and its team can’t make changes until you restore it. Jenna gets the “Store suspended” email. Billing pauses.')
    expect(suspend.typeToConfirm?.expected).toBe('Harbor Coffee Co.')
    expect(suspend.danger).toBe(true)
    expect(suspend.reason?.label).toBe(words.dialogs.suspend.reason)
    expect(consequenceOf('changePlan', { planId: 'pro', when: 'next' })).toBe('Harbor Coffee Co. moves from Growth ($49.00 / month) to Pro ($99.00 / month), charged by DripFunnel for Northstar. Its limits change to Pro’s.')
    expect(consequenceOf('changePlan', { planId: 'pro', when: 'now' })).toContain('$3.33 is charged today.')
    expect(consequenceOf('changePlan', { planId: 'starter', when: 'now' })).toContain(words.dialogs.changePlan.credited)
    expect(storeDialog('changePlan', store, options).choices?.map((choice) => choice.key)).toEqual(['planId', 'when'])
    expect(consequenceOf('extendTrial', { days: '7' })).toBe('The trial ends Oct 1, 2026. It will end Oct 8, 2026 instead. Nothing is charged until then.')
    expect(consequenceOf('addOverride', { limit: 'publish', duration: 'month' }, '10')).toBe('Harbor Coffee Co. gets +10 “publish now” presses this month only. Its plan and price stay the same.')
    expect(storeDialog('restore', get('st-redline'), null).consequence).toBe(words.dialogs.restore.consequence)
    expect(storeDialog('resendInvite', store, null).consequence).toBe('Jenna Park (jenna@harborcoffee.co) gets a new invitation to set their password. The old link stops working.')
    for (const action of storeActions) expect(storeDialog(action, store, options).target).toBe(store.name)
  })

  it('shows not-found and the forced states in this console’s words', async () => {
    const missing = await render(<StoreDetail me={owner} store={null} tab="overview" forced={null} onAction={noop} onRecheck={() => Promise.resolve()} onReload={noop} />)
    expect(textOf(missing)).toContain(words.notFound.title)
    expect(hrefs(missing)).toContain('/stores')
    expect(await render(<StoreDetail me={owner} store={get('st-juniper')} tab="overview" forced="loading" onAction={noop} onRecheck={() => Promise.resolve()} onReload={noop} />)).toContain('df-skeleton')
    expect(textOf(await render(<StoreDetail me={owner} store={get('st-juniper')} tab="overview" forced="error" onAction={noop} onRecheck={() => Promise.resolve()} onReload={noop} />))).toContain(words.error.title)
    expect(textOf(await detail(get('st-juniper'), 'overview', 'partner-read-only'))).toContain(messages.states.readonly.title)
  })
})
