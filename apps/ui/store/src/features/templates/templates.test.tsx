// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createMemoryHistory, createRootRoute, createRoute, createRouter, Outlet, RouterProvider } from '@tanstack/react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Acting } from '../../api/shell'
import type { StorefrontTemplate } from '../../api/storefront'
import { fill, messages } from '../../messages'

// Card #1733: the Templates showroom (FIRST-RELEASE §14), every template's demo and nothing of this store.

const words = messages.templates

const api = vi.hoisted(() => ({ loadTemplates: vi.fn(), chooseTemplate: vi.fn() }))
vi.mock('../../api/storefront', async (actual) => ({ ...(await actual<typeof import('../../api/storefront')>()), ...api }))

const { TemplatesPage } = await import('./TemplatesPage')

const template = (key: string, name: string, tag: string, demoUrl: string | null): StorefrontTemplate => ({ key, name, tag, description: `${name} look`, demoUrl, current: key === 'classic', forCategory: false })
const templates = [
  template('classic', 'Classic', 'General', null),
  template('baseline', 'Start from scratch', 'Blank', null),
  template('fashion', 'Thread', 'Fashion & apparel', 'https://demo.my-store.one/?theme=fashion'),
  template('grocery', 'Basket', 'Food & grocery', 'http://demo.my-store.one/?theme=grocery'),
]

const owner: Acting = { store: { id: 's1', name: 'Kesari' }, role: 'owner', tier: null, seller: null, plan: null, permissions: ['storefront.read', 'publish'] }
const manager: Acting = { ...owner, role: 'manager', permissions: ['storefront.read'] }
const staff: Acting = { ...owner, role: 'staff', permissions: ['orders.read'] }
const supplier: Acting = { ...owner, role: 'supplier-member', tier: 'vendor-catalogue', seller: { id: 'v1', name: 'Northwind' }, permissions: ['catalog.read', 'storefront.read'] }

const settle = () => act(async () => new Promise((resolve) => setTimeout(resolve, 0)))

const show = async (acting: Acting, search = '') => {
  const root = createRootRoute({ component: Outlet })
  const app = createRoute({ getParentRoute: () => root, id: '_app', loader: () => ({ acting, state: { readOnly: false } }), component: Outlet })
  const page = createRoute({ getParentRoute: () => app, path: '/templates', component: TemplatesPage })
  const router = createRouter({ routeTree: root.addChildren([app.addChildren([page])]), history: createMemoryHistory({ initialEntries: [`/templates${search}`] }) })
  await act(async () => {
    render(<RouterProvider router={router} />)
  })
  await settle()
}

beforeEach(() => {
  api.loadTemplates.mockResolvedValue(templates)
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('Templates', () => {
  it('shows each template as a card, its Preview opening the demo in a new tab', async () => {
    await show(owner)
    expect(screen.getByRole('heading', { level: 1, name: words.title })).toBeTruthy()
    const preview = screen.getByRole('link', { name: fill(words.previewLabel, { name: 'Thread' }) })
    expect(preview.getAttribute('href')).toBe('https://demo.my-store.one/?theme=fashion')
    expect(preview.getAttribute('target')).toBe('_blank')
    expect(preview.getAttribute('rel')).toBe('noopener noreferrer')
  })

  it('says "Demo coming soon" where there is no demo, or one that isn’t https', async () => {
    await show(manager)
    const soon = screen.getAllByRole('button', { name: words.soon })
    expect(soon).toHaveLength(2)
    expect(soon.every((b) => (b as HTMLButtonElement).disabled)).toBe(true)
    expect(screen.queryByRole('link', { name: fill(words.previewLabel, { name: 'Basket' }) })).toBeNull()
  })

  it('leaves out "Start from scratch", marks no current look, and offers no way to change the store', async () => {
    await show(owner)
    expect(screen.queryByRole('heading', { name: 'Start from scratch' })).toBeNull()
    expect(screen.queryByText(messages.storefront.gallery.current)).toBeNull()
    expect(screen.queryByRole('button', { name: messages.storefront.gallery.use })).toBeNull()
    expect(api.chooseTemplate).not.toHaveBeenCalled()
  })

  it('filters by category once there are two', async () => {
    await show(owner)
    expect(screen.getByText(messages.storefront.gallery.filter.label)).toBeTruthy()
  })

  it('turns away Staff and suppliers without asking the API', async () => {
    for (const seat of [staff, supplier]) {
      await show(seat)
      expect(screen.getByText(words.denied.title)).toBeTruthy()
      cleanup()
    }
    expect(api.loadTemplates).not.toHaveBeenCalled()
  })

  it('shows a failed read with Try again, which reads again', async () => {
    api.loadTemplates.mockRejectedValueOnce(new Error('offline'))
    await show(owner)
    expect(screen.getByText(words.error.title)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: words.error.retry }))
    await settle()
    expect(screen.getByRole('heading', { name: 'Thread' })).toBeTruthy()
  })

  it('says so when there are no templates', async () => {
    api.loadTemplates.mockResolvedValue([template('baseline', 'Start from scratch', 'Blank', null)])
    await show(owner)
    expect(screen.getByText(words.emptyTitle)).toBeTruthy()
  })

  it.each(['loading', 'error', 'empty', 'denied'] as const)('draws ?state=%s', async (state) => {
    await show(owner, `?state=${state}`)
    const expected = { loading: words.loading, error: words.error.title, empty: words.emptyTitle, denied: words.denied.title }[state]
    expect(screen.getAllByText(expected).length).toBeGreaterThan(0)
  })
})
