// @vitest-environment happy-dom
import { ApiError } from '@dripfunnel/shared/graphql'
import { act, cleanup, render, screen } from '@testing-library/react'
import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Brand } from '../../api/brand'
import { setBrand } from '../../brand/current'
import { fill, messages } from '../../messages'

const shell = vi.hoisted(() => ({ readShell: vi.fn() }))
vi.mock('../../api/shell', async (actual) => ({ ...(await actual<typeof import('../../api/shell')>()), ...shell }))

const { routeTree } = await import('../../routeTree.gen')

const acting = { store: { id: 's1', name: 'Kesari Threads' }, role: 'owner', tier: null, seller: null, plan: null, permissions: [] }
const choice = (id: string) => ({ membershipId: `m-${id}`, store: { id, name: id }, role: 'owner', tier: null, seller: null })

const said = messages.shell.banners.suspended
const brand: Brand = {
  productName: 'Northstar Shops',
  primaryColor: '#1B3A5B',
  accentColor: '#2BB673',
  font: null,
  corner: null,
  background: null,
  files: { logoLight: null, logoDark: null, mark: null, favicon: null },
  supportEmail: 'help@northstar.example',
  supportUrl: null,
  helpUrl: null,
  termsUrl: null,
  privacyUrl: null,
  poweredBy: true,
  googleSignIn: false,
}

const suspendedShell = (stores: string[]) =>
  shell.readShell.mockResolvedValue({
    data: { me: { id: 'u1', name: 'Farhan', email: 'farhan@example.com', acting }, myStores: { nodes: stores.map(choice), pageInfo: { hasNextPage: false, endCursor: null } }, storeState: null, navBadges: null },
    errors: [{ path: ['storeState'], error: new ApiError('STORE_SUSPENDED', 'This store is suspended.') }],
  })

// A partner's support session: the API refuses it a store list of its own (ACCESS §8.3).
const suspendedSupportShell = () =>
  shell.readShell.mockResolvedValue({
    data: { me: { id: 'u1', name: 'Farhan', email: 'farhan@example.com', acting }, myStores: null, storeState: null, navBadges: null },
    errors: [
      { path: ['storeState'], error: new ApiError('STORE_SUSPENDED', 'This store is suspended.') },
      { path: ['myStores'], error: new ApiError('BLOCKED_FOR_SUPPORT', 'Not for support.') },
    ],
  })

const openHome = async () => {
  const router = createRouter({ routeTree, history: createMemoryHistory({ initialEntries: ['/home'] }) })
  await act(async () => {
    render(<RouterProvider router={router} />)
  })
}

afterEach(() => {
  setBrand(null)
  cleanup()
  vi.resetAllMocks()
})

describe('a suspended store (SAAS §4.2)', () => {
  it('says so and whom to ask, never the load error, with a way to another store and out', async () => {
    suspendedShell(['s1'])
    await openHome()
    expect(await screen.findByRole('heading', { name: fill(messages.shell.suspended.title, { store: 'Kesari Threads' }) })).toBeTruthy()
    expect(screen.getByText(/Nothing can be changed and the shop shows a notice/)).toBeTruthy()
    expect(screen.queryByText(messages.shell.loadError.title)).toBeNull()
    expect(screen.getByRole('button', { name: messages.chooseStore.create.action })).toBeTruthy()
    expect(screen.getByRole('button', { name: messages.chooseStore.signOut })).toBeTruthy()
    expect(screen.queryByRole('button', { name: messages.shell.suspended.switch })).toBeNull()
  })

  it('offers the chooser only when the person has another store', async () => {
    suspendedShell(['s1', 's2'])
    await openHome()
    expect(await screen.findByRole('button', { name: messages.shell.suspended.switch })).toBeTruthy()
  })

  it('names the partner’s support as whom to ask, never DripFunnel', async () => {
    setBrand(brand)
    suspendedShell(['s1'])
    await openHome()
    expect(await screen.findByText(new RegExp(fill(said.contact, { support: 'help@northstar.example' })))).toBeTruthy()
  })

  it('says to ask the store’s provider when the partner gives no contact', async () => {
    suspendedShell(['s1'])
    await openHome()
    expect(await screen.findByText(new RegExp(said.noContact))).toBeTruthy()
  })

  it('shows a partner support session the message alone, with no way to create, switch or sign out', async () => {
    suspendedSupportShell()
    await openHome()
    expect(await screen.findByRole('heading', { name: fill(messages.shell.suspended.title, { store: 'Kesari Threads' }) })).toBeTruthy()
    expect(screen.queryByRole('button', { name: messages.chooseStore.create.action })).toBeNull()
    expect(screen.queryByRole('button', { name: messages.shell.suspended.switch })).toBeNull()
    expect(screen.queryByRole('button', { name: messages.chooseStore.signOut })).toBeNull()
  })
})
