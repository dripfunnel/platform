// @vitest-environment happy-dom
import { ApiError } from '@dripfunnel/shared/graphql'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { createMemoryHistory, createRootRoute, createRoute, createRouter, Outlet, RouterProvider } from '@tanstack/react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ApiKey } from '../../api/developers'
import type { Acting } from '../../api/shell'
import { messages } from '../../messages'
import { settingsSearch } from './settingsSearch'

// Settings › Developers driven as the Owner would (SetDev "developers"): keys shown once and then only by prefix,
// rotate and revoke saying what happens.

const w = messages.settings.developers
const k = w.keys

const dev = vi.hoisted(() => ({
  keyNameMax: 80,
  loadApiKeys: vi.fn(),
  loadApiKeyChoices: vi.fn(),
  createApiKey: vi.fn(),
  rotateApiKey: vi.fn(),
  revokeApiKey: vi.fn(),
}))
vi.mock('../../api/developers', () => dev)
const team = vi.hoisted(() => ({ loadSuppliers: vi.fn(), loadPeople: vi.fn(), loadApproval: vi.fn() }))
vi.mock('../../api/team', async (actual) => ({ ...(await actual<typeof import('../../api/team')>()), ...team }))

const { SettingsPage } = await import('./SettingsPage')

const owner: Acting = { store: { id: 's1', name: 'Kesari' }, role: 'owner', tier: null, seller: null, plan: null, permissions: ['settings'] }
const manager: Acting = { ...owner, role: 'manager', permissions: ['orders.read', 'activity.read'] }

const key = (over: Partial<ApiKey> & Pick<ApiKey, 'id' | 'name'>): ApiKey => ({
  prefix: 'dfk_abcdefgh',
  scopes: ['catalog.read'],
  supplier: null,
  createdByName: 'Farhan Ali',
  createdByHere: true,
  createdAt: '2026-10-01T00:00:00Z',
  expiresAt: null,
  lastUsedAt: null,
  previousWorksUntil: null,
  ...over,
})
const keys: ApiKey[] = [
  key({ id: 'k1', name: 'Stock sync', prefix: 'dfk_7Hq2LmX9', scopes: ['catalog.read', 'stock.read'], lastUsedAt: '2026-10-10T09:30:00Z', expiresAt: '2099-01-01T00:00:00Z' }),
  key({ id: 'k2', name: 'Northwind feed', supplier: { id: 'v1', name: 'Northwind Textiles' }, createdByName: 'Meera Joshi', createdByHere: false, expiresAt: '2020-01-01T00:00:00Z' }),
]
const secret = 'dfk_' + 'S'.repeat(48)
const settle = () => act(async () => new Promise((resolve) => setTimeout(resolve, 0)))
const dialog = () => within(document.querySelector('dialog[open]') as HTMLElement)
const keysRegion = () => within(screen.getByRole('region', { name: k.title }))

const show = async ({ acting = owner, readOnly = false, state = '' } = {}) => {
  const root = createRootRoute({ component: Outlet })
  const app = createRoute({ getParentRoute: () => root, id: '_app', loader: () => ({ acting, state: { readOnly } }), component: Outlet })
  const page = createRoute({ getParentRoute: () => app, path: '/settings', validateSearch: settingsSearch, component: SettingsPage })
  const router = createRouter({ routeTree: root.addChildren([app.addChildren([page])]), history: createMemoryHistory({ initialEntries: [`/settings?tab=developers${state}`] }) })
  await act(async () => {
    render(<RouterProvider router={router} />)
  })
  await settle()
  await settle()
  return router
}

const makeKey = async () => {
  fireEvent.click(screen.getByRole('button', { name: k.create }))
  const form = within(screen.getByRole('form', { name: k.newTitle }))
  fireEvent.change(form.getByLabelText(k.name), { target: { value: 'Feed' } })
  fireEvent.click(form.getByRole('button', { name: k.createKey }))
  await settle()
  return within(screen.getByRole('region', { name: k.secretTitle }))
}

beforeEach(() => {
  dev.loadApiKeys.mockResolvedValue(keys)
  dev.loadApiKeyChoices.mockResolvedValue({ scopes: ['catalog.read', 'stock.read', 'orders.read', 'customers.read'], expiresInDays: [30, 90, 365], requestsPerMinute: 60, requestsPerMonth: 100000 })
  dev.createApiKey.mockResolvedValue({ id: 'k9', prefix: 'dfk_SSSSSSSS', secret })
  dev.rotateApiKey.mockResolvedValue({ id: 'k10', prefix: 'dfk_RRRRRRRR', secret })
  dev.revokeApiKey.mockResolvedValue(undefined)
  team.loadSuppliers.mockResolvedValue([
    { id: 'v1', name: 'Northwind Textiles', status: 'active' },
    { id: 'v2', name: 'Moradabad Brass', status: 'suspended' },
  ])
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.resetAllMocks()
})

describe('API keys', () => {
  it('lists each key by its prefix only, with what it can do, for whom, who made it and when it ends', async () => {
    await show()
    const r = keysRegion()
    expect(r.getByText('dfk_7Hq2LmX9…')).toBeTruthy()
    expect(r.getByText('See products and See stock')).toBeTruthy()
    expect(r.getByText('Only supplier Northwind Textiles')).toBeTruthy()
    expect(r.getByText('Created by Meera Joshi — no longer here')).toBeTruthy()
    expect(r.getByText(/^Expired /)).toBeTruthy()
    expect(r.getByText(k.neverUsed)).toBeTruthy()
    expect(screen.getByText(/60 requests a minute, 100,000 a month/)).toBeTruthy()
  })

  it('makes a key, shows its secret once, and forgets it once stored', async () => {
    await show()
    fireEvent.click(screen.getByRole('button', { name: k.create }))
    const form = within(screen.getByRole('form', { name: k.newTitle }))
    // Only active suppliers can be bound.
    expect(form.getByRole('option', { name: 'Only supplier Northwind Textiles' })).toBeTruthy()
    expect(form.queryByRole('option', { name: 'Only supplier Moradabad Brass' })).toBeNull()
    fireEvent.click(form.getByRole('button', { name: k.createKey }))
    expect(form.getByRole('alert').textContent).toBe(k.nameMissing)
    fireEvent.change(form.getByLabelText(k.name), { target: { value: ' Stock sync 2 ' } })
    expect(form.queryByRole('alert')).toBeNull()
    fireEvent.click(form.getByLabelText('See products'))
    fireEvent.click(form.getByRole('button', { name: k.createKey }))
    expect(form.getByRole('alert').textContent).toBe(k.scopesMissing)
    fireEvent.click(form.getByLabelText('See orders'))
    fireEvent.change(form.getByLabelText(k.worksFor), { target: { value: 'v1' } })
    fireEvent.change(form.getByLabelText(k.expires), { target: { value: '' } })
    fireEvent.click(form.getByRole('button', { name: k.createKey }))
    await settle()
    expect(dev.createApiKey).toHaveBeenCalledWith({ name: 'Stock sync 2', scopes: ['orders.read'], supplierId: 'v1', expiresInDays: null })
    expect(screen.queryByRole('form', { name: k.newTitle })).toBeNull()
    const once = within(screen.getByRole('region', { name: k.secretTitle }))
    expect(once.getByText(secret)).toBeTruthy()
    // The list read again doesn't take the secret away, and nothing can replace it before it's stored.
    expect(dev.loadApiKeys).toHaveBeenCalledTimes(2)
    expect(once.getByText(secret)).toBeTruthy()
    expect((screen.getByRole('button', { name: k.create }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'Rotate Stock sync' }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText(k.storeFirst)).toBeTruthy()
    fireEvent.click(once.getByRole('button', { name: k.stored }))
    expect(screen.queryByText(secret)).toBeNull()
    expect((screen.getByRole('button', { name: k.create }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('keeps a refused key’s form open with what was typed, and the refusal in it alone', async () => {
    dev.createApiKey.mockRejectedValueOnce(new ApiError('INVALID_SCOPES', 'no'))
    await show()
    fireEvent.click(screen.getByRole('button', { name: k.create }))
    const form = within(screen.getByRole('form', { name: k.newTitle }))
    fireEvent.change(form.getByLabelText(k.name), { target: { value: 'Feed' } })
    fireEvent.click(form.getByRole('button', { name: k.createKey }))
    await settle()
    expect(form.getByRole('alert').textContent).toBe(k.refused.INVALID_SCOPES)
    expect((form.getByLabelText(k.name) as HTMLInputElement).value).toBe('Feed')
    expect(screen.getAllByRole('alert')).toHaveLength(1)
  })

  it('rotates after saying the old key works a day more, and shows the new secret once', async () => {
    await show()
    fireEvent.click(screen.getByRole('button', { name: 'Rotate Stock sync' }))
    expect(dialog().getByText(k.rotateBody)).toBeTruthy()
    fireEvent.click(dialog().getByRole('button', { name: k.rotateGo }))
    await settle()
    expect(dev.rotateApiKey).toHaveBeenCalledWith('k1')
    expect(within(screen.getByRole('region', { name: k.secretTitle })).getByText(secret)).toBeTruthy()
  })

  it('revokes after restating that it stops at once, and says a refusal on the keys', async () => {
    await show()
    fireEvent.click(screen.getByRole('button', { name: 'Revoke Northwind feed' }))
    expect(dialog().getByText(k.revokeBody)).toBeTruthy()
    fireEvent.click(dialog().getByRole('button', { name: k.revokeGo }))
    await settle()
    expect(dev.revokeApiKey).toHaveBeenCalledWith('k2')
    expect(screen.getByText('Northwind feed revoked')).toBeTruthy()
    dev.revokeApiKey.mockRejectedValueOnce(new ApiError('NOT_FOUND', 'gone'))
    fireEvent.click(screen.getByRole('button', { name: 'Revoke Stock sync' }))
    fireEvent.click(dialog().getByRole('button', { name: k.revokeGo }))
    await settle()
    expect(keysRegion().getByRole('alert').textContent).toBe(k.refused.NOT_FOUND)
  })

  it('says the list is stale when reading it again fails, rather than showing it as fresh', async () => {
    await show()
    dev.loadApiKeys.mockRejectedValueOnce(new Error('down'))
    fireEvent.click(screen.getByRole('button', { name: 'Revoke Stock sync' }))
    fireEvent.click(dialog().getByRole('button', { name: k.revokeGo }))
    await settle()
    expect(keysRegion().getByRole('status').textContent).toBe(k.stale)
  })
})

describe('a secret on screen', () => {
  it('copies it, and says when the browser wouldn’t', async () => {
    const write = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('denied'))
    await show()
    const once = await makeKey()
    fireEvent.click(once.getByRole('button', { name: w.copy }))
    await settle()
    expect(write).toHaveBeenCalledWith(secret)
    expect(once.getByRole('status').textContent).toBe(w.copied)
    fireEvent.click(once.getByRole('button', { name: w.copy }))
    await settle()
    expect(once.getByRole('status').textContent).toBe(w.copyFailed)
  })

  it('asks before leaving while it isn’t stored, and stays when the Owner says no', async () => {
    const ask = vi.fn().mockReturnValueOnce(false).mockReturnValueOnce(true)
    vi.stubGlobal('confirm', ask)
    const router = await show()
    await makeKey()
    // A blocked navigation never settles, so it isn't awaited.
    act(() => void router.navigate({ to: '/settings', search: { tab: 'people' } }))
    await settle()
    expect(ask).toHaveBeenCalledWith(w.leave)
    expect(screen.getByText(secret)).toBeTruthy()
    act(() => void router.navigate({ to: '/settings', search: { tab: 'people' } }))
    await settle()
    expect(screen.queryByText(secret)).toBeNull()
  })

  it('leaves without asking once it is stored', async () => {
    const ask = vi.fn()
    vi.stubGlobal('confirm', ask)
    const router = await show()
    const once = await makeKey()
    fireEvent.click(once.getByRole('button', { name: k.stored }))
    act(() => void router.navigate({ to: '/settings', search: { tab: 'people' } }))
    await settle()
    expect(ask).not.toHaveBeenCalled()
  })

  it('can’t rotate a key while a new one is being made, so nothing typed is lost', async () => {
    await show()
    fireEvent.click(screen.getByRole('button', { name: k.create }))
    expect((screen.getByRole('button', { name: 'Rotate Stock sync' }) as HTMLButtonElement).disabled).toBe(true)
  })
})

describe('who and when', () => {
  it('lets a read-only store look at its keys without changing anything', async () => {
    await show({ readOnly: true })
    expect(keysRegion().getByText('Stock sync')).toBeTruthy()
    for (const name of [k.create, 'Rotate Stock sync', 'Revoke Stock sync']) expect((screen.getByRole('button', { name }) as HTMLButtonElement).disabled).toBe(true)
  })

  it.each<[string, Acting]>([
    ['a Manager', manager],
    ['Staff', { ...owner, role: 'staff', permissions: ['orders.read'] }],
    ['a supplier', { ...owner, role: 'vendor', tier: 'vendor-catalogue', seller: { id: 'v1', name: 'Northwind' }, permissions: ['catalog.read'] }],
  ])('reads nothing for %s, who has no Settings', async (_, acting) => {
    await show({ acting })
    expect(screen.getByText(messages.settings.denied.title)).toBeTruthy()
    expect(dev.loadApiKeys).not.toHaveBeenCalled()
  })

  it('says when there are no keys', async () => {
    dev.loadApiKeys.mockResolvedValue([])
    await show()
    expect(screen.getByText(k.empty)).toBeTruthy()
  })

  it('says when the tab didn’t load', async () => {
    dev.loadApiKeyChoices.mockRejectedValue(new Error('down'))
    await show()
    expect(screen.getByText(messages.settings.error.title)).toBeTruthy()
  })
})
