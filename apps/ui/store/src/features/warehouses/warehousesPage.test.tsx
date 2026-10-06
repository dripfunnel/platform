// @vitest-environment happy-dom
import { act, cleanup, render, screen } from '@testing-library/react'
import { createMemoryHistory, createRootRoute, createRoute, createRouter, Outlet, RouterProvider } from '@tanstack/react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Acting } from '../../api/shell'
import { messages } from '../../messages'

// The Warehouses page around the list: who may change it, a supplier's tabs and title, and a seat that can't see it.

const words = messages.warehouses

const api = vi.hoisted(() => ({ loadPlaces: vi.fn(), savePlace: vi.fn(), makeDefaultPlace: vi.fn(), deletePlace: vi.fn() }))
vi.mock('../../api/stock', async (actual) => ({ ...(await actual<typeof import('../../api/stock')>()), ...api }))

const { WarehousesPage } = await import('./WarehousesPage')

const supplier: Acting = { store: { id: 's1', name: 'Kesari' }, role: 'supplier-admin', tier: 'vendor-catalogue', seller: { id: 'v1', name: 'Northwind' }, plan: null, permissions: ['catalog.read', 'stock.read', 'warehouses.write'] }
const owner: Acting = { ...supplier, role: 'owner', tier: null, seller: null }

const show = async (acting: Acting, readOnly = false) => {
  const root = createRootRoute({ component: Outlet })
  const app = createRoute({ getParentRoute: () => root, id: '_app', loader: () => ({ acting, state: { readOnly } }), component: Outlet })
  const products = createRoute({ getParentRoute: () => app, path: '/products', component: () => <p>The list</p> })
  const page = createRoute({ getParentRoute: () => app, path: '/products/warehouses', component: WarehousesPage })
  const router = createRouter({ routeTree: root.addChildren([app.addChildren([products, page])]), history: createMemoryHistory({ initialEntries: ['/products/warehouses'] }) })
  await act(async () => {
    render(<RouterProvider router={router} />)
  })
  await act(async () => new Promise((resolve) => setTimeout(resolve, 0)))
}

beforeEach(() => {
  api.loadPlaces.mockResolvedValue([{ id: 'w1', name: 'Workshop', isDefault: true, units: 3, revision: 1, address: null, supplierId: null, supplierName: null }])
})

afterEach(() => {
  cleanup()
  vi.resetAllMocks()
})

describe('the Warehouses page', () => {
  it('gives a supplier its products title and tabs, Warehouses current, and lets it add', async () => {
    await show(supplier)
    expect(screen.getByRole('heading', { level: 1, name: messages.products.titleSupplier })).toBeTruthy()
    expect(screen.getByRole('navigation', { name: words.tabs.label })).toBeTruthy()
    expect(screen.getByRole('link', { name: words.tabs.warehouses }).getAttribute('aria-current')).toBe('page')
    expect(screen.getByRole('button', { name: words.add })).toBeTruthy()
  })

  it('titles the page Warehouses, without the tabs, for the merchant', async () => {
    await show(owner)
    expect(screen.getByRole('heading', { level: 1, name: words.tabs.warehouses })).toBeTruthy()
    expect(screen.queryByRole('navigation', { name: words.tabs.label })).toBeNull()
  })

  it('names a supplier’s location for every merchant seat that reads stock, from the API', async () => {
    api.loadPlaces.mockResolvedValue([
      { id: 'w1', name: 'Workshop', isDefault: true, units: 3, revision: 1, address: null, supplierId: null, supplierName: null },
      { id: 'w9', name: 'Anand’s depot', isDefault: true, units: 12, revision: 1, address: null, supplierId: 'v1', supplierName: 'Northwind' },
    ])
    await show({ ...owner, role: 'manager', permissions: ['catalog.read', 'stock.read'] })
    expect(screen.getByRole('heading', { name: words.theirsTitle })).toBeTruthy()
    expect(screen.getByText(/Northwind · 12 units/)).toBeTruthy()
  })

  it('shows the list without changes to a read-only store or a seat without warehouses.write', async () => {
    const seats: [Acting, boolean][] = [[supplier, true], [{ ...supplier, permissions: ['catalog.read', 'stock.read'] }, false]]
    for (const [acting, readOnly] of seats) {
      await show(acting, readOnly)
      expect(screen.getByText(words.viewOnly)).toBeTruthy()
      expect(screen.queryByRole('button', { name: words.add })).toBeNull()
      cleanup()
    }
  })

  it('tells a seat without stock.read it can’t see them, and never asks the API', async () => {
    await show({ ...supplier, permissions: ['catalog.read'] })
    expect(screen.getByRole('heading', { name: words.denied.title })).toBeTruthy()
    expect(api.loadPlaces).not.toHaveBeenCalled()
  })
})
