// @vitest-environment happy-dom
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { messages } from '../../messages'

const shell = vi.hoisted(() => ({ loadMe: vi.fn(), loadMyStores: vi.fn(), openStore: vi.fn(), readShell: vi.fn() }))
vi.mock('../../api/shell', async (actual) => ({ ...(await actual<typeof import('../../api/shell')>()), ...shell }))
const auth = vi.hoisted(() => ({ lookUpInvitation: vi.fn(), joinStoreOnce: vi.fn() }))
vi.mock('../../api/auth', async (actual) => ({ ...(await actual<typeof import('../../api/auth')>()), ...auth }))

const { routeTree } = await import('../../routeTree.gen')

const words = messages.chooseStore
const me = { id: 'u1', name: 'Ada', email: 'ada@example.com', acting: null }
const store = (id: string, name: string) => ({ membershipId: `m-${id}`, store: { id, name }, role: 'owner', tier: null, seller: null })

const openChooser = async (path = '/stores') => {
  const router = createRouter({ routeTree, history: createMemoryHistory({ initialEntries: [path] }) })
  await act(async () => {
    render(<RouterProvider router={router} />)
  })
  return router
}

const join = '/join?token=tok-1'
const invitation = { store: 'Northwind Goods', role: 'staff', supplier: null, email: 'ada@example.com', invitedBy: 'Nadia', path: 'join' }
/** The invitation is looked up, then joined once signed in. */
const serveInvitation = () => {
  auth.lookUpInvitation.mockResolvedValue({ ok: true, invitation })
  auth.joinStoreOnce.mockResolvedValue({ ok: true, step: 'done' })
}
const settle = () => act(async () => new Promise((resolve) => setTimeout(resolve, 0)))

beforeEach(() => {
  shell.readShell.mockRejectedValue(new Error('not in this test'))
})

afterEach(() => {
  cleanup()
  vi.resetAllMocks()
})

describe('the store chooser while it loads', () => {
  it('has no "Choose a store" heading, and still announces that it is loading', async () => {
    shell.loadMe.mockReturnValue(new Promise(() => undefined))
    await openChooser()
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe(words.loading))
    expect(screen.queryByRole('heading', { name: words.title })).toBeNull()
  })

  it('shows "Choose a store" and the list once several stores have loaded', async () => {
    shell.loadMe.mockResolvedValue(me)
    shell.loadMyStores.mockResolvedValue([store('a', 'Juniper & Co.'), store('b', 'Aurelia Home')])
    await openChooser()
    expect(await screen.findByRole('heading', { name: words.title })).toBeTruthy()
    expect(screen.getByText('Juniper & Co.')).toBeTruthy()
    expect(screen.getByText('Aurelia Home')).toBeTruthy()
  })
})

describe('the store chooser for a person in no store (#1356)', () => {
  it('still says they belong to no store when they signed in without an invitation, or with a link that is not an invitation', async () => {
    shell.loadMe.mockResolvedValue(me)
    shell.loadMyStores.mockResolvedValue([])
    for (const path of ['/stores', '/stores?next=%2Fhome', '/stores?next=%2Forders', '/stores?next=%2Fjoin', '/stores?next=%2Fjoin%3Ftoken%3D', '/stores?next=https%3A%2F%2Fevil.example%2Fjoin%3Ftoken%3Dx', '/stores?next=%2F%2Fevil.example%2Fjoin%3Ftoken%3Dx']) {
      const router = await openChooser(path)
      expect(await screen.findByRole('heading', { name: words.none.title })).toBeTruthy()
      expect(router.state.location.pathname).toBe('/stores')
      cleanup()
    }
  })

  it('follows an invitation link instead of refusing them, so signing in joins the store without a second click on the email', async () => {
    serveInvitation()
    shell.loadMe.mockResolvedValue(me)
    shell.loadMyStores.mockResolvedValue([])
    const router = await openChooser(`/stores?next=${encodeURIComponent(join)}`)
    await settle()
    expect(screen.queryByRole('heading', { name: words.none.title })).toBeNull()
    expect(router.state.location.pathname).toBe('/join')
    expect(router.state.location.search).toMatchObject({ token: 'tok-1' })
  })

  it('takes a person removed and invited again from signing in, through the invitation, into the store', async () => {
    serveInvitation()
    shell.loadMe.mockResolvedValue(me)
    // Removed, then invited again: no store until the invitation is joined, one after.
    shell.loadMyStores.mockResolvedValueOnce([]).mockResolvedValue([store('a', 'Northwind Goods')])
    shell.openStore.mockResolvedValue(undefined)
    await openChooser(`/stores?next=${encodeURIComponent(join)}`)
    await waitFor(() => expect(auth.joinStoreOnce).toHaveBeenCalledWith('tok-1'))
    await waitFor(() => expect(shell.openStore).toHaveBeenCalledWith(expect.objectContaining({ store: { id: 'a', name: 'Northwind Goods' } })))
  })
})
