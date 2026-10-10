// @vitest-environment happy-dom
import { ApiError } from '@dripfunnel/shared/graphql'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createMemoryHistory, createRootRoute, createRoute, createRouter, Outlet, RouterProvider } from '@tanstack/react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PlanKeep } from '../../api/billing'
import type { ProductPage, ProductRow } from '../../api/products'
import type { Acting } from '../../api/shell'
import { messages } from '../../messages'

// Choose what to keep driven as the Owner would (SAAS §6.2, PortalKeep): the picks within the smaller plan, what has an
// order waiting to ship staying whatever is ticked, and who may change them.

const words = messages.keep

const billing = vi.hoisted(() => ({ loadPlanKeep: vi.fn(), keepProducts: vi.fn() }))
vi.mock('../../api/billing', async (actual) => ({ ...(await actual<typeof import('../../api/billing')>()), ...billing }))
const products = vi.hoisted(() => ({ loadProducts: vi.fn() }))
vi.mock('../../api/products', async (actual) => ({ ...(await actual<typeof import('../../api/products')>()), ...products }))

const { KeepPage } = await import('./KeepPage')

const row = (id: string, name: string): ProductRow => ({ id, name, visible: true, approval: null, productType: 'physical', supplier: null, supplierRemoved: false, versionCount: 1, minPrice: null, maxPrice: null, photoUrl: null, stock: 1, lowStock: false, readiness: null })
const rows = [row('p1', 'Saree'), row('p2', 'Kurta'), row('p3', 'Dupatta'), row('p4', 'Stole')]
const page = (r: ProductRow[], next: string | null = null): ProductPage => ({ rows: r, next, previous: null })

// Free keeps 2: the dupatta has an order waiting, the saree is the Owner's pick or a best seller.
const keep: PlanKeep = { plan: { id: 'free', name: 'Free' }, limit: 2, from: '2026-10-11T00:00:00.000Z', products: 5, paused: 3, kept: ['p3', 'p1'], waiting: ['p3'] }

const owner: Acting = { store: { id: 's1', name: 'Kesari' }, role: 'owner', tier: null, seller: null, plan: null, permissions: ['billing'] }
const manager: Acting = { ...owner, role: 'manager', permissions: ['reports.read'] }
const supplier: Acting = { ...owner, role: 'supplier-admin', tier: 'vendor-catalogue', seller: { id: 'v1', name: 'Northwind' }, permissions: ['billing'] }

const show = async (acting: Acting, state = { readOnly: false, support: null as unknown }) => {
  const root = createRootRoute({ component: Outlet })
  const app = createRoute({ getParentRoute: () => root, id: '_app', loader: () => ({ acting, state }), component: Outlet })
  const keepRoute = createRoute({ getParentRoute: () => app, path: '/billing/keep', component: KeepPage })
  const billingRoute = createRoute({ getParentRoute: () => app, path: '/billing', component: () => null })
  const home = createRoute({ getParentRoute: () => app, path: '/home', component: () => null })
  const router = createRouter({ routeTree: root.addChildren([app.addChildren([keepRoute, billingRoute, home])]), history: createMemoryHistory({ initialEntries: ['/billing/keep'] }) })
  await act(async () => {
    render(<RouterProvider router={router} />)
  })
  await settle()
  return router
}

const settle = () => act(async () => new Promise((resolve) => setTimeout(resolve, 0)))
const box = (name: string) => screen.getByRole('checkbox', { name: new RegExp(name) }) as HTMLInputElement
const saveButton = () => screen.getByRole('button', { name: 'Keep these from Oct 11, 2026' })

beforeEach(() => {
  billing.loadPlanKeep.mockResolvedValue(keep)
  products.loadProducts.mockResolvedValue(page(rows, 'c1'))
})

afterEach(() => {
  cleanup()
  vi.resetAllMocks()
})

describe('Choose what to keep', () => {
  it('ticks what the API keeps, holds what waits to ship, and counts against the plan', async () => {
    await show(owner)
    expect(screen.getByRole('heading', { name: 'Choose what to keep on Free' })).toBeTruthy()
    expect(screen.getByText(/From Oct 11, 2026 you’re on Free, which keeps 2 products/)).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Products · 2 of 2 stay on sale' })).toBeTruthy()
    expect(box('Saree').checked).toBe(true)
    expect(box('Dupatta')).toMatchObject({ checked: true, disabled: true })
    expect(screen.getByText(words.waiting)).toBeTruthy()
    expect(box('Kurta').checked).toBe(false)
    expect(products.loadProducts).toHaveBeenCalledWith({ filter: 'all', search: '', supplier: '', sort: 'name' })
  })

  it('refuses one more than the plan keeps, swaps a pick and saves only the picks', async () => {
    billing.keepProducts.mockResolvedValue({ ...keep, kept: ['p3', 'p2'] })
    await show(owner)
    fireEvent.click(box('Kurta'))
    expect(screen.getByRole('alert').textContent).toBe('Free keeps 2 products — untick one first.')
    expect(box('Kurta').checked).toBe(false)
    fireEvent.click(box('Saree'))
    expect(screen.queryByRole('alert')).toBeNull()
    fireEvent.click(box('Kurta'))
    fireEvent.click(saveButton())
    await settle()
    expect(billing.keepProducts).toHaveBeenCalledWith(['p2'])
    expect(screen.getByRole('status').textContent).toContain('Saved — from Oct 11, 2026, 2 products stay on sale.')
    expect(box('Kurta').checked).toBe(true)
    expect(box('Saree').checked).toBe(false)
  })

  it('keeps the API’s refusal on the page', async () => {
    billing.keepProducts.mockRejectedValue(new ApiError('TOO_MANY', 'no'))
    await show(owner)
    fireEvent.click(saveButton())
    await settle()
    expect(screen.getByRole('alert').textContent).toBe(messages.billing.refused.TOO_MANY)
  })

  it('shows more products a page at a time', async () => {
    products.loadProducts.mockResolvedValueOnce(page(rows, 'c1')).mockResolvedValueOnce(page([row('p5', 'Scarf')]))
    await show(owner)
    fireEvent.click(screen.getByRole('button', { name: words.more }))
    await settle()
    expect(products.loadProducts).toHaveBeenLastCalledWith({ filter: 'all', search: '', supplier: '', sort: 'name' }, { after: 'c1' })
    expect(box('Scarf').checked).toBe(false)
    expect(screen.queryByRole('button', { name: words.more })).toBeNull()
  })

  it('on the plan it is on, saves for now', async () => {
    billing.loadPlanKeep.mockResolvedValue({ ...keep, from: null })
    await show(owner)
    expect(screen.getByText(/You’re on Free, which keeps 2 products/)).toBeTruthy()
    expect(screen.getByRole('button', { name: words.save })).toBeTruthy()
  })

  it('says there is nothing to choose when the plan holds every product', async () => {
    for (const answer of [null, { ...keep, products: 2, paused: 0 }]) {
      billing.loadPlanKeep.mockResolvedValueOnce(answer)
      await show(owner)
      expect(screen.getByText(words.nothing.title)).toBeTruthy()
      expect(screen.getByRole('link', { name: words.nothing.action }).getAttribute('href')).toBe('/billing')
      cleanup()
    }
  })

  it('never lets a late read replace the one after it', async () => {
    let answer: (k: PlanKeep) => void = () => undefined
    billing.loadPlanKeep.mockReturnValueOnce(new Promise<PlanKeep>((resolve) => (answer = resolve)))
    const router = await show(owner)
    await act(() => router.navigate({ to: '/billing/keep', search: { state: 'current' } }))
    await settle()
    answer({ ...keep, plan: { id: 'late', name: 'Late plan' } })
    await settle()
    expect(screen.queryByText(/Late plan/)).toBeNull()
  })

  it('says the products didn’t load and reads again on Try again', async () => {
    billing.loadPlanKeep.mockRejectedValueOnce(new Error('down'))
    await show(owner)
    fireEvent.click(screen.getByRole('button', { name: words.error.retry }))
    await settle()
    expect(box('Saree').checked).toBe(true)
  })
})

describe('who may choose', () => {
  it('turns away a Manager and a supplier without asking the API', async () => {
    for (const acting of [manager, supplier]) {
      await show(acting)
      expect(screen.getByText(words.denied.body)).toBeTruthy()
      cleanup()
    }
    expect(billing.loadPlanKeep).not.toHaveBeenCalled()
  })

  it('lets a read-only store and a support session look, never change', async () => {
    for (const state of [
      { readOnly: true, support: null },
      { readOnly: false, support: { partnerName: 'Kesari Commerce' } },
    ]) {
      await show(owner, state)
      expect(box('Saree').disabled).toBe(true)
      expect(screen.queryByRole('button', { name: /Keep these/ })).toBeNull()
      cleanup()
    }
  })
})
