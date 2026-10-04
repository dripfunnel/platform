import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { messages } from '../../messages'
import { Billing, type BillingProps } from './Billing'
import { billingSample } from './billingSample'

const words = messages.billing
const textOf = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, '’').replace(/&amp;/g, '&').replace(/\s+/g, ' ')
const render = async (element: ReactNode) => {
  const router = createRouter({ routeTree: createRootRoute({ component: () => element }), history: createMemoryHistory({ initialEntries: ['/billing'] }) })
  await router.load()
  return renderToString(<RouterProvider router={router} />)
}
const view = (props: Partial<BillingProps> = {}) =>
  render(<Billing mode="dripfunnel" live money={null} partner="Northstar Commerce" product="Northstar Shops" mayChange denied={false} onRefresh={() => undefined} {...props} />)

describe('Billing', () => {
  it('says the money connects with the payment provider, and shows who bills', async () => {
    const html = await view()
    const text = textOf(html)
    expect(text).toContain(words.notConnected.dripfunnel)
    expect(textOf(await view({ mode: 'own' }))).toContain(words.notConnected.own)
    expect(text).toContain(words.settings.dripfunnel.label)
    expect(text).toContain(words.settings.current)
    expect(text).toContain(words.settings.changeLater)
    expect(html).not.toContain('id="billing-payments"')
  })

  it('tells a partner before Live, refuses Support, and holds the change to Owners and Finance', async () => {
    expect(textOf(await view({ live: false }))).toContain('Merchant payments and payouts appear once Northstar Shops is live.')
    expect(textOf(await view({ denied: true }))).toContain(words.denied)
    expect(textOf(await view({ mayChange: false }))).toContain(words.settings.ownersAndFinance)
  })

  it('draws the four parts from the sample, every amount as given and no card beyond its last four', async () => {
    const text = textOf(await view({ money: billingSample }))
    expect(text).toContain(words.payments.failedTitle)
    expect(text).toContain('Card declined · card ending 1881')
    expect(text).toContain('attempt 4 of 4')
    expect(text).toContain('DripFunnel for Northstar Commerce')
    expect(text).toContain(words.payments.statuses.refunded)
    expect(text).toContain('about $2,522.40 so far, to account ending 1180')
    expect(text).toContain('Refund to Summit Supply for a double charge')
    expect(text).toContain('$3,672.40')
    expect(text).toContain('INV-2026-0042')
    expect(text).toContain(words.invoices.pdf)
    expect(text).toContain('Account ending 1180')
    expect(text).toContain(words.payments.all)
    expect(text).not.toMatch(/\d{5,}/)
  })

  it('says why the next payout is held, and when the first one comes', async () => {
    expect(textOf(await view({ money: { ...billingSample, nextPayout: { state: 'heldVerification' } } }))).toContain(words.payouts.next.heldVerification)
    expect(textOf(await view({ money: { ...billingSample, nextPayout: { state: 'first' } } }))).toContain(words.payouts.next.first)
  })

  it('shows only the invoices and who bills when the partner bills itself, and a stale strip with Refresh now', async () => {
    const own = await view({ mode: 'own', money: billingSample })
    expect(own).not.toContain('id="billing-payments"')
    expect(own).not.toContain('id="billing-payouts"')
    expect(own).toContain('id="billing-invoices"')
    expect(textOf(await view({ money: { ...billingSample, staleSince: '2026-09-29T17:42:00.000Z' } }))).toContain(words.refresh)
  })
})
