// @vitest-environment happy-dom
import { act, cleanup, render, screen } from '@testing-library/react'
import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { messages } from '../../messages'

// The real routes (#1136): /stores/new is its own page, never the chooser, which opens a lone store and leaves for Home.

const shell = vi.hoisted(() => ({ loadMe: vi.fn(), loadMyStores: vi.fn(), openStore: vi.fn(), readShell: vi.fn() }))
vi.mock('../../api/shell', async (actual) => ({ ...(await actual<typeof import('../../api/shell')>()), ...shell }))

const { routeTree } = await import('../../routeTree.gen')

const options = { ok: true, countries: [{ code: 'IN', name: 'India', currency: 'INR' }], shopDomain: 'my-store.one' }

beforeEach(() => {
  shell.loadMe.mockResolvedValue({ id: 'u1', name: 'Ada', email: 'ada@example.com', acting: null })
  shell.loadMyStores.mockResolvedValue([{ membershipId: 'm1', store: { id: 's1', name: 'Juniper & Co.' }, role: 'owner', tier: null, seller: null }])
  shell.openStore.mockResolvedValue(undefined)
  shell.readShell.mockRejectedValue(new Error('not in this test'))
  vi.stubGlobal('fetch', async (url: string) => (url === '/api/auth/new-store/options' ? new Response(JSON.stringify(options)) : Promise.reject(new Error('offline'))))
})

afterEach(() => {
  cleanup()
  vi.resetAllMocks()
  vi.unstubAllGlobals()
})

describe('/stores/new', () => {
  it('shows the store form to someone in one store, and stays there', async () => {
    const router = createRouter({ routeTree, history: createMemoryHistory({ initialEntries: ['/stores/new'] }) })
    await act(async () => {
      render(<RouterProvider router={router} />)
    })
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)))
    expect(router.state.location.pathname).toBe('/stores/new')
    expect(await screen.findByLabelText(messages.auth.signup.su3.store)).toBeTruthy()
    expect(shell.openStore).not.toHaveBeenCalled()
  })
})
