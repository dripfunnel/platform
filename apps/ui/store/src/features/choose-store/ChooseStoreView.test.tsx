// @vitest-environment happy-dom
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { messages } from '../../messages'

const shell = vi.hoisted(() => ({ loadMe: vi.fn(), loadMyStores: vi.fn(), openStore: vi.fn(), readShell: vi.fn() }))
vi.mock('../../api/shell', async (actual) => ({ ...(await actual<typeof import('../../api/shell')>()), ...shell }))

const { routeTree } = await import('../../routeTree.gen')

const words = messages.chooseStore
const me = { id: 'u1', name: 'Ada', email: 'ada@example.com', acting: null }
const store = (id: string, name: string) => ({ membershipId: `m-${id}`, store: { id, name }, role: 'owner', tier: null, seller: null })

const openChooser = async () => {
  const router = createRouter({ routeTree, history: createMemoryHistory({ initialEntries: ['/stores'] }) })
  await act(async () => {
    render(<RouterProvider router={router} />)
  })
}

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
