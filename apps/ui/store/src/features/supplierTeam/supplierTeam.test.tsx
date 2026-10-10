// @vitest-environment happy-dom
import { ApiError } from '@dripfunnel/shared/graphql'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { createMemoryHistory, createRootRoute, createRoute, createRouter, Outlet, RouterProvider } from '@tanstack/react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Acting } from '../../api/shell'
import type { Teammate } from '../../api/supplierTeam'
import { fill, messages } from '../../messages'

// Your team driven as a Supplier admin would (VendorViews "team", ACCESS §7.5), and refused to every other seat.

const words = messages.supplierTeam

const api = vi.hoisted(() => ({
  loadMyTeam: vi.fn(),
  inviteTeammate: vi.fn(),
  resendTeamInvitation: vi.fn(),
  revokeTeamInvitation: vi.fn(),
  changeTeamRole: vi.fn(),
  removeTeammate: vi.fn(),
}))
vi.mock('../../api/supplierTeam', async (actual) => ({ ...(await actual<typeof import('../../api/supplierTeam')>()), ...api }))

const { TeamPage } = await import('./TeamPage')

const teammate = (t: Partial<Teammate> & Pick<Teammate, 'id' | 'email'>): Teammate => ({ kind: 'member', name: null, role: 'supplier-member', you: false, lastAdmin: false, since: '2026-09-02T09:00:00Z', expiresAt: null, expired: false, ...t })
const nadia = teammate({ id: 'm-nadia', email: 'nadia@northwind.example', name: 'Nadia Tran', role: 'supplier-admin', you: true, lastAdmin: true })
const leo = teammate({ id: 'm-leo', email: 'leo@northwind.example', name: 'Leo Park' })
const mira = teammate({ id: 'i-mira', kind: 'invitation', email: 'mira@northwind.example', expiresAt: '2026-10-15T09:00:00Z' })
const team = [nadia, leo, mira]

const northwind = { id: 'v1', name: 'Northwind Textiles' }
const admin: Acting = { store: { id: 's1', name: 'Kesari Threads' }, role: 'supplier-admin', tier: 'vendor-stock', seller: northwind, plan: null, permissions: ['catalog.read', 'stock.write', 'supplier.team'] }
const member: Acting = { ...admin, role: 'supplier-member', permissions: ['catalog.read', 'stock.write'] }
const owner: Acting = { store: admin.store, role: 'owner', tier: null, seller: null, plan: null, permissions: ['catalog.read', 'settings'] }

const settle = () => act(async () => new Promise((resolve) => setTimeout(resolve, 0)))
const dialog = () => within(document.querySelector('dialog') as HTMLElement)
const pick = (value: string) => fireEvent.change(dialog().getByRole('combobox'), { target: { value } })
const confirm = (name: string) => fireEvent.click(dialog().getByRole('button', { name }))
const type = (value: string) => fireEvent.change(dialog().getByLabelText(words.theirEmail), { target: { value } })
const row = (name: string) => within(screen.getAllByRole('listitem').find((li) => li.querySelector('strong')?.textContent === name) as HTMLElement)
const menu = (name: string) => fireEvent.click(row(name).getByRole('button', { name: fill(words.manage, { name }) }))

const show = async (acting: Acting, { readOnly = false } = {}) => {
  const root = createRootRoute({ component: Outlet })
  const app = createRoute({ getParentRoute: () => root, id: '_app', loader: () => ({ acting, state: { readOnly } }), component: Outlet })
  const page = createRoute({ getParentRoute: () => app, path: '/team', component: TeamPage })
  const router = createRouter({ routeTree: root.addChildren([app.addChildren([page])]), history: createMemoryHistory({ initialEntries: ['/team'] }) })
  await act(async () => {
    render(<RouterProvider router={router} />)
  })
  await settle()
}

beforeEach(() => {
  api.loadMyTeam.mockResolvedValue(team)
  for (const fn of [api.inviteTeammate, api.resendTeamInvitation, api.revokeTeamInvitation, api.changeTeamRole, api.removeTeammate]) fn.mockResolvedValue(undefined)
})

afterEach(() => {
  cleanup()
  vi.resetAllMocks()
})

describe('Your team', () => {
  it('lists the supplier’s people and invitations as the prototype words them', async () => {
    await show(admin)
    expect(screen.getByText('The people from Northwind Textiles who work in Kesari Threads.')).toBeTruthy()
    expect(row('Nadia Tran').getByText(words.status.you)).toBeTruthy()
    expect(row('Leo Park').getByText(words.roles['supplier-member'])).toBeTruthy()
    expect(row('mira@northwind.example').getByText(words.status.invited)).toBeTruthy()
    expect(row('mira@northwind.example').getByText(/Its link works until Oct 15, 2026/)).toBeTruthy()
    expect(screen.queryByText(fill(words.alone, { supplier: 'Northwind Textiles' }))).toBeNull()
  })

  it('invites with the role picked, the member’s worded as the supplier’s access level', async () => {
    await show(admin)
    fireEvent.click(screen.getByRole('button', { name: words.invite }))
    expect(dialog().getByRole('option', { name: 'Supplier member — Stock only' })).toBeTruthy()
    type('asha@northwind.example')
    pick('supplier-admin')
    confirm(words.sendInvite)
    await settle()
    expect(api.inviteTeammate).toHaveBeenCalledWith('asha@northwind.example', 'supplier-admin')
    expect(document.querySelector('dialog')).toBeNull()
    expect(screen.getByText(fill(words.sent, { email: 'asha@northwind.example' }))).toBeTruthy()
    expect(api.loadMyTeam).toHaveBeenCalledTimes(2)
  })

  it('keeps a refusal in the dialog that asked, keeps what was typed, and clears it on the next open', async () => {
    api.inviteTeammate.mockRejectedValueOnce(new ApiError('ALREADY_MEMBER', 'already'))
    await show(admin)
    fireEvent.click(screen.getByRole('button', { name: words.invite }))
    type('leo@northwind.example')
    confirm(words.sendInvite)
    await settle()
    expect(dialog().getByRole('alert').textContent).toBe(words.refused.ALREADY_MEMBER)
    expect((dialog().getByLabelText(words.theirEmail) as HTMLInputElement).value).toBe('leo@northwind.example')
    confirm(words.cancel)
    menu('Leo Park')
    expect(dialog().queryByRole('alert')).toBeNull()
    confirm(words.cancel)
    fireEvent.click(screen.getByRole('button', { name: words.invite }))
    expect(dialog().queryByRole('alert')).toBeNull()
  })

  it('explains the last admin and changes nothing', async () => {
    await show(admin)
    menu('Nadia Tran')
    expect(dialog().getByText(words.lastAdmin)).toBeTruthy()
    expect(dialog().queryByRole('combobox')).toBeNull()
    confirm(words.ok)
    expect(document.querySelector('dialog')).toBeNull()
    expect(api.changeTeamRole).not.toHaveBeenCalled()
    expect(api.removeTeammate).not.toHaveBeenCalled()
  })

  it('says the server’s LAST_ADMIN in the dialog, for a last admin the list hadn’t caught up with', async () => {
    api.changeTeamRole.mockRejectedValueOnce(new ApiError('LAST_ADMIN', 'last'))
    api.loadMyTeam.mockResolvedValue([{ ...nadia, lastAdmin: false }, { ...leo, role: 'supplier-admin' }])
    await show(admin)
    menu('Leo Park')
    confirm(words.go)
    await settle()
    expect(api.changeTeamRole).toHaveBeenCalledWith('m-leo', 'supplier-member')
    expect(dialog().getByRole('alert').textContent).toBe(words.refused.LAST_ADMIN)
  })

  it('makes a member an admin, and removes one only after restating what it does', async () => {
    await show(admin)
    menu('Leo Park')
    confirm(words.go)
    await settle()
    expect(api.changeTeamRole).toHaveBeenCalledWith('m-leo', 'supplier-admin')
    expect(screen.getByText(fill(words.nowAdmin, { name: 'Leo Park' }))).toBeTruthy()
    menu('Leo Park')
    pick('remove')
    confirm(words.go)
    expect(dialog().getByText('They lose access to Kesari Threads straight away. Their own account stays.')).toBeTruthy()
    expect(api.removeTeammate).not.toHaveBeenCalled()
    confirm(words.removeConfirm)
    await settle()
    expect(api.removeTeammate).toHaveBeenCalledWith('m-leo')
  })

  it('resends or cancels an invitation', async () => {
    await show(admin)
    menu('mira@northwind.example')
    confirm(words.go)
    await settle()
    expect(api.resendTeamInvitation).toHaveBeenCalledWith('i-mira')
    menu('mira@northwind.example')
    pick('cancel')
    confirm(words.go)
    await settle()
    expect(api.revokeTeamInvitation).toHaveBeenCalledWith('i-mira')
  })

  it('never lets a slow read from before a change replace the list after it', async () => {
    let slow: (value: Teammate[]) => void = () => undefined
    api.loadMyTeam.mockReset()
    api.loadMyTeam.mockResolvedValueOnce(team).mockReturnValueOnce(new Promise<Teammate[]>((resolve) => (slow = resolve))).mockResolvedValueOnce([nadia, { ...leo, role: 'supplier-admin' }])
    await show(admin)
    menu('Leo Park')
    confirm(words.go)
    await settle()
    menu('mira@northwind.example')
    confirm(words.go)
    await settle()
    expect(screen.queryByText('mira@northwind.example')).toBeNull()
    await act(async () => slow(team))
    await settle()
    expect(screen.queryByText('mira@northwind.example')).toBeNull()
    expect(row('Leo Park').getByText(words.roles['supplier-admin'])).toBeTruthy()
  })

  it('says so when it’s just you, and still offers the invite', async () => {
    api.loadMyTeam.mockResolvedValue([nadia])
    await show(admin)
    expect(screen.getByText(fill(words.alone, { supplier: 'Northwind Textiles' }))).toBeTruthy()
    expect(screen.getByRole('button', { name: words.invite })).toBeTruthy()
  })

  it('in a read-only store shows the invite disabled with the reason and no menus', async () => {
    await show(admin, { readOnly: true })
    const invite = screen.getByRole('button', { name: words.invite }) as HTMLButtonElement
    expect(invite.disabled).toBe(true)
    expect(screen.getByText(words.readOnly)).toBeTruthy()
    expect(screen.queryByRole('button', { name: fill(words.manage, { name: 'Leo Park' }) })).toBeNull()
  })

  it('offers a retry when the read fails', async () => {
    api.loadMyTeam.mockRejectedValueOnce(new Error('down')).mockResolvedValueOnce(team)
    await show(admin)
    fireEvent.click(screen.getByRole('button', { name: words.error.retry }))
    await settle()
    expect(row('Leo Park')).toBeTruthy()
  })

  it.each([
    ['a Supplier member', member, fill(words.denied.supplier, { supplier: 'Northwind Textiles' })],
    ['the merchant side', owner, words.denied.merchant],
  ])('tells %s it has no access and asks the API nothing', async (_name, acting, body) => {
    await show(acting)
    expect(screen.getByRole('heading', { name: words.denied.title })).toBeTruthy()
    expect(screen.getByText(body)).toBeTruthy()
    expect(api.loadMyTeam).not.toHaveBeenCalled()
  })
})
