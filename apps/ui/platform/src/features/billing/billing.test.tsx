import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { renderToString } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { BillingMoney } from '../../api/billing'
import { messages } from '../../messages'
import { Billing, type BillingProps } from './Billing'
import { pdfToast } from './billingOutcome'
import { billingMoney, paged } from './billingTestData'
import { billingAccess, loadBillingFor } from './loadBilling'

const words = messages.billing
const textOf = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, '’').replace(/&amp;/g, '&').replace(/\s+/g, ' ')
const render = async (element: ReactNode) => {
  const router = createRouter({ routeTree: createRootRoute({ component: () => element }), history: createMemoryHistory({ initialEntries: ['/billing'] }) })
  await router.load()
  return renderToString(<RouterProvider router={router} />)
}
const view = (props: Partial<BillingProps> & { money?: BillingMoney | null } = {}) => {
  const money = props.money === undefined ? billingMoney : props.money
  return render(<Billing money={money} invoices={paged(money?.invoices.items ?? [])} denied={false} mayChange onRefresh={() => undefined} onPdf={() => undefined} onToast={() => undefined} {...props} />)
}

describe('Billing’s access', () => {
  it('refuses Support, and lets only Owners and Finance connect Razorpay', () => {
    expect(billingAccess('partner-support')).toEqual({ denied: true, mayChange: false })
    expect(billingAccess('partner-admin')).toEqual({ denied: false, mayChange: false })
    expect(billingAccess('partner-read-only')).toEqual({ denied: false, mayChange: false })
    expect(billingAccess('partner-finance')).toEqual({ denied: false, mayChange: true })
    expect(billingAccess('partner-owner')).toEqual({ denied: false, mayChange: true })
  })

  it('asks Support’s loader nothing', async () => {
    const fetched = vi.fn()
    vi.stubGlobal('fetch', fetched)
    expect(await loadBillingFor('partner-support')).toEqual({ refused: true })
    expect(fetched).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })
})

describe('Billing', () => {
  it('shows DripFunnel’s invoices and no choice of who bills the merchants (#1743)', async () => {
    const html = await view()
    const text = textOf(html)
    expect(html).toContain('id="billing-invoices"')
    expect(html).toContain('id="billing-razorpay"')
    expect(text).toContain('INV-2026-0042')
    expect(text).toContain(words.invoices.pdf)
    expect(text).toContain(messages.screens.billing.lede)
    expect(html).not.toContain('type="radio"')
    expect(text).not.toMatch(/on your behalf|Who bills|Payout account|payouts/i)
  })

  it('says there are no invoices yet, and offers Show more on a list the API says goes on', async () => {
    expect(textOf(await view({ money: { ...billingMoney, invoices: { ...billingMoney.invoices, items: [] } } }))).toContain(words.invoices.none)
    expect(textOf(await view({ invoices: paged(billingMoney.invoices.items, true) }))).toContain(words.showMore)
  })

  it('refuses Support, and shows a stale strip with Refresh now', async () => {
    expect(textOf(await view({ denied: true }))).toContain(words.denied)
    expect(textOf(await view({ money: { ...billingMoney, staleSince: '2026-09-29T17:42:00.000Z' } }))).toContain(words.refresh)
  })
})

describe('what Billing says after an answer', () => {
  it('says why a PDF didn’t open, telling a slow provider from a missing PDF and a blocked tab', () => {
    expect(pdfToast({ ok: true }, false)).toBeNull()
    expect(pdfToast({ ok: true }, true)).toBe(words.toasts.popupBlocked)
    expect(pdfToast({ ok: false, reason: 'NO_PDF' }, false)).toBe(words.refusals.NO_PDF)
    expect(pdfToast({ ok: false, reason: 'PROVIDER_UNAVAILABLE' }, false)).toBe(words.refusals.PROVIDER_UNAVAILABLE)
  })
})
