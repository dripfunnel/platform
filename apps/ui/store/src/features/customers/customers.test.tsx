// @vitest-environment happy-dom
import { ApiError } from '@dripfunnel/shared/graphql'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { createMemoryHistory, createRootRoute, createRoute, createRouter, Outlet, RouterProvider } from '@tanstack/react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import type { Customer, CustomerGroup, CustomerSummary } from '../../api/customers'
import type { Acting } from '../../api/shell'
import { messages } from '../../messages'
import { consentOf, customersAccessOf } from './customerView'

// Customers driven as the team would (FIRST-RELEASE §7): who sees what, and what search, groups, tags, notes, consent,
// adding, editing and export send.

const words = messages.customers

const api = vi.hoisted(() => ({
  loadCustomers: vi.fn(),
  loadCustomerCount: vi.fn(),
  loadCustomerGroups: vi.fn(),
  loadCustomer: vi.fn(),
  addCustomer: vi.fn(),
  updateCustomer: vi.fn(),
  setCustomerTags: vi.fn(),
  setCustomerNote: vi.fn(),
  recordMarketingStop: vi.fn(),
  setCustomerGroups: vi.fn(),
  createGroup: vi.fn(),
  renameGroup: vi.fn(),
  deleteGroup: vi.fn(),
  requestCustomerExport: vi.fn(),
  loadCustomerExport: vi.fn(),
}))
vi.mock('../../api/customers', async (actual) => ({ ...(await actual<typeof import('../../api/customers')>()), ...api }))
const orderApi = vi.hoisted(() => ({ loadStoreTimeZone: vi.fn() }))
vi.mock('../../api/orders', async (actual) => ({ ...(await actual<typeof import('../../api/orders')>()), ...orderApi }))

const { CustomersPage } = await import('./CustomersPage')

const inr = (amount: string) => [{ amount, currency: 'INR' }]
const ananyaRow: CustomerSummary = { id: 'c1', name: 'Ananya Rao', email: 'ananya@example.in', phone: '+91 98450 12345', city: 'Bengaluru', tags: ['Repeat'], orders: 3, spent: inr('1229100') }
const vikramRow: CustomerSummary = { id: 'c4', name: 'Vikram Shah', email: 'vikram@example.in', phone: null, city: null, tags: [], orders: 0, spent: [] }
const vip: CustomerGroup = { id: 'g1', name: 'VIP', description: null, members: 2 }
const wholesale: CustomerGroup = { id: 'g2', name: 'Wholesale', description: 'Trade prices', members: 1 }

const ananya: Customer = {
  id: 'c1',
  name: 'Ananya Rao',
  email: 'ananya@example.in',
  phone: '+91 98450 12345',
  phoneVerified: false,
  tags: ['Repeat'],
  note: 'Prefers gift wrap',
  consent: { state: 'opted_in', at: '2026-09-27T04:42:00.000Z', source: 'checkout', channels: ['email'] },
  groupIds: ['g1'],
  addresses: [{ id: 'a1', name: 'Ananya Rao', line1: '14 3rd Cross', line2: null, city: 'Bengaluru', region: 'KA', postalCode: '560038', country: 'IN', phone: null, isDefault: true }],
  city: 'Bengaluru',
  ordersCount: 3,
  orders: [{ id: 'o1', number: 'KT-1042', placedAt: '2026-10-10T07:30:00.000Z', state: 'placed', paymentState: 'paid', fulfilmentState: 'unfulfilled', total: { amount: '579600', currency: 'INR' } }],
  spent: inr('1229100'),
}

const owner: Acting = { store: { id: 's1', name: 'Kesari Threads' }, role: 'owner', tier: null, seller: null, plan: null, permissions: ['customers.read', 'customers.write', 'customers.export'] }
const staff: Acting = { ...owner, role: 'staff' }
const supplier: Acting = { ...owner, role: 'supplier-member', tier: 'vendor-orders-fulfil', seller: { id: 'v1', name: 'Northwind Textiles' }, permissions: ['orders.read'] }

const show = async (acting: Acting, { readOnly = false, entry = '/customers' } = {}) => {
  const root = createRootRoute({ component: Outlet })
  const app = createRoute({ getParentRoute: () => root, id: '_app', loader: () => ({ acting, state: { readOnly } }), component: Outlet })
  const page = createRoute({ getParentRoute: () => app, path: '/customers', validateSearch: z.object({ customer: z.string().optional() }), component: CustomersPage })
  const order = createRoute({ getParentRoute: () => app, path: '/orders/$orderId', component: () => null })
  const router = createRouter({ routeTree: root.addChildren([app.addChildren([page, order])]), history: createMemoryHistory({ initialEntries: [entry] }) })
  await act(async () => {
    render(<RouterProvider router={router} />)
  })
  await settle()
  return router
}

const settle = (ms = 0) => act(async () => new Promise((resolve) => setTimeout(resolve, ms)))
const detail = () => within(screen.getByRole('region', { name: 'Ananya Rao' }))

beforeEach(() => {
  api.loadCustomers.mockResolvedValue({ rows: [ananyaRow, vikramRow], next: null, previous: null })
  api.loadCustomerCount.mockResolvedValue(2)
  api.loadCustomerGroups.mockResolvedValue([vip, wholesale])
  api.loadCustomer.mockImplementation(async (id: string) => (id === 'c1' ? ananya : { ...ananya, id: 'c4', name: 'Vikram Shah', tags: [], groupIds: [], note: null, orders: [], ordersCount: 0, spent: [], addresses: [], consent: { state: 'not_asked', at: null, source: 'added_by_hand', channels: [] } }))
  orderApi.loadStoreTimeZone.mockResolvedValue('Asia/Kolkata')
  for (const write of [api.updateCustomer, api.setCustomerNote, api.recordMarketingStop, api.setCustomerGroups, api.renameGroup, api.deleteGroup]) write.mockResolvedValue(undefined)
  api.setCustomerTags.mockImplementation(async (_: string, tags: string[]) => tags)
  api.createGroup.mockResolvedValue('g3')
})

afterEach(() => {
  cleanup()
  vi.resetAllMocks()
})

describe('what Customers works out', () => {
  it('gives the team the list and its changes, Staff included, and a read-only store no changes', () => {
    expect(customersAccessOf(owner, false)).toEqual({ canRead: true, canEdit: true, canExport: true, readOnly: false })
    expect(customersAccessOf(staff, false)).toEqual({ canRead: true, canEdit: true, canExport: true, readOnly: false })
    expect(customersAccessOf(owner, true)).toMatchObject({ canEdit: false, readOnly: true })
    expect(customersAccessOf(supplier, false).canRead).toBe(false)
  })

  it('words consent as the shopper gave it, and what the team may still record', () => {
    expect(consentOf(ananya, 'Asia/Kolkata')).toEqual({ text: words.detail.consent.opted_in, sub: 'Since Sep 27, 2026 · Checkout. Only the shopper can opt in — from checkout or their email.', yes: true })
    expect(consentOf({ ...ananya, consent: { state: 'opted_in', at: '2026-09-27T04:42:00.000Z', source: 'email', channels: ['email', 'sms'] } }, 'UTC').text).toBe(words.detail.consent.opted_in_sms)
    expect(consentOf({ ...ananya, consent: { state: 'stopped', at: '2026-10-01T04:42:00.000Z', source: 'recorded_by_store', channels: [] } }, 'UTC')).toMatchObject({ text: words.detail.consent.stopped, yes: false })
    expect(consentOf({ ...ananya, consent: { state: 'not_asked', at: null, source: 'added_by_hand', channels: [] } }, 'UTC').sub).toBe(words.detail.consent.byHand)
  })
})

describe('the Customers screen', () => {
  it('lists everyone with their city, tags, spend and orders, and opens the first with its groups, tags, note and consent', async () => {
    await show(owner)
    expect(screen.getByRole('tab', { name: 'People · 2' }).getAttribute('aria-selected')).toBe('true')
    const rows = within(screen.getByRole('list', { name: words.list.label })).getAllByRole('button')
    expect(rows[0]?.textContent).toContain('Bengaluru · Repeat')
    expect(rows[0]?.textContent).toContain('₹12,291.00')
    expect(rows[0]?.textContent).toContain('3 orders')
    expect(rows[1]?.textContent).toContain('vikram@example.in')
    expect(rows[1]?.textContent).toContain(words.row.noOrders)
    expect(rows[0]?.getAttribute('aria-current')).toBe('true')
    expect(detail().getByText('₹12,291.00 spent')).toBeTruthy()
    expect(detail().getByRole('button', { name: '✓ VIP' }).getAttribute('aria-pressed')).toBe('true')
    expect(detail().getByText(words.detail.consent.opted_in)).toBeTruthy()
    expect(detail().getByRole('link', { name: /KT-1042/ }).getAttribute('href')).toBe('/orders/o1')
    expect(api.loadCustomers).toHaveBeenCalledWith(null, '', {})
    expect(api.loadCustomer).toHaveBeenCalledWith('c1')
  })

  it('shows the customer clicked last, whatever order the answers come in', async () => {
    let answerVikram: (c: Customer) => void = () => undefined
    await show(owner)
    api.loadCustomer.mockImplementation((id: string) => (id === 'c4' ? new Promise<Customer>((resolve) => (answerVikram = resolve)) : Promise.resolve(ananya)))
    const rows = () => within(screen.getByRole('list', { name: words.list.label })).getAllByRole('button')
    fireEvent.click(rows()[1] as HTMLElement)
    await settle()
    fireEvent.click(rows()[0] as HTMLElement)
    await settle()
    answerVikram({ ...ananya, id: 'c4', name: 'Vikram Shah' })
    await settle()
    expect(screen.getByRole('region', { name: 'Ananya Rao' })).toBeTruthy()
    expect(screen.queryByRole('region', { name: 'Vikram Shah' })).toBeNull()
  })

  it('moves between People and Groups with the arrow keys, Home and End, as the tabs pattern does', async () => {
    await show(owner)
    const people = screen.getByRole('tab', { name: 'People · 2' })
    const groupsTab = screen.getByRole('tab', { name: 'Groups · 2' })
    expect(people.getAttribute('tabindex')).toBe('0')
    expect(groupsTab.getAttribute('tabindex')).toBe('-1')
    expect(screen.getByRole('tabpanel').getAttribute('aria-labelledby')).toBe(people.id)
    fireEvent.keyDown(people, { key: 'ArrowRight' })
    expect(groupsTab.getAttribute('aria-selected')).toBe('true')
    expect(document.activeElement).toBe(groupsTab)
    expect(screen.getByRole('tabpanel').getAttribute('aria-labelledby')).toBe(groupsTab.id)
    fireEvent.keyDown(groupsTab, { key: 'Home' })
    expect(people.getAttribute('aria-selected')).toBe('true')
    fireEvent.keyDown(people, { key: 'ArrowLeft' })
    expect(groupsTab.getAttribute('aria-selected')).toBe('true')
  })

  it('reads the count and groups once, not again for every search', async () => {
    await show(owner)
    fireEvent.change(screen.getByRole('searchbox', { name: words.search.label }), { target: { value: 'rao' } })
    await settle(350)
    expect(api.loadCustomers).toHaveBeenLastCalledWith(null, 'rao', {})
    expect(api.loadCustomerCount).toHaveBeenCalledTimes(1)
    expect(api.loadCustomerGroups).toHaveBeenCalledTimes(1)
  })

  it('searches, filters by a group, and opens the customer a link names', async () => {
    await show(owner, { entry: '/customers?customer=c4' })
    expect(screen.getByRole('region', { name: 'Vikram Shah' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Wholesale · 1' }))
    await settle()
    expect(api.loadCustomers).toHaveBeenLastCalledWith('g2', '', {})
    fireEvent.change(screen.getByRole('searchbox', { name: words.search.label }), { target: { value: 'repeat' } })
    await settle(350)
    expect(api.loadCustomers).toHaveBeenLastCalledWith('g2', 'repeat', {})
  })

  it('puts a customer in a group and takes them out', async () => {
    await show(owner)
    fireEvent.click(detail().getByRole('button', { name: '+ Wholesale' }))
    await settle()
    expect(api.setCustomerGroups).toHaveBeenCalledWith('c1', ['g1', 'g2'])
    expect(screen.getByText('Ananya Rao added to Wholesale — offers for this group apply to them now')).toBeTruthy()
    fireEvent.click(detail().getByRole('button', { name: '✓ VIP' }))
    await settle()
    expect(api.setCustomerGroups).toHaveBeenLastCalledWith('c1', [])
  })

  it('adds and removes a tag, and saves the team’s note', async () => {
    await show(owner)
    fireEvent.click(detail().getByRole('button', { name: words.detail.addTag }))
    const dialog = within(screen.getByRole('dialog'))
    fireEvent.change(dialog.getByRole('textbox', { name: words.detail.tag.label }), { target: { value: ' Press ' } })
    fireEvent.click(dialog.getByRole('button', { name: words.detail.tag.confirm }))
    await settle()
    expect(api.setCustomerTags).toHaveBeenCalledWith('c1', ['Repeat', 'Press'])
    fireEvent.click(detail().getByRole('button', { name: 'Remove tag Repeat' }))
    await settle()
    expect(api.setCustomerTags).toHaveBeenLastCalledWith('c1', [])
    const note = detail().getByRole('textbox', { name: /^Note/ })
    expect(detail().queryByRole('button', { name: words.detail.saveNote })).toBeNull()
    fireEvent.change(note, { target: { value: 'Prefers gift wrap. Calls first.' } })
    fireEvent.click(detail().getByRole('button', { name: words.detail.saveNote }))
    await settle()
    expect(api.setCustomerNote).toHaveBeenCalledWith('c1', 'Prefers gift wrap. Calls first.')
  })

  it('records that they asked to stop marketing, after saying what it means', async () => {
    await show(owner)
    fireEvent.click(detail().getByRole('button', { name: words.detail.consent.stop }))
    const dialog = within(screen.getByRole('dialog'))
    expect(dialog.getByText(words.detail.consent.stopBody)).toBeTruthy()
    fireEvent.click(dialog.getByRole('button', { name: words.detail.consent.stopConfirm }))
    await settle()
    expect(api.recordMarketingStop).toHaveBeenCalledWith('c1')
    expect(screen.getByText('Recorded — no more marketing to Ananya Rao')).toBeTruthy()
  })

  it('edits their details, the address whole or not at all, and words a refusal', async () => {
    await show(owner)
    fireEvent.click(detail().getByRole('button', { name: words.detail.edit }))
    const form = within(screen.getByRole('region', { name: 'Edit Ananya Rao' }))
    fireEvent.change(form.getByRole('textbox', { name: words.editForm.city }), { target: { value: '' } })
    fireEvent.click(form.getByRole('button', { name: words.editForm.save }))
    expect(form.getByRole('alert').textContent).toBe(words.editForm.addressPartial)
    fireEvent.change(form.getByRole('textbox', { name: words.editForm.city }), { target: { value: 'Mysuru' } })
    fireEvent.change(form.getByRole('textbox', { name: words.editForm.phone }), { target: { value: '+91 90000 00000' } })
    api.updateCustomer.mockRejectedValueOnce(new ApiError('VERIFIED', 'no'))
    fireEvent.click(form.getByRole('button', { name: words.editForm.save }))
    await settle()
    expect(screen.getByText(words.refused.VERIFIED)).toBeTruthy()
    fireEvent.click(form.getByRole('button', { name: words.editForm.save }))
    await settle()
    expect(api.updateCustomer).toHaveBeenLastCalledWith('c1', { name: 'Ananya Rao', phone: '+91 90000 00000', address: { name: 'Ananya Rao', line1: '14 3rd Cross', line2: null, city: 'Mysuru', region: 'KA', postalCode: '560038', country: 'IN' } })
    expect(screen.queryByRole('region', { name: 'Edit Ananya Rao' })).toBeNull()
  })

  it('adds a customer by hand, and opens the one already there for that email', async () => {
    api.addCustomer.mockResolvedValue({ id: 'c4', existed: true })
    await show(owner)
    fireEvent.click(screen.getByRole('button', { name: words.add }))
    const form = within(screen.getByRole('region', { name: words.addForm.title }))
    fireEvent.change(form.getByRole('textbox', { name: words.addForm.name }), { target: { value: 'Vikram Shah' } })
    fireEvent.change(form.getByRole('textbox', { name: words.addForm.email }), { target: { value: 'not-an-email' } })
    fireEvent.click(form.getByRole('button', { name: words.addForm.confirm }))
    expect(form.getByRole('alert').textContent).toBe(words.addForm.emailInvalid)
    fireEvent.change(form.getByRole('textbox', { name: words.addForm.email }), { target: { value: 'Vikram@Example.in' } })
    fireEvent.click(form.getByRole('button', { name: words.addForm.confirm }))
    await settle()
    expect(api.addCustomer).toHaveBeenCalledWith('Vikram Shah', 'vikram@example.in', null)
    expect(screen.getByText('Vikram Shah is already a customer — opened them')).toBeTruthy()
    expect(screen.getByRole('region', { name: 'Vikram Shah' })).toBeTruthy()
  })

  it('makes, renames and deletes groups, saying who leaves', async () => {
    await show(owner)
    fireEvent.click(screen.getByRole('tab', { name: 'Groups · 2' }))
    const list = within(screen.getByRole('list', { name: words.groups.target }))
    expect(list.getByText('1 person · Trade prices')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: words.groups.add }))
    let dialog = within(screen.getByRole('dialog'))
    fireEvent.change(dialog.getByRole('textbox', { name: words.groups.nameLabel }), { target: { value: 'VIP' } })
    api.createGroup.mockRejectedValueOnce(new ApiError('NAME_TAKEN', 'taken'))
    fireEvent.click(dialog.getByRole('button', { name: words.groups.make }))
    await settle()
    expect(dialog.getByText(words.refused.NAME_TAKEN)).toBeTruthy()
    fireEvent.change(dialog.getByRole('textbox', { name: words.groups.nameLabel }), { target: { value: 'Press' } })
    fireEvent.click(dialog.getByRole('button', { name: words.groups.make }))
    await settle()
    expect(api.createGroup).toHaveBeenLastCalledWith('Press')
    fireEvent.click(within(screen.getByRole('list', { name: words.groups.target })).getAllByRole('button', { name: words.groups.delete })[0] as HTMLElement)
    dialog = within(screen.getByRole('dialog'))
    expect(dialog.getByText('2 people leave the group. Offers for VIP stop applying to them.')).toBeTruthy()
    fireEvent.click(dialog.getByRole('button', { name: words.groups.deleteConfirm }))
    await settle()
    expect(api.deleteGroup).toHaveBeenCalledWith('g1')
    fireEvent.click(within(screen.getByRole('list', { name: words.groups.target })).getAllByRole('button', { name: words.groups.seePeople })[1] as HTMLElement)
    await settle()
    expect(api.loadCustomers).toHaveBeenLastCalledWith('g2', '', {})
  })

  it('shows Staff the spend the API and its export give them (ACCESS §5.1), a read-only store no changes, and a supplier nothing', async () => {
    await show(staff)
    expect(within(screen.getByRole('list', { name: words.list.label })).getAllByRole('button')[0]?.textContent).toContain('₹12,291.00')
    expect(detail().getByText('₹12,291.00 spent')).toBeTruthy()
    cleanup()
    await show(owner, { readOnly: true })
    expect(screen.getByText(words.readOnly)).toBeTruthy()
    expect(screen.queryByRole('button', { name: words.add })).toBeNull()
    expect((detail().getByRole('button', { name: '✓ VIP' }) as HTMLButtonElement).disabled).toBe(true)
    expect(detail().queryByRole('button', { name: words.detail.consent.stop })).toBeNull()
    cleanup()
    api.loadCustomer.mockClear()
    await show(supplier, { entry: '/customers?customer=c1' })
    expect(screen.getByRole('heading', { name: words.denied.title })).toBeTruthy()
    expect(api.loadCustomers).toHaveBeenCalledTimes(2)
    expect(api.loadCustomer).not.toHaveBeenCalled()
  })

  it('greets a new store with its empty state, and shows the error state with a retry', async () => {
    api.loadCustomers.mockResolvedValue({ rows: [], next: null, previous: null })
    api.loadCustomerCount.mockResolvedValue(0)
    await show(owner)
    expect(screen.getByText(words.empty)).toBeTruthy()
    cleanup()
    api.loadCustomers.mockRejectedValueOnce(new Error('offline'))
    await show(owner)
    expect(screen.getByRole('heading', { name: words.error.title })).toBeTruthy()
  })

  it('exports the list as it is searched and filtered', async () => {
    api.requestCustomerExport.mockResolvedValue({ id: 'x2', state: 'preparing', entries: null, url: null, expiresAt: null })
    await show(owner)
    fireEvent.click(screen.getByRole('button', { name: 'VIP · 2' }))
    await settle()
    fireEvent.click(screen.getByRole('button', { name: words.export.button }))
    await settle()
    expect(api.requestCustomerExport).toHaveBeenCalledWith('g1', '')
    expect(screen.getByText(words.export.preparing)).toBeTruthy()
  })
})
