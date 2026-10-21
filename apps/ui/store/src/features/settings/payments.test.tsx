// @vitest-environment happy-dom
import { ApiError } from '@dripfunnel/shared/graphql'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { createMemoryHistory, createRootRoute, createRoute, createRouter, Outlet, RouterProvider } from '@tanstack/react-router'
import { StrictMode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Gateway } from '../../api/payments'
import type { Acting } from '../../api/shell'
import { messages } from '../../messages'
import { settingsSearch } from './settingsSearch'

// Settings › Payment setup driven as the Owner would (SetOps "payments"): Stripe by OAuth, the rest by their keys,
// and the ways paid later; every refusal on the card or dialog it belongs to.

const w = messages.settings.payments

const pay = vi.hoisted(() => ({ loadGateways: vi.fn(), turnOnMethod: vi.fn(), connectKeys: vi.fn(), connectStripe: vi.fn(), finishStripeConnect: vi.fn(), disconnectGateway: vi.fn() }))
vi.mock('../../api/payments', () => pay)
const settings = vi.hoisted(() => ({ loadStoreInfo: vi.fn(), loadLocale: vi.fn() }))
vi.mock('../../api/settings', () => settings)
const accounts = vi.hoisted(() => ({ loadCustomerAccounts: vi.fn(), saveCustomerAccounts: vi.fn() }))
vi.mock('../../api/customerAccounts', async (actual) => ({ ...(await actual<typeof import('../../api/customerAccounts')>()), ...accounts }))

const { SettingsPage } = await import('./SettingsPage')

const owner: Acting = { store: { id: 's1', name: 'Kesari' }, role: 'owner', tier: null, seller: null, plan: null, permissions: ['settings', 'payments.configure'] }
const manager: Acting = { ...owner, role: 'manager', permissions: ['orders.read'] }

const gw = (g: Pick<Gateway, 'provider' | 'label' | 'kind'> & Partial<Gateway>): Gateway => ({ live: false, bankDetails: null, connectable: true, connections: [], ...g })
const live = { mode: 'live' as const, live: true, webhookUrl: null }

const india: Gateway[] = [
  gw({ provider: 'razorpay', label: 'Razorpay', kind: 'gateway' }),
  gw({ provider: 'cashfree', label: 'Cashfree', kind: 'gateway', connections: [{ mode: 'test', live: true, webhookUrl: 'https://hooks.example.com/payments/cashfree/a1' }] }),
  gw({ provider: 'phonepe', label: 'PhonePe', kind: 'gateway', connectable: false }),
  gw({ provider: 'cod', label: 'Cash on delivery', kind: 'other', live: true, connections: [live] }),
  gw({ provider: 'bank_transfer', label: 'Bank transfer', kind: 'other' }),
]
const us: Gateway[] = [gw({ provider: 'stripe', label: 'Stripe', kind: 'gateway' }), gw({ provider: 'paypal', label: 'PayPal', kind: 'gateway' }), gw({ provider: 'bank_transfer', label: 'Bank transfer', kind: 'other' })]
const stripeKey = 'ab'.repeat(32)

const settle = () => act(async () => new Promise((resolve) => setTimeout(resolve, 0)))
const dialog = () => within(document.querySelector('dialog[open]') as HTMLElement)
const region = (name: string) => within(screen.getByRole('region', { name }))

const show = async (search: string, { acting = owner, readOnly = false, strict = false } = {}) => {
  const root = createRootRoute({ component: Outlet })
  const app = createRoute({ getParentRoute: () => root, id: '_app', loader: () => ({ acting, state: { readOnly } }), component: Outlet })
  const page = createRoute({ getParentRoute: () => app, path: '/settings', validateSearch: settingsSearch, component: SettingsPage })
  const router = createRouter({ routeTree: root.addChildren([app.addChildren([page])]), history: createMemoryHistory({ initialEntries: [`/settings?${search}`] }) })
  await act(async () => {
    render(strict ? <StrictMode><RouterProvider router={router} /></StrictMode> : <RouterProvider router={router} />)
  })
  await settle()
  await settle()
  return router
}

beforeEach(() => {
  pay.loadGateways.mockResolvedValue(india)
  settings.loadStoreInfo.mockResolvedValue({ country: 'IN' })
  for (const fn of [pay.turnOnMethod, pay.connectKeys, pay.finishStripeConnect, pay.disconnectGateway]) fn.mockResolvedValue(undefined)
  pay.connectStripe.mockResolvedValue('https://connect.stripe.com/oauth/authorize?client_id=ca_1&state=s')
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.resetAllMocks()
})

describe('the ways to pay', () => {
  it('lists the region’s gateways apart from the ways paid later, each with its state', async () => {
    await show('tab=payments')
    const g = region(w.gatewaysTitle)
    expect(g.getByText('Cards, UPI, netbanking and wallets.')).toBeTruthy()
    expect(g.getByRole('button', { name: 'Connect Razorpay' })).toBeTruthy()
    // Test keys only: the preview storefront pays, the live one doesn't offer it, and its webhook address is given.
    expect(g.getByText(w.testOnly)).toBeTruthy()
    expect(g.getByText('https://hooks.example.com/payments/cashfree/a1')).toBeTruthy()
    expect(g.getByRole('button', { name: 'Change Cashfree’s keys' })).toBeTruthy()
    // Not offered on this platform: said, and nothing to press.
    expect(g.getByText('Connecting PhonePe isn’t set up on this platform yet. Ask your platform’s support.')).toBeTruthy()
    expect(g.queryByRole('button', { name: 'Connect PhonePe' })).toBeNull()
    expect(g.getByText('With more than one live, shoppers pick at checkout. Suggested for India.')).toBeTruthy()
    const o = region(w.otherTitle)
    expect(o.getByText(w.status.live)).toBeTruthy()
    expect(o.getByRole('button', { name: 'Turn off Cash on delivery' })).toBeTruthy()
    expect(o.getByRole('button', { name: 'Set up Bank transfer' })).toBeTruthy()
  })

  it('says when the store’s country has no way to pay', async () => {
    pay.loadGateways.mockResolvedValue([])
    await show('tab=payments')
    expect(screen.getByText(w.emptyTitle)).toBeTruthy()
  })

  it('lets a read-only store look without changing anything', async () => {
    await show('tab=payments', { readOnly: true })
    expect(region(w.gatewaysTitle).getByText('Razorpay')).toBeTruthy()
    expect(screen.queryAllByRole('button', { name: /Connect|Turn off|Set up|Disconnect|Change/ })).toHaveLength(0)
  })

  it('reads nothing for anyone but the Owner', async () => {
    await show('tab=payments', { acting: manager })
    expect(screen.getByText(messages.settings.denied.title)).toBeTruthy()
    expect(pay.loadGateways).not.toHaveBeenCalled()
  })

  it('never shows an earlier tab’s late answer over the one opened since', async () => {
    let answer: (g: Gateway[]) => void = () => undefined
    pay.loadGateways.mockReturnValueOnce(new Promise((resolve) => (answer = resolve)))
    accounts.loadCustomerAccounts.mockResolvedValue({ mode: 'both', customers: 3, withEmail: 2, withPhone: 2, phoneOnly: 1 })
    const router = await show('tab=payments')
    await act(async () => router.navigate({ to: '/settings', search: { tab: 'customers' } }))
    await settle()
    await act(async () => answer(india))
    await settle()
    expect(screen.getByRole('heading', { name: messages.settings.customers.title })).toBeTruthy()
    expect(screen.queryByText(w.gatewaysTitle)).toBeNull()
  })
})

describe('Stripe, by OAuth', () => {
  beforeEach(() => {
    pay.loadGateways.mockResolvedValue(us)
    settings.loadStoreInfo.mockResolvedValue({ country: 'US' })
  })

  it('sends the Owner to Stripe’s https address to approve the app', async () => {
    const assign = vi.spyOn(window.location, 'assign').mockImplementation(() => undefined)
    let answer: (url: string) => void = () => undefined
    pay.connectStripe.mockReturnValueOnce(new Promise((resolve) => (answer = resolve)))
    await show('tab=payments')
    fireEvent.click(screen.getByRole('button', { name: 'Connect Stripe' }))
    expect(dialog().getByText(/You sign in to Stripe and approve/)).toBeTruthy()
    fireEvent.click(dialog().getByRole('button', { name: w.stripeGo }))
    await settle()
    expect(region(w.gatewaysTitle).getByRole('button', { name: 'Connect Stripe' }).textContent).toBe(w.connecting)
    await act(async () => answer('https://connect.stripe.com/oauth/authorize?state=s'))
    expect(assign).toHaveBeenCalledWith('https://connect.stripe.com/oauth/authorize?state=s')
  })

  it('never follows an address that isn’t https', async () => {
    const assign = vi.spyOn(window.location, 'assign').mockImplementation(() => undefined)
    pay.connectStripe.mockResolvedValueOnce('javascript:alert(1)')
    await show('tab=payments')
    fireEvent.click(screen.getByRole('button', { name: 'Connect Stripe' }))
    fireEvent.click(dialog().getByRole('button', { name: w.stripeGo }))
    await settle()
    expect(assign).not.toHaveBeenCalled()
    expect(region(w.gatewaysTitle).getByRole('alert').textContent).toBe(w.stripeBadLink)
    expect(region(w.gatewaysTitle).getByRole('button', { name: 'Connect Stripe' }).textContent).toBe(w.connect)
  })

  it.each(['NOT_AVAILABLE', 'SUPPORT_SESSION'] as const)('says why starting was refused (%s), on the gateways card', async (code) => {
    pay.connectStripe.mockRejectedValueOnce(new ApiError(code, code))
    await show('tab=payments')
    fireEvent.click(screen.getByRole('button', { name: 'Connect Stripe' }))
    fireEvent.click(dialog().getByRole('button', { name: w.stripeGo }))
    await settle()
    expect(region(w.gatewaysTitle).getByRole('alert').textContent).toBe(w.refused[code])
    expect(within(screen.getByRole('region', { name: w.otherTitle })).queryByRole('alert')).toBeNull()
  })

  it('finishes the way back once, even mounted twice, with the key gone from the address', async () => {
    pay.loadGateways.mockResolvedValueOnce(us).mockResolvedValueOnce(us).mockResolvedValue([{ ...us[0], live: true, connections: [live] } as Gateway, ...us.slice(1)])
    const router = await show(`tab=payments&stripe=finish&key=${stripeKey}`, { strict: true })
    await settle()
    expect(pay.finishStripeConnect).toHaveBeenCalledExactlyOnceWith(stripeKey)
    expect(router.state.location.search).toEqual({ tab: 'payments' })
    expect(screen.getByText(w.stripeConnected)).toBeTruthy()
    expect(region(w.gatewaysTitle).getByRole('button', { name: 'Disconnect Stripe' })).toBeTruthy()
  })

  it.each(['EXPIRED', 'ACCOUNT_IN_USE', 'SUPPORT_SESSION'] as const)('says why the way back was refused (%s) and reads nothing again', async (code) => {
    pay.finishStripeConnect.mockRejectedValueOnce(new ApiError(code, code))
    // A key each: the tab sends each one-time key once.
    const key = { EXPIRED: 'c', ACCOUNT_IN_USE: 'd', SUPPORT_SESSION: 'e' }[code].repeat(64)
    await show(`tab=payments&stripe=finish&key=${key}`)
    expect(pay.finishStripeConnect).toHaveBeenCalledWith(key)
    expect(region(w.gatewaysTitle).getByRole('alert').textContent).toBe(w.refused[code])
    expect(pay.loadGateways).toHaveBeenCalledOnce()
  })

  it('tells a cancel apart from a failure, sending nothing to the API for either', async () => {
    await show('tab=payments&stripe=cancelled')
    expect(region(w.gatewaysTitle).getByRole('status').textContent).toBe(w.stripeCancelled)
    cleanup()
    await show('tab=payments&stripe=failed')
    expect(region(w.gatewaysTitle).getByRole('alert').textContent).toBe(w.stripeFailed)
    expect(pay.finishStripeConnect).not.toHaveBeenCalled()
  })

  it('ignores a key that isn’t a one-time key’s shape, as a failed way back', async () => {
    await show('tab=payments&stripe=finish&key=nothex')
    expect(pay.finishStripeConnect).not.toHaveBeenCalled()
    expect(region(w.gatewaysTitle).getByRole('alert').textContent).toBe(w.stripeFailed)
  })

  it('disconnects after saying what stops', async () => {
    pay.loadGateways.mockResolvedValue([{ ...us[0], live: true, connections: [live] } as Gateway, ...us.slice(1)])
    await show('tab=payments')
    fireEvent.click(screen.getByRole('button', { name: 'Disconnect Stripe' }))
    expect(dialog().getByText(w.disconnectBody)).toBeTruthy()
    fireEvent.click(dialog().getByRole('button', { name: w.disconnect }))
    await settle()
    expect(pay.disconnectGateway).toHaveBeenCalledWith('stripe')
    expect(screen.getByText('Stripe disconnected')).toBeTruthy()
  })
})

describe('a provider’s own keys', () => {
  const type = (label: string, value: string) => fireEvent.change(dialog().getByLabelText(label), { target: { value } })

  it('waits for every key, sends them for the mode chosen, secrets masked', async () => {
    await show('tab=payments')
    fireEvent.click(screen.getByRole('button', { name: 'Connect Razorpay' }))
    const connect = dialog().getByRole('button', { name: w.connect }) as HTMLButtonElement
    expect(connect.disabled).toBe(true)
    expect(dialog().getByText(w.keysMissing)).toBeTruthy()
    expect((dialog().getByLabelText(w.fields.keySecret) as HTMLInputElement).type).toBe('password')
    type(w.fields.keyId, ' rzp_test_abc123 ')
    type(w.fields.keySecret, 'secret')
    type(w.fields.webhookSecret, 'hook')
    fireEvent.change(dialog().getByLabelText(w.keysMode), { target: { value: 'test' } })
    fireEvent.click(connect)
    await settle()
    expect(pay.connectKeys).toHaveBeenCalledWith('razorpay', 'test', { keyId: 'rzp_test_abc123', keySecret: 'secret', webhookSecret: 'hook' })
    expect(screen.getByText('Razorpay test keys saved — your preview storefront takes test payments')).toBeTruthy()
    expect(document.querySelector('dialog[open]')).toBeNull()
  })

  it('keeps the dialog open with the refusal, and never puts it on a card; it opens again clean', async () => {
    pay.connectKeys.mockRejectedValueOnce(new ApiError('KEYS_REFUSED', 'no'))
    await show('tab=payments')
    fireEvent.click(screen.getByRole('button', { name: 'Connect Razorpay' }))
    type(w.fields.keyId, 'rzp_live_abc123')
    type(w.fields.keySecret, 'secret')
    type(w.fields.webhookSecret, 'hook')
    fireEvent.click(dialog().getByRole('button', { name: w.connect }))
    await settle()
    expect(dialog().getByRole('alert').textContent).toBe(w.refused.KEYS_REFUSED)
    expect((dialog().getByLabelText(w.fields.keyId) as HTMLInputElement).value).toBe('rzp_live_abc123')
    expect(within(screen.getByRole('region', { name: w.gatewaysTitle, hidden: true })).queryByText(w.refused.KEYS_REFUSED, { selector: 'p.df-set-failure' })).toBeNull()
    fireEvent.click(dialog().getByRole('button', { name: w.cancel }))
    fireEvent.click(screen.getByRole('button', { name: 'Connect Razorpay' }))
    expect(dialog().queryByRole('alert')).toBeNull()
    expect((dialog().getByLabelText(w.fields.keyId) as HTMLInputElement).value).toBe('')
  })

  it('opens changing a test-only provider’s keys on the test mode', async () => {
    await show('tab=payments')
    fireEvent.click(screen.getByRole('button', { name: 'Change Cashfree’s keys' }))
    expect((dialog().getByLabelText(w.keysMode) as HTMLSelectElement).value).toBe('test')
    expect(dialog().getByLabelText(w.fields.appId)).toBeTruthy()
  })
})

describe('the ways paid later', () => {
  it('turns cash on delivery on after saying what it means', async () => {
    pay.loadGateways.mockResolvedValue(india.map((g) => (g.provider === 'cod' ? { ...g, live: false, connections: [] } : g)))
    await show('tab=payments')
    fireEvent.click(screen.getByRole('button', { name: 'Set up Cash on delivery' }))
    fireEvent.click(dialog().getByRole('button', { name: w.turnOn }))
    await settle()
    expect(pay.turnOnMethod).toHaveBeenCalledWith('cod', null)
    expect(screen.getByText('Cash on delivery is on at checkout')).toBeTruthy()
  })

  it('asks a bank transfer for the details shoppers pay to', async () => {
    await show('tab=payments')
    fireEvent.click(screen.getByRole('button', { name: 'Set up Bank transfer' }))
    const on = dialog().getByRole('button', { name: w.turnOn }) as HTMLButtonElement
    expect(on.disabled).toBe(true)
    fireEvent.change(dialog().getByLabelText(w.bankLabel), { target: { value: ' Kesari Threads, 0012345, HDFC0001 ' } })
    fireEvent.click(on)
    await settle()
    expect(pay.turnOnMethod).toHaveBeenCalledWith('bank_transfer', 'Kesari Threads, 0012345, HDFC0001')
  })

  it('says the only way to get paid can’t go, on its own card', async () => {
    pay.disconnectGateway.mockRejectedValueOnce(new ApiError('LAST_METHOD', 'last'))
    await show('tab=payments')
    fireEvent.click(screen.getByRole('button', { name: 'Turn off Cash on delivery' }))
    fireEvent.click(dialog().getByRole('button', { name: w.turnOff }))
    await settle()
    expect(region(w.otherTitle).getByRole('alert').textContent).toBe(w.refused.LAST_METHOD)
    expect(region(w.gatewaysTitle).queryByRole('alert')).toBeNull()
  })
})
