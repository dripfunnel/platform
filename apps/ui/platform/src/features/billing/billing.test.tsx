import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { renderToString } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { BillingMoney } from '../../api/billing'
import { messages } from '../../messages'
import { Billing, type BillingProps } from './Billing'
import { billingMoney, paged } from './billingTestData'
import { billingAccess, loadBillingFor } from './loadBilling'
import { modeToast, pdfToast } from './billingOutcome'

const words = messages.billing
const textOf = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, '’').replace(/&amp;/g, '&').replace(/\s+/g, ' ')
const render = async (element: ReactNode) => {
  const router = createRouter({ routeTree: createRootRoute({ component: () => element }), history: createMemoryHistory({ initialEntries: ['/billing'] }) })
  await router.load()
  return renderToString(<RouterProvider router={router} />)
}
const view = (props: Partial<BillingProps> & { money?: BillingMoney | null } = {}) => {
  const money = props.money === undefined ? billingMoney : props.money
  return render(
    <Billing
      mode="dripfunnel"
      live
      money={money}
      payments={paged(money?.payments.items ?? [])}
      payouts={paged(money?.payouts.items ?? [])}
      invoices={paged(money?.invoices.items ?? [])}
      partner="Northstar Commerce"
      product="Northstar Shops"
      mayChange
      changing={false}
      denied={false}
      onRefresh={() => undefined}
      onChangeMode={() => undefined}
      onPdf={() => undefined}
      {...props}
    />,
  )
}

describe('Billing’s access', () => {
  it('refuses Support, and lets only Owners and Finance change who bills', () => {
    expect(billingAccess('partner-support')).toEqual({ denied: true, mayChange: false })
    expect(billingAccess('partner-read-only')).toEqual({ denied: false, mayChange: false })
    expect(billingAccess('partner-admin')).toEqual({ denied: false, mayChange: false })
    expect(billingAccess('partner-finance')).toEqual({ denied: false, mayChange: true })
    expect(billingAccess('partner-owner')).toEqual({ denied: false, mayChange: true })
  })

  it('asks Support’s loader nothing, and answers with the API’s money for everyone else', async () => {
    const fetched = vi.fn()
    vi.stubGlobal('fetch', fetched)
    expect(await loadBillingFor('partner-support')).toEqual({ refused: true })
    expect(fetched).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })
})

describe('Billing', () => {
  it('draws the four parts as the API gives them, every amount as given and no card beyond its last four', async () => {
    const text = textOf(await view())
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
    expect(text).not.toMatch(/\d{5,}/)
  })

  it('says a failure without Stripe’s words plainly, and no retry line when none is due', async () => {
    const text = textOf(await view({ money: { ...billingMoney, failed: [{ id: 'c1', storeId: 's1', storeName: 'Lumen Candle Co.', amount: { amount: 4900, currency: 'USD' }, why: null, cardLast4: null, retryAt: null, attempt: 4, attempts: 4 }] } }))
    expect(text).toContain(words.payments.failedNoWhy)
    expect(text).not.toContain('attempt 4 of 4')
  })

  it('says why the next payout is held, and when the first one comes', async () => {
    expect(textOf(await view({ money: { ...billingMoney, nextPayout: { state: 'heldVerification' } } }))).toContain(words.payouts.next.heldVerification)
    expect(textOf(await view({ money: { ...billingMoney, nextPayout: { state: 'first' } } }))).toContain(words.payouts.next.first)
    expect(textOf(await view({ money: { ...billingMoney, nextPayout: { state: 'heldNoAccount' } } }))).toContain(words.payouts.next.heldNoAccount)
    expect(textOf(await view({ money: { ...billingMoney, nextPayout: { state: 'heldVerifying' } } }))).toContain(words.payouts.next.heldVerifying)
  })

  it('offers Show more on a list the API says goes on', async () => {
    const html = await view({ payments: paged(billingMoney.payments.items, true) })
    expect(textOf(html)).toContain(words.showMore)
  })

  it('tells a partner before Live, refuses Support, and holds the change to Owners and Finance', async () => {
    expect(textOf(await view({ live: false }))).toContain('Merchant payments and payouts appear once Northstar Shops is live.')
    expect(textOf(await view({ denied: true }))).toContain(words.denied)
    expect(textOf(await view({ mayChange: false }))).toContain(words.settings.ownersAndFinance)
    const html = await view()
    expect(html).toContain('checked="" value="dripfunnel"')
    expect(await view({ mayChange: false })).toMatch(/<fieldset[^>]*disabled/)
  })

  it('shows only the invoices and who bills when the partner bills itself, and a stale strip with Refresh now', async () => {
    const own = await view({ mode: 'own' })
    expect(own).not.toContain('id="billing-payments"')
    expect(own).not.toContain('id="billing-payouts"')
    expect(own).toContain('id="billing-invoices"')
    expect(own).toContain('checked="" value="own"')
    expect(textOf(await view({ money: { ...billingMoney, staleSince: '2026-09-29T17:42:00.000Z' } }))).toContain(words.refresh)
  })
})

describe('what Billing says after an answer', () => {
  it('words a refused change by its code, never a bare "try again"', () => {
    expect(modeToast({ ok: true }, 'You, with your own billing')).toBe('Who bills your merchants is now: You, with your own billing.')
    expect(modeToast({ ok: false, reason: 'NOT_CONNECTED' }, 'x')).toBe(words.refusals.NOT_CONNECTED)
    expect(modeToast({ ok: false, reason: 'PROVIDER_UNAVAILABLE' }, 'x')).toBe(words.refusals.PROVIDER_UNAVAILABLE)
  })

  it('says why a PDF didn\u2019t open, telling a slow provider from a missing PDF and a blocked tab', () => {
    expect(pdfToast({ ok: true }, false)).toBeNull()
    expect(pdfToast({ ok: true }, true)).toBe(words.toasts.popupBlocked)
    expect(pdfToast({ ok: false, reason: 'NO_PDF' }, false)).toBe(words.refusals.NO_PDF)
    expect(pdfToast({ ok: false, reason: 'PROVIDER_UNAVAILABLE' }, false)).toBe(words.refusals.PROVIDER_UNAVAILABLE)
  })

  it('keeps the radios focusable while a change is saving, and says when more are being retried', async () => {
    const html = await view({ changing: true, money: { ...billingMoney, failedMore: true } })
    expect(html).not.toMatch(/<fieldset[^>]*disabled/)
    expect(html).toContain('aria-busy="true"')
    expect(textOf(html)).toContain(words.payments.failedMore)
  })
})
