// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { createMemoryHistory, createRootRoute, createRoute, createRouter, Outlet, RouterProvider } from '@tanstack/react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { StoreCategory } from '../../api/storeCategories'
import type { StaffRole } from '../shell/staffRoles'
import { formatDate, messages } from '../../messages'

// A category’s sample catalog on the Store categories screen (CATALOG-DESIGN K13a): every role sees it; Super admin alone
// adds DripFunnel’s default sample, resets it or removes it, each with a reason; a refused check lists its problems in place.

const words = messages.storeCategories
const api = vi.hoisted(() => ({ addDefaultStoreCategorySample: vi.fn(), removeStoreCategorySample: vi.fn() }))
vi.mock('../../api/storeCategories', async (actual) => ({ ...(await actual<typeof import('../../api/storeCategories')>()), ...api }))

const { StoreCategoriesScreen } = await import('./StoreCategoriesScreen')

const footwear: StoreCategory = {
  id: 'c3',
  key: 'footwear',
  names: [{ language: 'en', name: 'Footwear' }],
  sections: ['sizeCharts'],
  archivedAt: null,
  storeCount: 2,
  hasDefaultSample: true,
  template: null,
  sample: { currency: 'INR', products: 6, collections: [{ name: 'Sneakers', products: 4 }, { name: 'Sandals', products: 2 }], photos: 9, uploadedAt: '2026-11-16T09:00:00.000Z' },
}
const watches: StoreCategory = { ...footwear, id: 'c6', key: 'watches', names: [{ language: 'en', name: 'Watches' }], sample: null }
const custom: StoreCategory = { ...footwear, id: 'c31', key: 'custom', names: [{ language: 'en', name: 'Custom' }], hasDefaultSample: false, sample: null }

let loads = 0
const show = async (role: StaffRole) => {
  const root = createRootRoute({ component: Outlet })
  const app = createRoute({ getParentRoute: () => root, id: '_app', loader: () => ({ me: { id: 's1', name: 'Asha', email: 'asha@dripfunnel.example', role } }), component: Outlet })
  const page = createRoute({
    getParentRoute: () => app,
    path: 'categories',
    loader: () => {
      loads += 1
      return [footwear, watches, custom]
    },
    component: StoreCategoriesScreen,
  })
  const editor = createRoute({ getParentRoute: () => app, path: 'categories/$categoryId/sample', component: () => null })
  const router = createRouter({ routeTree: root.addChildren([app.addChildren([page, editor])]), history: createMemoryHistory({ initialEntries: ['/categories'] }) })
  await act(async () => {
    render(<RouterProvider router={router} />)
  })
}

const dialog = () => screen.getByRole('dialog', { hidden: true })
const reason = (text: string) => fireEvent.change(within(dialog()).getByLabelText(words.reason.label), { target: { value: text } })
const confirm = (label: string) => act(async () => fireEvent.click(within(dialog()).getByRole('button', { name: label, hidden: true })))
beforeEach(() => {
  loads = 0
  api.addDefaultStoreCategorySample.mockReset()
  api.removeStoreCategorySample.mockReset()
})
afterEach(cleanup)

describe('a category’s sample catalog', () => {
  it('shows each category’s sample, or that it has none', async () => {
    await show('staff-support')
    expect(screen.getByText(`Sample: 6 products · 2 collections · INR · added ${formatDate('2026-11-16T09:00:00.000Z')}`)).toBeTruthy()
    expect(screen.getAllByText(words.sample.none).length).toBeGreaterThan(0)
  })

  it('links every role to a sample to view it, and Super admin to start one where there is none', async () => {
    await show('staff-support')
    expect(screen.getByRole('link', { name: `${words.sample.view}: Footwear` }).getAttribute('href')).toBe('/categories/c3/sample')
    expect(screen.queryByRole('link', { name: `${words.sample.create}: Watches` })).toBeNull()
    cleanup()
    await show('staff-super-admin')
    expect(screen.getByRole('link', { name: `${words.sample.create}: Watches` }).getAttribute('href')).toBe('/categories/c6/sample')
  })

  it('lets only Super admin add, reset or remove it, and offers the default only where DripFunnel has one', async () => {
    await show('staff-support')
    expect(screen.queryByRole('button', { name: new RegExp(words.sample.addDefault) })).toBeNull()
    expect(screen.queryByRole('button', { name: new RegExp(words.sample.reset) })).toBeNull()
    expect(screen.queryByRole('button', { name: new RegExp(words.sample.remove) })).toBeNull()
    cleanup()
    await show('staff-super-admin')
    expect(screen.getByRole('button', { name: `${words.sample.reset}: Footwear` })).toBeTruthy()
    expect(screen.getByRole('button', { name: `${words.sample.remove}: Footwear` })).toBeTruthy()
    expect(screen.getByRole('button', { name: `${words.sample.addDefault}: Watches` })).toBeTruthy()
    expect(screen.queryByRole('button', { name: `${words.sample.remove}: Watches` })).toBeNull()
    expect(screen.queryByRole('button', { name: `${words.sample.addDefault}: Custom` })).toBeNull()
  })

  it('adds the default with a reason, lists problems if its check refuses it, then closes and reloads once saved', async () => {
    api.addDefaultStoreCategorySample
      .mockResolvedValueOnce({ category: null, problems: [{ line: 4, column: 'sku', code: 'SKU_REQUIRED', message: 'Every product needs a SKU.' }, { line: 0, column: null, code: 'NOT_SIX_PRODUCTS', message: 'A sample has exactly 6 products.' }] })
      .mockResolvedValueOnce({ category: { ...watches, sample: footwear.sample }, problems: [] })
    await show('staff-super-admin')
    await act(async () => fireEvent.click(screen.getByRole('button', { name: `${words.sample.addDefault}: Watches` })))
    expect(within(dialog()).getByText(words.sample.addDefaultConsequence.replace('{name}', 'Watches'))).toBeTruthy()
    reason('Launch samples')
    await confirm(words.sample.addDefault)
    expect(api.addDefaultStoreCategorySample).toHaveBeenCalledWith('c6', 'Launch samples')
    expect(within(dialog()).getByText(/Line 4, sku: Every product needs a SKU\./)).toBeTruthy()
    expect(within(dialog()).getByText(/The file: A sample has exactly 6 products\./)).toBeTruthy()
    expect(within(dialog()).getByText(words.sample.refused)).toBeTruthy()
    const before = loads
    await confirm(words.sample.addDefault)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(loads).toBeGreaterThan(before)
  })

  it('removes it with a reason, saying stores that added it keep their products', async () => {
    api.removeStoreCategorySample.mockResolvedValue({ ...footwear, sample: null })
    await show('staff-super-admin')
    await act(async () => fireEvent.click(screen.getByRole('button', { name: `${words.sample.remove}: Footwear` })))
    expect(within(dialog()).getByText(words.sample.removeConsequence)).toBeTruthy()
    reason('Out of date')
    await confirm(words.sample.removeConfirm)
    expect(api.removeStoreCategorySample).toHaveBeenCalledWith('c3', 'Out of date')
  })
})
