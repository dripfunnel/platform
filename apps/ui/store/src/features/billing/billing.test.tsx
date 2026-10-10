// @vitest-environment happy-dom
import { ApiError } from '@dripfunnel/shared/graphql'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { createMemoryHistory, createRootRoute, createRoute, createRouter, Outlet, RouterProvider } from '@tanstack/react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BillingRead, CataloguePlan, Invoice, PlanChangeQuote, Subscription } from '../../api/billing'
import type { Acting } from '../../api/shell'
import { messages } from '../../messages'
import { billToLines, cardText, includesRows, invoiceCsvRows, metersOf, planPoints } from './billingView'

// Billing driven as the Owner would (FIRST-RELEASE §16): plans and their limits, a change with its quote, usage, the
// card, the details on invoices and the invoices; and who is turned away or kept from changing anything.

const words = messages.billing

const api = vi.hoisted(() => ({
  loadBilling: vi.fn(),
  loadMoreInvoices: vi.fn(),
  loadAllInvoices: vi.fn(),
  quotePlanChange: vi.fn(),
  changePlan: vi.fn(),
  saveBillingDetails: vi.fn(),
  invoicePdf: vi.fn(),
  cancelStore: vi.fn(),
  exportStoreData: vi.fn(),
  loadStoreDataExport: vi.fn(),
}))
vi.mock('../../api/billing', async (actual) => ({ ...(await actual<typeof import('../../api/billing')>()), ...api }))
const download = vi.hoisted(() => ({ downloadCsv: vi.fn() }))
vi.mock('../common/download', () => download)

const { BillingPage } = await import('./BillingPage')

const inr = (amount: string) => ({ amount, currency: 'INR' })
const limit = (key: string, amount: number | null) => ({ key, kind: 'amount', enabled: null, amount, unlimited: amount === null })

const free: CataloguePlan = { id: 'free', name: 'Free', description: null, current: false, monthly: inr('0'), yearly: inr('0'), values: [limit('products', 10), limit('staff', 0)] }
const growth: CataloguePlan = {
  id: 'growth',
  name: 'Growth',
  description: null,
  current: true,
  monthly: inr('83300'),
  yearly: inr('499900'),
  values: [limit('products', 100), limit('staff', 2), limit('markets', 2), limit('bandwidth_gb', 10), { key: 'custom_domain', kind: 'switch', enabled: true, amount: null, unlimited: false }],
}
const pro: CataloguePlan = {
  id: 'pro',
  name: 'Growth Pro',
  description: 'For shops selling abroad',
  current: false,
  monthly: inr('116600'),
  yearly: null,
  values: [limit('products', null), limit('staff', 5), limit('ai_prompts', 200), { key: 'support_level', kind: 'choice', enabled: null, amount: 2, unlimited: false }, { key: 'not_a_key', kind: 'switch', enabled: true, amount: null, unlimited: false }],
}

const sub: Subscription = {
  plan: { id: 'growth', name: 'Growth' },
  status: 'active',
  interval: 'MONTH',
  price: inr('83300'),
  periodStart: '2026-10-01T00:00:00.000Z',
  periodEnd: '2026-11-01T00:00:00.000Z',
  trialEndsAt: null,
  cancelAt: null,
  scheduled: null,
  card: { brand: 'visa', last4: '4242', expires: '2028-04' },
  collectedBy: 'dripfunnel',
  partnerName: 'Kesari Commerce',
  asOf: '2026-10-10T09:00:00.000Z',
}

const invoice = (id: string, number: string): Invoice => ({ id, number, kind: 'subscription', status: 'paid', amount: inr('83300'), tax: inr('14994'), issuedAt: '2026-10-01T00:00:00.000Z', paidAt: null, lines: [{ label: 'Growth plan', kind: 'plan' }] })

const read = (more: Partial<BillingRead> = {}): BillingRead => ({
  subscription: sub,
  plans: [free, growth, pro],
  usage: [
    { key: 'products', used: 84, limit: 100, unlimited: false, monthly: false },
    { key: 'staff', used: 1, limit: null, unlimited: true, monthly: false },
  ],
  details: null,
  store: { legalName: null, name: 'Kesari', contactEmail: 'hello@kesari.example', country: 'IN', taxId: null, address: { street: '14 MG Road', city: 'Bengaluru', postal: '560001', region: 'KA' } },
  invoices: { rows: [invoice('i2', 'KC-0002')], next: 'c1' },
  ...more,
})

const quote = (more: Partial<PlanChangeQuote> = {}): PlanChangeQuote => ({ offered: ['NOW', 'PERIOD_END'], charge: inr('64000'), credit: inr('46000'), today: inr('18000'), from: '2026-10-10T00:00:00.000Z', nextPrice: inr('116600'), ...more })

const owner: Acting = { store: { id: 's1', name: 'Kesari' }, role: 'owner', tier: null, seller: null, plan: null, permissions: ['billing', 'settings'] }
const manager: Acting = { ...owner, role: 'manager', permissions: ['reports.read'] }
const supplier: Acting = { ...owner, role: 'supplier-admin', tier: 'vendor-catalogue', seller: { id: 'v1', name: 'Northwind' }, permissions: ['catalog.write', 'billing'] }

type ShellState = { readOnly: boolean; support: unknown }

const show = async (acting: Acting, state: ShellState = { readOnly: false, support: null }, path = '/billing') => {
  const root = createRootRoute({ component: Outlet })
  const app = createRoute({ getParentRoute: () => root, id: '_app', loader: () => ({ acting, state }), component: Outlet })
  const page = createRoute({ getParentRoute: () => app, path: '/billing', component: BillingPage })
  const keep = createRoute({ getParentRoute: () => app, path: '/billing/keep', component: () => <p>keep screen</p> })
  const router = createRouter({ routeTree: root.addChildren([app.addChildren([page, keep])]), history: createMemoryHistory({ initialEntries: [path] }) })
  await act(async () => {
    render(<RouterProvider router={router} />)
  })
  await settle()
  return router
}

const settle = () => act(async () => new Promise((resolve) => setTimeout(resolve, 0)))
const plan = (name: string) => within(screen.getByRole('article', { name }))
const dialog = () => within(screen.getByRole('dialog'))

beforeEach(() => {
  api.loadBilling.mockResolvedValue(read())
  api.changePlan.mockResolvedValue(sub)
})

afterEach(() => {
  cleanup()
  vi.resetAllMocks()
  sessionStorage.clear()
})

describe('what Billing says', () => {
  it('leads each plan with its limits, Unlimited as such and no staff as Owner only', () => {
    expect(planPoints(growth)).toEqual(['100 products', '2 staff accounts', '2 markets', '10 GB bandwidth'])
    expect(planPoints(pro)).toEqual(['Unlimited products', '5 staff accounts'])
    expect(planPoints(free)).toEqual(['10 products', 'Owner only'])
  })

  it('lists every setting a plan carries, a quota a month, a choice by name, and leaves out a key it has no words for', () => {
    const rows = includesRows([growth, pro])
    expect(rows.map((r) => r.key)).toEqual(['products', 'staff', 'markets', 'bandwidth_gb', 'custom_domain', 'ai_prompts', 'support_level'])
    expect(rows.find((r) => r.key === 'products')?.cells).toEqual(['100', 'Unlimited'])
    expect(rows.find((r) => r.key === 'custom_domain')?.cells).toEqual([words.includes.on, words.includes.off])
    expect(rows.find((r) => r.key === 'ai_prompts')?.cells).toEqual([words.includes.off, '200 a month'])
    expect(rows.find((r) => r.key === 'support_level')?.cells).toEqual([words.includes.off, 'Chat'])
  })

  it('draws a bar against a limit, none for Unlimited, and says when a monthly count starts again', () => {
    const meters = metersOf(
      [
        { key: 'products', used: 84, limit: 100, unlimited: false, monthly: false },
        { key: 'staff', used: 3, limit: null, unlimited: true, monthly: false },
        { key: 'suppliers', used: 0, limit: 0, unlimited: false, monthly: false },
        { key: 'publish_now', used: 10, limit: 10, unlimited: false, monthly: true },
      ],
      new Date('2026-10-10T12:00:00Z'),
    )
    expect(meters.map((m) => [m.key, m.value, m.percent, m.tone])).toEqual([
      ['products', '84 of 100', 84, 'near'],
      ['staff', '3 · no limit', null, 'ok'],
      ['publish_now', '10 of 10', 100, 'full'],
    ])
    expect(meters[2]?.note).toBe(`${words.usage.full} · Resets Nov 1, 2026`)
  })

  it('names the card by brand, last 4 and expiry only', () => {
    expect(cardText(sub.card)).toBe('Visa ending 4242 · expires 04/28')
    expect(cardText(null)).toBe(words.card.none)
  })

  it('starts the details from the store’s own until some are saved, with the tax number its country uses', () => {
    expect(billToLines(null, read().store)).toEqual({ lines: ['Kesari', 'GSTIN: Not added yet', 'hello@kesari.example'], kind: 'gstin' })
    const saved = billToLines({ legalName: 'Kesari GmbH', email: 'a@b.de', address: { line1: 'Hauptstr. 1', line2: null, city: 'Berlin', region: null, postal: '10115', country: 'DE' }, taxId: 'DE123456789', taxIdKind: 'vat' }, null)
    expect(saved).toEqual({ lines: ['Kesari GmbH', 'Hauptstr. 1, Berlin, 10115, DE', 'VAT number: DE123456789', 'a@b.de'], kind: 'vat' })
  })

  it('exports invoices with amounts in units of their currency', () => {
    expect(invoiceCsvRows([invoice('i1', 'KC-0001')])).toEqual([[...words.invoices.columns], ['KC-0001', '2026-10-01', 'Growth plan', '833.00', '149.94', 'INR', 'Paid']])
  })
})

describe('the Billing screen', () => {
  it('shows the partner’s plans, who charges, usage, the card, the details and the invoices', async () => {
    await show(owner)
    expect(screen.getByText(/What you pay Kesari Commerce for your shop/)).toBeTruthy()
    expect(screen.getByText(/DripFunnel collects it on Kesari Commerce’s behalf/)).toBeTruthy()
    expect(plan('Growth').getByText(words.plans.yours)).toBeTruthy()
    expect(plan('Growth').getByText('₹833.00')).toBeTruthy()
    expect(plan('Growth').queryByRole('button')).toBeNull()
    expect(plan('Free').queryByRole('button')).toBeNull()
    expect(plan('Growth Pro').getByRole('button', { name: words.plans.upgrade })).toBeTruthy()
    expect(screen.getByRole('meter', { name: 'Products' }).getAttribute('aria-valuenow')).toBe('84')
    expect(screen.getByText('Visa ending 4242 · expires 04/28')).toBeTruthy()
    expect(screen.getByText('GSTIN: Not added yet')).toBeTruthy()
    expect(screen.getByText('KC-0002')).toBeTruthy()
    expect(screen.queryByText(/4242 4242/)).toBeNull()
  })

  it('switches the prices to the yearly ones, and a plan with no yearly price offers nothing', async () => {
    await show(owner)
    fireEvent.click(within(screen.getByRole('group', { name: words.period.label })).getByRole('button', { name: words.period.YEAR }))
    expect(plan('Growth').getByText('₹4,999.00')).toBeTruthy()
    expect(plan('Growth').getByRole('button', { name: words.plans.switchTo.YEAR })).toBeTruthy()
    expect(plan('Growth Pro').getByText(words.plans.notOffered.YEAR)).toBeTruthy()
    expect(plan('Growth Pro').queryByRole('button')).toBeNull()
  })

  it('shows what each plan includes on asking', async () => {
    await show(owner)
    const toggle = screen.getByRole('button', { name: words.includes.show })
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(toggle)
    const table = within(screen.getByRole('table'))
    expect(table.getByRole('rowheader', { name: 'Your own domain' })).toBeTruthy()
    expect(table.getAllByText('Unlimited').length).toBeGreaterThan(0)
  })

  it('quotes an upgrade now and at period end, states both amounts and the date, and changes it', async () => {
    api.quotePlanChange.mockResolvedValueOnce(quote()).mockResolvedValueOnce(quote({ charge: inr('0'), credit: inr('0'), today: inr('0'), from: sub.periodEnd }))
    await show(owner)
    fireEvent.click(plan('Growth Pro').getByRole('button', { name: words.plans.upgrade }))
    await settle()
    expect(api.quotePlanChange.mock.calls).toEqual([
      ['pro', 'MONTH', 'NOW'],
      ['pro', 'MONTH', 'PERIOD_END'],
    ])
    expect(dialog().getByText('Today: ₹180.00 — ₹640.00 for the rest of this period on Growth Pro, less ₹460.00 unused on Growth. From Oct 10, 2026, ₹1,166.00 a month.')).toBeTruthy()
    fireEvent.change(dialog().getByLabelText(words.change.when), { target: { value: 'PERIOD_END' } })
    expect(dialog().getByText(/Nothing changes until Nov 1, 2026/)).toBeTruthy()
    fireEvent.change(dialog().getByLabelText(words.change.when), { target: { value: 'NOW' } })
    fireEvent.click(dialog().getByRole('button', { name: 'Switch to Growth Pro' }))
    await settle()
    expect(api.changePlan).toHaveBeenCalledWith('pro', 'MONTH', 'NOW')
    expect(api.loadBilling).toHaveBeenCalledTimes(2)
    expect(screen.getByRole('status').textContent).toContain('You’re on Growth.')
  })

  it('takes a smaller plan at the period’s end only, and says when', async () => {
    api.quotePlanChange.mockRejectedValueOnce(new ApiError('AT_PERIOD_END_ONLY', 'later')).mockResolvedValueOnce(quote({ offered: ['PERIOD_END'], charge: inr('0'), credit: inr('0'), today: inr('0'), from: sub.periodEnd, nextPrice: inr('0') }))
    api.loadBilling.mockResolvedValue(read({ plans: [free, { ...growth, current: false }, { ...pro, current: true }], subscription: { ...sub, plan: { id: 'pro', name: 'Growth Pro' } } }))
    api.changePlan.mockResolvedValue({ ...sub, scheduled: { plan: { id: 'growth', name: 'Growth' }, interval: 'MONTH', at: sub.periodEnd } })
    await show(owner)
    fireEvent.click(plan('Growth').getByRole('button', { name: words.plans.later }))
    await settle()
    expect(dialog().queryByLabelText(words.change.when)).toBeNull()
    fireEvent.click(dialog().getByRole('button', { name: 'Switch to Growth' }))
    await settle()
    expect(api.changePlan).toHaveBeenCalledWith('growth', 'MONTH', 'PERIOD_END')
    expect(screen.getByRole('status').textContent).toContain('You’ll move to Growth on Nov 1, 2026.')
  })

  it('keeps a refusal in the dialog that asked, and a quote that fails on the page', async () => {
    api.quotePlanChange.mockResolvedValueOnce(quote({ offered: ['NOW'] }))
    api.changePlan.mockRejectedValueOnce(new ApiError('PAYMENT_FAILED', 'no'))
    await show(owner)
    fireEvent.click(plan('Growth Pro').getByRole('button', { name: words.plans.upgrade }))
    await settle()
    fireEvent.click(dialog().getByRole('button', { name: 'Switch to Growth Pro' }))
    await settle()
    expect(dialog().getByRole('alert').textContent).toBe(words.refused.PAYMENT_FAILED)
    fireEvent.click(dialog().getByRole('button', { name: words.change.cancel }))
    expect(screen.queryByRole('alert')).toBeNull()
    api.quotePlanChange.mockRejectedValueOnce(new ApiError('CHANGE_IN_PROGRESS', 'busy'))
    fireEvent.click(plan('Growth Pro').getByRole('button', { name: words.plans.upgrade }))
    await settle()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByRole('alert').textContent).toBe(words.refused.CHANGE_IN_PROGRESS)
  })

  it('in the trial, asks for the card before a paid plan and never lets the change go without one', async () => {
    api.loadBilling.mockResolvedValue(read({ subscription: { ...sub, status: 'trial', card: null, plan: { id: 'pro', name: 'Growth Pro' } }, plans: [free, { ...growth, current: false }, { ...pro, current: true }], invoices: { rows: [], next: null } }))
    api.quotePlanChange.mockResolvedValueOnce(quote({ offered: ['NOW'], charge: inr('83300'), credit: inr('0'), today: inr('83300'), nextPrice: inr('83300') }))
    await show(owner)
    expect(plan('Growth Pro').getByText(words.plans.trial)).toBeTruthy()
    expect(screen.getByText(words.invoices.noneTrial)).toBeTruthy()
    fireEvent.click(plan('Growth').getByRole('button', { name: 'Choose Growth' }))
    await settle()
    expect(dialog().getByText('It starts today. Charged today: ₹833.00, then ₹833.00 a month.')).toBeTruthy()
    expect(dialog().getByText(words.change.noCard)).toBeTruthy()
    expect((dialog().getByRole('button', { name: 'Switch to Growth' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('keeps the plan it is on when a smaller one is scheduled', async () => {
    api.loadBilling.mockResolvedValue(read({ subscription: { ...sub, scheduled: { plan: { id: 'free', name: 'Free' }, interval: 'MONTH', at: sub.periodEnd } } }))
    await show(owner)
    expect(screen.getByText('You move to Free on Nov 1, 2026.')).toBeTruthy()
    expect(plan('Free').getByText('From Nov 1, 2026')).toBeTruthy()
    fireEvent.click(plan('Growth').getByRole('button', { name: 'Keep Growth' }))
    expect(dialog().getByText('Your move to Free is called off. You stay on Growth.')).toBeTruthy()
    fireEvent.click(dialog().getByRole('button', { name: 'Keep Growth' }))
    await settle()
    expect(api.quotePlanChange).not.toHaveBeenCalled()
    expect(api.changePlan).toHaveBeenCalledWith('growth', 'MONTH', 'NOW')
  })

  it('saves the details on invoices, checking what it can and keeping the API’s refusal in the dialog', async () => {
    api.saveBillingDetails.mockRejectedValueOnce(new ApiError('INVALID_INPUT', 'bad')).mockResolvedValueOnce({ legalName: 'Kesari', email: 'hello@kesari.example', address: { line1: '14 MG Road', line2: null, city: 'Bengaluru', region: 'KA', postal: '560001', country: 'IN' }, taxId: '29ABCDE1234F1Z5', taxIdKind: 'gstin' })
    await show(owner)
    fireEvent.click(screen.getByRole('button', { name: words.details.editLabel }))
    const form = dialog()
    expect((form.getByLabelText(new RegExp(`^${words.details.form.line1}\\s*$`)) as HTMLInputElement).value).toBe('14 MG Road')
    fireEvent.change(form.getByLabelText(new RegExp(words.details.form.email)), { target: { value: 'not-an-email' } })
    fireEvent.click(form.getByRole('button', { name: words.details.form.save }))
    expect(form.getByRole('alert').textContent).toBe(words.details.form.badEmail)
    fireEvent.change(form.getByLabelText(new RegExp(words.details.form.email)), { target: { value: ' hello@kesari.example ' } })
    fireEvent.change(form.getByLabelText(/GSTIN/), { target: { value: '29ABCDE1234F1Z5' } })
    fireEvent.click(form.getByRole('button', { name: words.details.form.save }))
    await settle()
    expect(form.getByRole('alert').textContent).toBe(words.refused.INVALID_INPUT)
    fireEvent.click(form.getByRole('button', { name: words.details.form.save }))
    await settle()
    expect(api.saveBillingDetails).toHaveBeenLastCalledWith({ legalName: 'Kesari', email: 'hello@kesari.example', address: { line1: '14 MG Road', line2: null, city: 'Bengaluru', region: 'KA', postal: '560001', country: 'IN' }, taxId: '29ABCDE1234F1Z5' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByText('GSTIN: 29ABCDE1234F1Z5')).toBeTruthy()
  })

  it('pages the invoices, exports them all and opens a PDF only at Stripe’s link', async () => {
    api.loadMoreInvoices.mockResolvedValue({ rows: [invoice('i1', 'KC-0001')], next: null })
    api.loadAllInvoices.mockResolvedValue([invoice('i2', 'KC-0002'), invoice('i1', 'KC-0001')])
    api.invoicePdf.mockResolvedValue('https://pay.stripe.com/invoice/x/pdf')
    const replace = vi.fn()
    vi.spyOn(window, 'open').mockReturnValue({ opener: null, location: { replace }, close: vi.fn() } as unknown as Window)
    await show(owner)
    fireEvent.click(screen.getByRole('button', { name: words.invoices.more }))
    await settle()
    expect(api.loadMoreInvoices).toHaveBeenCalledWith('c1')
    expect(screen.getByText('KC-0001')).toBeTruthy()
    expect(screen.queryByRole('button', { name: words.invoices.more })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: words.invoices.exportAll }))
    await settle()
    expect(download.downloadCsv).toHaveBeenCalledWith(expect.stringContaining('KC-0001'), words.invoices.file)
    fireEvent.click(screen.getByRole('button', { name: 'PDF of invoice KC-0002' }))
    await settle()
    expect(api.invoicePdf).toHaveBeenCalledWith('i2')
    expect(replace).toHaveBeenCalledWith('https://pay.stripe.com/invoice/x/pdf')
  })

  it('never lets a late first read replace the one after it', async () => {
    let answer: (r: BillingRead) => void = () => undefined
    api.loadBilling.mockReturnValueOnce(new Promise<BillingRead>((resolve) => (answer = resolve)))
    const router = await show(owner)
    await act(() => router.navigate({ to: '/billing', search: { state: 'trial' } }))
    await settle()
    answer(read())
    await settle()
    expect(screen.getAllByText(words.plans.trial).length).toBe(1)
    expect(screen.queryByText('KC-0002')).toBeNull()
  })
})

describe('who may see and change Billing', () => {
  it('turns away a Manager and a supplier without asking the API', async () => {
    for (const acting of [manager, supplier]) {
      await show(acting)
      expect(screen.getByText(words.denied.title)).toBeTruthy()
      cleanup()
    }
    expect(api.loadBilling).not.toHaveBeenCalled()
  })

  it('lets a support session read but change nothing', async () => {
    await show(owner, { readOnly: true, support: { partnerName: 'Kesari Commerce' } })
    expect(screen.getByText(words.readOnly)).toBeTruthy()
    expect(plan('Growth Pro').queryByRole('button')).toBeNull()
    expect(screen.queryByRole('button', { name: words.details.editLabel })).toBeNull()
  })

  it('while past due, still offers a plan but not the details', async () => {
    api.loadBilling.mockResolvedValue(read({ subscription: { ...sub, status: 'past_due' } }))
    await show(owner, { readOnly: true, support: null })
    expect(plan('Growth Pro').getByRole('button', { name: words.plans.upgrade })).toBeTruthy()
    expect(screen.queryByRole('button', { name: words.details.editLabel })).toBeNull()
  })

  it('offers no plan change where the partner bills, or once the store is closing', async () => {
    api.loadBilling.mockResolvedValueOnce(read({ subscription: { ...sub, collectedBy: 'partner' } })).mockResolvedValueOnce(read({ subscription: { ...sub, cancelAt: sub.periodEnd } }))
    await show(owner)
    expect(screen.getByText(/Kesari Commerce bills you directly/)).toBeTruthy()
    expect(plan('Growth Pro').queryByRole('button')).toBeNull()
    cleanup()
    await show(owner)
    expect(plan('Growth Pro').queryByRole('button')).toBeNull()
  })

  it('says when the store has no plan yet', async () => {
    api.loadBilling.mockResolvedValue(read({ subscription: null }))
    await show(owner)
    expect(screen.getByText(words.noPlan.title)).toBeTruthy()
  })

  it('says the plan didn’t load and reads again on Try again', async () => {
    api.loadBilling.mockRejectedValueOnce(new Error('down'))
    await show(owner)
    expect(screen.getByText(words.error.title)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: words.error.retry }))
    await settle()
    expect(screen.getByText('KC-0002')).toBeTruthy()
  })
})

describe('Close my store', () => {
  const close = async () => {
    fireEvent.click(screen.getByRole('button', { name: words.close.open }))
    return dialog()
  }

  it('restates what closing does to a paid plan, and closes', async () => {
    api.cancelStore.mockRejectedValueOnce(new ApiError('PROVIDER_UNAVAILABLE', 'down')).mockResolvedValueOnce({ ...sub, cancelAt: sub.periodEnd })
    await show(owner)
    const d = await close()
    expect(d.getByText('Kesari')).toBeTruthy()
    expect(d.getByText('Your shop keeps selling until Nov 1, 2026, then goes offline. The portal becomes view-only now.')).toBeTruthy()
    expect(d.getByText(words.close.kept)).toBeTruthy()
    expect(d.getByText('Or move to Free instead and keep selling 10 products.')).toBeTruthy()
    fireEvent.change(d.getByLabelText(words.close.next), { target: { value: 'close' } })
    fireEvent.click(d.getByRole('button', { name: words.close.confirm }))
    await settle()
    expect(d.getByRole('alert').textContent).toBe(words.refused.PROVIDER_UNAVAILABLE)
    fireEvent.click(d.getByRole('button', { name: words.close.confirm }))
    await settle()
    expect(api.cancelStore).toHaveBeenCalledTimes(2)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByRole('status').textContent).toContain('Your store is closing. It sells until Nov 1, 2026.')
    expect(api.loadBilling).toHaveBeenCalledTimes(2)
  })

  it('says a trial closes at once, and offers no free plan the store can’t move to', async () => {
    api.loadBilling.mockResolvedValue(read({ subscription: { ...sub, status: 'trial', collectedBy: 'partner' } }))
    await show(owner)
    const d = await close()
    expect(d.getByText(words.close.now)).toBeTruthy()
    expect(within(d.getByLabelText(words.close.next)).queryByText('Move to Free instead')).toBeNull()
  })

  it('takes the data first: three parts, read back until done, each a download, and the job outlives a reload', async () => {
    api.exportStoreData.mockResolvedValue('x1')
    const part = (kind: 'products' | 'orders' | 'customers', state: 'queued' | 'done') => ({ id: kind, kind, state, rows: state === 'done' ? 2 : null, truncated: false, csv: state === 'done' ? 'a\n1\n2\n' : null, expiresAt: null })
    api.loadStoreDataExport.mockResolvedValueOnce([part('products', 'queued'), part('orders', 'queued'), part('customers', 'queued')]).mockResolvedValue([part('products', 'done'), part('orders', 'done'), part('customers', 'done')])
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      await show(owner)
      const d = await close()
      fireEvent.click(d.getByRole('button', { name: words.close.confirm }))
      await settle()
      expect(api.cancelStore).not.toHaveBeenCalled()
      expect(sessionStorage.getItem('df-store-data-export:s1')).toBe('x1')
      expect(screen.getByText(words.data.preparing)).toBeTruthy()
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3100)
      })
      const panel = within(screen.getByRole('region', { name: words.data.title }))
      expect(panel.getAllByRole('link', { name: words.data.download }).map((a) => a.getAttribute('download'))).toEqual(['store-products.csv', 'store-orders.csv', 'store-customers.csv'])
      expect(panel.queryByText(words.data.preparing)).toBeNull()
    } finally {
      vi.useRealTimers()
    }
    cleanup()
    api.loadStoreDataExport.mockClear()
    await show(owner)
    expect(api.loadStoreDataExport).toHaveBeenCalledWith('x1')
  })

  it('forgets a remembered export the API no longer answers for, so Download my data works again', async () => {
    sessionStorage.setItem('df-store-data-export:s1', 'gone')
    api.loadStoreDataExport.mockResolvedValue([])
    api.loadBilling.mockResolvedValue(read({ subscription: { ...sub, cancelAt: sub.periodEnd } }))
    await show(owner, { readOnly: true, support: null })
    expect(api.loadStoreDataExport).toHaveBeenCalledWith('gone')
    expect(screen.queryByText(words.data.preparing)).toBeNull()
    expect((screen.getByRole('button', { name: words.banners.closing.action }) as HTMLButtonElement).disabled).toBe(false)
    expect(sessionStorage.getItem('df-store-data-export:s1')).toBeNull()
  })

  it('remembers an export per store', async () => {
    sessionStorage.setItem('df-store-data-export:other', 'x9')
    await show(owner)
    expect(api.loadStoreDataExport).not.toHaveBeenCalled()
  })

  it('moves to the free plan instead, from its quote, and goes on to choose what to keep', async () => {
    api.quotePlanChange.mockRejectedValueOnce(new ApiError('AT_PERIOD_END_ONLY', 'later')).mockResolvedValueOnce(quote({ offered: ['PERIOD_END'], charge: inr('0'), credit: inr('0'), today: inr('0'), from: sub.periodEnd, nextPrice: inr('0') }))
    api.changePlan.mockResolvedValue({ ...sub, scheduled: { plan: { id: 'free', name: 'Free' }, interval: 'MONTH', at: sub.periodEnd } })
    const router = await show(owner)
    const d = await close()
    fireEvent.change(d.getByLabelText(words.close.next), { target: { value: 'free' } })
    fireEvent.click(d.getByRole('button', { name: words.close.confirm }))
    await settle()
    expect(api.quotePlanChange).toHaveBeenLastCalledWith('free', 'MONTH', 'PERIOD_END')
    fireEvent.click(dialog().getByRole('button', { name: 'Switch to Free' }))
    await settle()
    expect(api.changePlan).toHaveBeenCalledWith('free', 'MONTH', 'PERIOD_END')
    expect(router.state.location.pathname).toBe('/billing/keep')
  })

  it('once closing, says until when, offers the data and not closing again; a support session gets neither', async () => {
    api.loadBilling.mockResolvedValue(read({ subscription: { ...sub, cancelAt: sub.periodEnd } }))
    await show(owner, { readOnly: true, support: null })
    expect(screen.getByText('Your shop closes on Nov 1, 2026.')).toBeTruthy()
    expect(screen.getByRole('button', { name: words.banners.closing.action })).toBeTruthy()
    expect(screen.queryByRole('button', { name: words.close.open })).toBeNull()
    cleanup()
    await show(owner, { readOnly: true, support: { partnerName: 'Kesari Commerce' } })
    expect(screen.queryByRole('button', { name: words.banners.closing.action })).toBeNull()
    expect(screen.queryByRole('button', { name: words.close.open })).toBeNull()
  })

  it('leads to Choose what to keep from a scheduled change and from the trial', async () => {
    api.loadBilling.mockResolvedValueOnce(read({ subscription: { ...sub, scheduled: { plan: { id: 'free', name: 'Free' }, interval: 'MONTH', at: sub.periodEnd } } })).mockResolvedValueOnce(read({ subscription: { ...sub, status: 'trial' } }))
    await show(owner)
    expect(screen.getByRole('link', { name: words.banners.scheduled.action }).getAttribute('href')).toBe('/billing/keep')
    cleanup()
    await show(owner)
    expect(screen.getByRole('link', { name: 'Or choose what to keep on Free' }).getAttribute('href')).toBe('/billing/keep')
  })
})
