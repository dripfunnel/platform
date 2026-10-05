// @vitest-environment happy-dom
import { ApiError } from '@dripfunnel/shared/graphql'
import { optionalParam } from '@dripfunnel/shared/search'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { createMemoryHistory, createRootRoute, createRoute, createRouter, Outlet, RouterProvider } from '@tanstack/react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import type { Acting } from '../../api/shell'
import type { Person, Supplier } from '../../api/team'
import { messages } from '../../messages'

// Settings › People and Supplier driven as the Owner would (SetTeam).

const w = messages.settings.team

const api = vi.hoisted(() => ({
  loadPeople: vi.fn(),
  inviteMember: vi.fn(),
  resendInvitation: vi.fn(),
  revokeInvitation: vi.fn(),
  changeRole: vi.fn(),
  removeMember: vi.fn(),
  loadSuppliers: vi.fn(),
  loadApproval: vi.fn(),
  setApproval: vi.fn(),
  inviteSupplier: vi.fn(),
  setSupplierAccess: vi.fn(),
  setShippingMode: vi.fn(),
  suspendSupplier: vi.fn(),
  resumeSupplier: vi.fn(),
  removeSupplier: vi.fn(),
  addSupplierPerson: vi.fn(),
}))
vi.mock('../../api/team', async (actual) => ({ ...(await actual<typeof import('../../api/team')>()), ...api }))
vi.mock('../../api/settings', () => ({ loadStoreInfo: vi.fn(), loadLocale: vi.fn() }))

const { SettingsPage } = await import('./SettingsPage')

const owner: Acting = { store: { id: 's1', name: 'Kesari' }, role: 'owner', tier: null, seller: null, plan: null, permissions: ['catalog.read', 'settings'] }

const person = (p: Partial<Person> & Pick<Person, 'id' | 'email'>): Person => ({ kind: 'member', name: null, role: 'staff', you: false, since: '2026-08-01T09:00:00Z', expiresAt: null, expired: false, ...p })
const people = [
  person({ id: 'm1', email: 'farhan@k.in', name: 'Farhan Ali', role: 'owner', you: true }),
  person({ id: 'm2', email: 'meera@k.in', name: 'Meera Joshi', role: 'manager' }),
  person({ id: 'i1', email: 'asha@example.com', kind: 'invitation', expiresAt: '2026-10-11T09:00:00Z' }),
]
const supplier = (s: Partial<Supplier> & Pick<Supplier, 'id' | 'name'>): Supplier => ({ accessLevel: 'vendor-catalogue', shippingMode: 'to-store', labelAccount: 'store', status: 'active', users: 1, products: 4, ...s })
const suppliers = [supplier({ id: 'v1', name: 'Northwind Textiles', users: 2, products: 14 }), supplier({ id: 'v3', name: 'Moradabad Brass', status: 'suspended', accessLevel: 'vendor-stock', products: 3 })]

const settle = () => act(async () => new Promise((resolve) => setTimeout(resolve, 0)))
const dialog = () => within(document.querySelector('dialog') as HTMLElement)
const pick = (value: string) => fireEvent.change(dialog().getAllByRole('combobox')[0] as HTMLElement, { target: { value } })
const confirm = (name: string) => fireEvent.click(dialog().getByRole('button', { name }))

const show = async (tab: 'people' | 'supplier', readOnly = false) => {
  const root = createRootRoute({ component: Outlet })
  const app = createRoute({ getParentRoute: () => root, id: '_app', loader: () => ({ acting: owner, state: { readOnly } }), component: Outlet })
  const page = createRoute({ getParentRoute: () => app, path: '/settings', validateSearch: z.looseObject({ tab: optionalParam(z.enum(['store', 'people', 'supplier'])) }), component: SettingsPage })
  const router = createRouter({ routeTree: root.addChildren([app.addChildren([page])]), history: createMemoryHistory({ initialEntries: [`/settings?tab=${tab}`] }) })
  await act(async () => {
    render(<RouterProvider router={router} />)
  })
  await settle()
  await settle()
}

const row = (name: string) => within(screen.getAllByRole('listitem').find((li) => li.querySelector('strong')?.textContent === name) as HTMLElement)

beforeEach(() => {
  api.loadPeople.mockResolvedValue(people)
  api.loadSuppliers.mockResolvedValue(suppliers)
  api.loadApproval.mockResolvedValue(true)
  for (const fn of [api.inviteMember, api.resendInvitation, api.revokeInvitation, api.changeRole, api.removeMember, api.setApproval, api.setSupplierAccess, api.setShippingMode, api.addSupplierPerson]) fn.mockResolvedValue(undefined)
})

afterEach(() => {
  cleanup()
  vi.resetAllMocks()
})

describe('people', () => {
  it('lists everyone and the invitations waiting, filtered by the chips', async () => {
    await show('people')
    expect(screen.getByText('2 active · 1 waiting to accept. Removing someone removes them from this store, not their account.')).toBeTruthy()
    expect(row('Farhan Ali').getByText('Owner')).toBeTruthy()
    expect(row('asha@example.com').getByText(w.waitingStatus)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: `${w.waiting} · 1` }))
    expect(within(screen.getByRole('list', { name: w.peopleTitle })).getAllByRole('listitem').map((li) => li.querySelector('strong')?.textContent)).toEqual(['asha@example.com'])
  })

  it('invites someone in two steps: their email, then their role', async () => {
    await show('people')
    fireEvent.click(screen.getByRole('button', { name: w.invitePerson }))
    fireEvent.change(dialog().getByLabelText(w.theirEmail), { target: { value: 'nikhil@example.com' } })
    confirm(w.inviteNext)
    expect(dialog().getByRole('heading', { name: 'What can nikhil@example.com do?' })).toBeTruthy()
    pick('manager')
    confirm(w.sendInvite)
    await settle()
    expect(api.inviteMember).toHaveBeenCalledWith('nikhil@example.com', 'manager')
    expect(screen.getByText('Invite sent to nikhil@example.com')).toBeTruthy()
    expect(api.loadPeople).toHaveBeenCalledTimes(2)
  })

  it('resends or cancels an invitation', async () => {
    await show('people')
    fireEvent.click(screen.getByRole('button', { name: 'Manage asha@example.com' }))
    confirm(w.continue)
    await settle()
    expect(api.resendInvitation).toHaveBeenCalledWith('i1')
    fireEvent.click(screen.getByRole('button', { name: 'Manage asha@example.com' }))
    pick('cancel')
    confirm(w.continue)
    await settle()
    expect(api.revokeInvitation).toHaveBeenCalledWith('i1')
    expect(screen.getByText(w.inviteCancelled)).toBeTruthy()
  })

  it('changes a role, says why the last owner can’t be demoted, and removes someone after asking', async () => {
    api.changeRole.mockRejectedValueOnce(new ApiError('LAST_OWNER', 'last'))
    await show('people')
    fireEvent.click(screen.getByRole('button', { name: 'Manage Farhan Ali' }))
    confirm(w.continue)
    pick('manager')
    confirm(w.changeRole)
    await settle()
    expect(api.changeRole).toHaveBeenCalledWith('m1', 'manager')
    expect(screen.getByText(w.refused.LAST_OWNER)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Manage Meera Joshi' }))
    pick('remove')
    confirm(w.continue)
    expect(dialog().getByText(w.removeBody)).toBeTruthy()
    confirm(w.remove)
    await settle()
    expect(api.removeMember).toHaveBeenCalledWith('m2')
  })

  it('never lets a reload from one tab fill another opened since', async () => {
    let finish: (people: Person[]) => void = () => undefined
    await show('people')
    api.loadPeople.mockReturnValueOnce(new Promise<Person[]>((resolve) => (finish = resolve)))
    fireEvent.click(screen.getByRole('button', { name: 'Manage asha@example.com' }))
    confirm(w.continue)
    await settle()
    // The People reload is still out when the Owner opens Supplier.
    fireEvent.click(screen.getByRole('link', { name: messages.settings.tabs.supplier }))
    await settle()
    await settle()
    expect(screen.getByRole('heading', { name: w.suppliersTitle })).toBeTruthy()
    await act(async () => finish(people))
    await settle()
    expect(screen.getByRole('heading', { name: w.suppliersTitle })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: w.peopleTitle })).toBeNull()
  })

  it('gives a read-only store no way to change anyone', async () => {
    await show('people', true)
    expect(screen.queryByRole('button', { name: w.invitePerson })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Manage Meera Joshi' })).toBeNull()
  })
})

describe('suppliers', () => {
  it('lists each company with what it can do, its people and products, and switches approval', async () => {
    await show('supplier')
    expect(row('Northwind Textiles').getByText('2 users · 14 products')).toBeTruthy()
    expect(row('Moradabad Brass').getByText(w.supplierStatus.suspended)).toBeTruthy()
    const approval = screen.getByRole('switch', { name: new RegExp(w.approvalTitle) })
    expect(approval.getAttribute('aria-checked')).toBe('true')
    fireEvent.click(approval)
    await settle()
    expect(api.setApproval).toHaveBeenCalledWith(false)
    fireEvent.click(screen.getByRole('button', { name: `${w.suspendedChip} · 1` }))
    expect(within(screen.getByRole('list', { name: w.suppliersTitle })).getAllByRole('listitem')).toHaveLength(1)
  })

  it('counts a supplier whose invite is still out under Active, as SetTeam does, its row saying the invite was sent', async () => {
    api.loadSuppliers.mockResolvedValue([...suppliers, supplier({ id: 'v4', name: 'Kutch Weaves', status: 'invited', users: 0, products: 0 })])
    await show('supplier')
    fireEvent.click(screen.getByRole('button', { name: `${w.activeChip} · 2` }))
    const listed = within(screen.getByRole('list', { name: w.suppliersTitle })).getAllByRole('listitem')
    expect(listed).toHaveLength(2)
    expect(row('Kutch Weaves').getByText(w.supplierStatus.invited)).toBeTruthy()
  })

  it('invites a supplier in three steps: the company, its first user, what it can do', async () => {
    api.inviteSupplier.mockResolvedValue('v9')
    await show('supplier')
    fireEvent.click(screen.getByRole('button', { name: w.inviteSupplier }))
    fireEvent.change(dialog().getByLabelText(w.companyName), { target: { value: 'Jaipur Blue' } })
    confirm(w.next)
    fireEvent.change(dialog().getByLabelText(w.theirEmail), { target: { value: 'om@jaipurblue.in' } })
    confirm(w.next)
    pick('vendor-orders-fulfil')
    confirm(w.sendTheInvite)
    await settle()
    expect(api.inviteSupplier).toHaveBeenCalledWith({ name: 'Jaipur Blue', email: 'om@jaipurblue.in', accessLevel: 'vendor-orders-fulfil' })
    expect(screen.getByText('Invite sent to om@jaipurblue.in at Jaipur Blue')).toBeTruthy()
  })

  it('adds a person, changes access and shipping from the company’s row', async () => {
    await show('supplier')
    const open = () => fireEvent.click(screen.getByRole('button', { name: 'Manage Northwind Textiles' }))
    open()
    confirm(w.continue)
    fireEvent.change(dialog().getByLabelText(w.theirEmail), { target: { value: 'li@northwind.example' } })
    confirm(w.sendInvite)
    await settle()
    expect(api.addSupplierPerson).toHaveBeenCalledWith('v1', 'li@northwind.example')
    open()
    pick('access')
    confirm(w.continue)
    pick('vendor-stock')
    confirm(w.save)
    await settle()
    expect(api.setSupplierAccess).toHaveBeenCalledWith('v1', 'vendor-stock')
    open()
    pick('shipping')
    confirm(w.continue)
    pick('to-shopper')
    fireEvent.change(dialog().getAllByRole('combobox')[1] as HTMLElement, { target: { value: 'own' } })
    confirm(w.save)
    await settle()
    expect(api.setShippingMode).toHaveBeenCalledWith('v1', 'to-shopper', 'own')
    // To the store, who books labels isn't asked, so nothing is sent for it.
    open()
    pick('shipping')
    confirm(w.continue)
    pick('to-store')
    confirm(w.save)
    await settle()
    expect(api.setShippingMode).toHaveBeenLastCalledWith('v1', 'to-store', null)
  })

  it('suspends hiding products, reactivates, and removes saying how many products were hidden', async () => {
    api.suspendSupplier.mockResolvedValue(14)
    api.resumeSupplier.mockResolvedValue(3)
    api.removeSupplier.mockResolvedValue(14)
    await show('supplier')
    fireEvent.click(screen.getByRole('button', { name: 'Manage Northwind Textiles' }))
    pick('suspend')
    confirm(w.continue)
    expect(dialog().getByText('They can’t sign in to your store. Their 14 products are still in your catalogue.')).toBeTruthy()
    confirm(w.suspend)
    await settle()
    expect(api.suspendSupplier).toHaveBeenCalledWith('v1', true)
    fireEvent.click(screen.getByRole('button', { name: 'Manage Moradabad Brass' }))
    pick('suspend')
    confirm(w.continue)
    await settle()
    expect(api.resumeSupplier).toHaveBeenCalledWith('v3')
    fireEvent.click(screen.getByRole('button', { name: 'Manage Northwind Textiles' }))
    pick('remove')
    confirm(w.continue)
    confirm(w.removeSupplier)
    await settle()
    expect(api.removeSupplier).toHaveBeenCalledWith('v1')
    expect(screen.getByText('Northwind Textiles removed — 14 products hidden from shoppers')).toBeTruthy()
  })

  it('says when there are no suppliers yet, and words a plan refusal', async () => {
    api.loadSuppliers.mockResolvedValue([])
    api.inviteSupplier.mockRejectedValue(new ApiError('PLAN_LIMIT', 'limit', { limit: 0 }))
    await show('supplier')
    expect(screen.getByText(w.noSuppliers)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: w.inviteSupplier }))
    fireEvent.change(dialog().getByLabelText(w.companyName), { target: { value: 'X' } })
    confirm(w.next)
    fireEvent.change(dialog().getByLabelText(w.theirEmail), { target: { value: 'x@x.in' } })
    confirm(w.next)
    confirm(w.sendTheInvite)
    await settle()
    expect(screen.getByText('Your plan includes 0 — see plans for more.')).toBeTruthy()
  })
})
