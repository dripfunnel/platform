// @vitest-environment happy-dom
import { ApiError } from '@dripfunnel/shared/graphql'
import { idParam, searchParam } from '@dripfunnel/shared/search'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { createMemoryHistory, createRootRoute, createRoute, createRouter, Outlet, RouterProvider } from '@tanstack/react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import type { Collection, CollectionSummary } from '../../api/collections'
import type { Facet } from '../../api/productEditor'
import type { Acting } from '../../api/shell'
import { messages } from '../../messages'

// CatCollections driven as the merchant would: the list, a new collection by rules or by hand, an edit, a delete.

const words = messages.collections
const e = words.editor

const api = vi.hoisted(() => ({
  loadCollections: vi.fn(),
  loadCollection: vi.fn(),
  loadMembers: vi.fn(),
  searchPickable: vi.fn(),
  previewCollection: vi.fn(),
  saveCollection: vi.fn(),
  deleteCollection: vi.fn(),
  loadMarketCountries: vi.fn(),
}))
vi.mock('../../api/collections', () => api)
const editorApi = vi.hoisted(() => ({ loadFacets: vi.fn(), loadProductBasics: vi.fn() }))
vi.mock('../../api/productEditor', () => editorApi)
const menuApi = vi.hoisted(() => ({ loadMenu: vi.fn() }))
vi.mock('../../api/menu', () => menuApi)

const { CollectionsPage } = await import('./CollectionsPage')

const owner: Acting = { store: { id: 's1', name: 'Kesari' }, role: 'owner', tier: null, seller: null, plan: null, permissions: ['catalog.read', 'catalog.write'] }
const staff: Acting = { ...owner, role: 'staff', permissions: ['catalog.read'] }

const facets: Facet[] = [
  { id: 'fabric', name: 'Fabric', shopperVisible: true, values: [{ id: 'linen', name: 'Linen' }, { id: 'cotton', name: 'Cotton' }] },
  { id: 'occasion', name: 'Occasion', shopperVisible: true, values: [{ id: 'wedding', name: 'Wedding' }] },
]
const filterRule = (valueId: string) => ({ kind: 'filter_value', valueId, text: null, productId: null, versionId: null, currency: null, min: null, max: null })
const summary = (c: Partial<CollectionSummary> & Pick<CollectionSummary, 'id' | 'name'>): CollectionSummary => ({ kind: 'manual', visible: true, parentId: null, inheritParent: false, match: 'all', rules: [], products: 0, computedAt: '2026-10-05T09:00:00Z', ...c })
const summer = summary({ id: 'c1', name: 'Summer edit', kind: 'automatic', rules: [filterRule('linen'), filterRule('cotton')], products: 18 })
const men = summary({ id: 'c2', name: 'Men', products: 42 })
const shirts = summary({ id: 'c3', name: 'Shirts', parentId: 'c2', inheritParent: true, kind: 'automatic', rules: [filterRule('linen')], products: 7, computedAt: null })
const offer = summary({ id: 'c4', name: 'Staff picks', visible: false, products: 5 })

const full = (c: Partial<Collection> & Pick<Collection, 'id' | 'name'>): Collection => ({ slug: 'x', description: '', kind: 'manual', match: 'all', parentId: null, inheritParent: false, visible: true, imageAssetId: null, sort: 'manual', seoTitle: null, seoDescription: null, revision: 3, rules: [], ...c })

const settle = (ms = 0) => act(async () => new Promise((resolve) => setTimeout(resolve, ms)))

const show = async (acting: Acting = owner, path = '/collections', readOnly = false) => {
  const root = createRootRoute({ component: Outlet })
  const app = createRoute({ getParentRoute: () => root, id: '_app', loader: () => ({ acting, state: { readOnly } }), component: Outlet })
  const page = createRoute({ getParentRoute: () => app, path: '/collections', validateSearch: z.looseObject({ edit: idParam, name: searchParam }), component: CollectionsPage })
  const router = createRouter({ routeTree: root.addChildren([app.addChildren([page])]), history: createMemoryHistory({ initialEntries: [path] }) })
  await act(async () => {
    render(<RouterProvider router={router} />)
  })
  await settle()
  return router
}

beforeEach(() => {
  api.loadCollections.mockResolvedValue([summer, men, shirts, offer])
  api.loadMarketCountries.mockResolvedValue(['IN'])
  api.previewCollection.mockResolvedValue({ count: 0, products: [] })
  api.searchPickable.mockResolvedValue([])
  api.loadMembers.mockResolvedValue([])
  editorApi.loadFacets.mockResolvedValue(facets)
  editorApi.loadProductBasics.mockResolvedValue({ pricingCurrency: 'INR' })
  menuApi.loadMenu.mockResolvedValue(null)
})

afterEach(() => {
  cleanup()
  vi.resetAllMocks()
})

const row = (name: string) => screen.getByRole('link', { name: `Open ${name}` })

describe('the collections list', () => {
  it('nests children under their parents and says what each holds, how many, and whether shoppers see it', async () => {
    await show()
    const rows = within(screen.getByRole('list', { name: words.list.label })).getAllByRole('link')
    expect(rows.map((r) => r.getAttribute('aria-label'))).toEqual(['Open Summer edit', 'Open Men', 'Open Shirts', 'Open Staff picks'])
    expect(within(row('Summer edit')).getByText('Fabric is Linen or Cotton')).toBeTruthy()
    expect(within(row('Summer edit')).getByText('Automatic · 1 rule')).toBeTruthy()
    expect(within(row('Men')).getByText('42 picked')).toBeTruthy()
    expect(within(row('Shirts')).getByText('Inside Men · only products also there')).toBeTruthy()
    expect(within(row('Shirts')).getByText('Updating… 7 so far')).toBeTruthy()
    expect(within(row('Staff picks')).getByText(words.list.hidden)).toBeTruthy()
  })

  it('suggests what is coming up in the store’s markets, and starts a hand-picked one from it', async () => {
    vi.useFakeTimers({ now: new Date('2026-10-06T00:00:00Z'), shouldAdvanceTime: true })
    const router = await show()
    vi.useRealTimers()
    expect(screen.getByText(words.seasonal.label)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '+ Diwali' }))
    await settle()
    expect(router.state.location.search).toEqual({ edit: 'new', name: 'Diwali' })
    expect((screen.getByLabelText(e.name) as HTMLInputElement).value).toBe('Diwali')
    expect((screen.getByRole('radio', { name: new RegExp(e.manual) }) as HTMLInputElement).checked).toBe(true)
  })

  it('explains collections when there are none, with an example in the store’s currency', async () => {
    api.loadCollections.mockResolvedValue([])
    await show()
    expect(screen.getByRole('heading', { name: words.empty.title })).toBeTruthy()
    expect(screen.getByText(/Gifts under ₹999/)).toBeTruthy()
    expect(screen.getByRole('button', { name: words.empty.action })).toBeTruthy()
  })

  it('shows the error with a retry that loads again', async () => {
    api.loadCollections.mockRejectedValueOnce(new Error('offline'))
    await show()
    expect(screen.getByText(words.error.title)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: words.error.retry }))
    await settle()
    expect(api.loadCollections).toHaveBeenCalledTimes(2)
    expect(row('Men')).toBeTruthy()
  })

  it('lets staff and a read-only store look without changing, and tells a seat without the catalogue it can’t see them', async () => {
    for (const [acting, readOnly] of [[staff, false], [owner, true]] as const) {
      await show(acting, '/collections', readOnly)
      expect(screen.getByText(words.viewOnly)).toBeTruthy()
      expect(screen.queryByRole('button', { name: words.create })).toBeNull()
      expect(screen.queryByText(words.seasonal.label)).toBeNull()
      cleanup()
    }
    api.loadCollection.mockResolvedValue(full({ id: 'c2', name: 'Men' }))
    await show(staff, '/collections?edit=c2')
    await settle()
    expect((screen.getByLabelText(e.name) as HTMLInputElement).readOnly).toBe(true)
    expect(screen.queryByRole('button', { name: e.save })).toBeNull()
    cleanup()
    api.loadCollections.mockClear()
    await show({ ...owner, permissions: [] })
    expect(screen.getByRole('heading', { name: words.denied.title })).toBeTruthy()
    expect(api.loadCollections).not.toHaveBeenCalled()
  })
})

describe('a collection being made or changed', () => {
  it('fills by rules: previews what they hold as they change, needs a name, then saves and goes back to the list', async () => {
    api.previewCollection.mockResolvedValue({ count: 2, products: [{ id: 'p1', name: 'Mara Linen Shirt' }, { id: 'p2', name: 'Linen Kurta' }] })
    api.saveCollection.mockResolvedValue({ id: 'c9', revision: 1 })
    const router = await show(owner, '/collections?edit=new')
    expect(document.activeElement).toBe(screen.getByLabelText(e.name))
    fireEvent.click(screen.getByRole('button', { name: 'Linen' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cotton' }))
    fireEvent.click(screen.getByRole('button', { name: e.addRule }))
    fireEvent.change(screen.getByLabelText('Rule 2: what to match'), { target: { value: 'occasion' } })
    fireEvent.click(screen.getByRole('button', { name: 'Wedding' }))
    await settle(350)
    expect(api.previewCollection).toHaveBeenLastCalledWith({ match: 'all', rules: [{ kind: 'filter_value', valueId: 'linen' }, { kind: 'filter_value', valueId: 'cotton' }, { kind: 'filter_value', valueId: 'wedding' }], parentId: null, inheritParent: false })
    expect(screen.getByRole('heading', { name: '2 products match' })).toBeTruthy()
    expect(screen.getByText('Mara Linen Shirt')).toBeTruthy()
    // No name: said beside the field, which takes focus; nothing saved.
    screen.getByRole('button', { name: e.save }).focus()
    fireEvent.click(screen.getByRole('button', { name: e.save }))
    const name = screen.getByLabelText(e.name)
    expect(api.saveCollection).not.toHaveBeenCalled()
    expect(document.getElementById(name.getAttribute('aria-describedby') ?? '')?.textContent).toBe(e.nameMissing)
    expect(document.activeElement).toBe(name)
    fireEvent.change(name, { target: { value: 'Wedding linen' } })
    fireEvent.click(screen.getByRole('button', { name: e.save }))
    await settle()
    expect(api.saveCollection).toHaveBeenCalledWith(null, null, expect.objectContaining({ name: 'Wedding linen', kind: 'automatic', match: 'all', productIds: [], rules: expect.arrayContaining([{ kind: 'filter_value', valueId: 'wedding' }]) }))
    expect(router.state.location.search).toEqual({})
    expect(screen.getByText('“Wedding linen” saved — filling in the background')).toBeTruthy()
    expect(api.loadCollections).toHaveBeenCalledTimes(2)
  })

  it('offers how it fills as one radio group, native inputs sharing a name, so the arrow keys move between them', async () => {
    await show(owner, '/collections?edit=new')
    const group = screen.getByRole('radiogroup', { name: e.fill })
    const radios = within(group).getAllByRole('radio') as HTMLInputElement[]
    expect(radios.map((r) => [r.type, r.checked])).toEqual([['radio', true], ['radio', false]])
    expect(new Set(radios.map((r) => r.name)).size).toBe(1)
    fireEvent.click(radios[1] as HTMLInputElement)
    expect(screen.getByRole('searchbox', { name: e.search })).toBeTruthy()
  })

  it('says when the preview didn’t load, keeping the rules', async () => {
    api.previewCollection.mockRejectedValue(new Error('offline'))
    await show(owner, '/collections?edit=new')
    fireEvent.click(screen.getByRole('button', { name: 'Linen' }))
    await settle(350)
    expect(screen.getByText(e.previewFailed)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Linen' }).getAttribute('aria-pressed')).toBe('true')
  })

  it('edits a hand-picked collection at the revision read, adding a product found by search', async () => {
    api.loadCollection.mockResolvedValue(full({ id: 'c2', name: 'Men', revision: 3 }))
    api.loadMembers.mockResolvedValue([{ id: 'p1', name: 'Mara Linen Shirt' }])
    api.searchPickable.mockResolvedValue([{ id: 'p1', name: 'Mara Linen Shirt', visible: true, approval: null }, { id: 'p2', name: 'Indigo Kurta', visible: false, approval: null }])
    api.saveCollection.mockResolvedValue({ id: 'c2', revision: 4 })
    await show(owner, '/collections?edit=c2')
    await settle(350)
    expect(screen.getByRole('heading', { name: '1 product picked' })).toBeTruthy()
    fireEvent.change(screen.getByLabelText(e.search), { target: { value: 'kurta' } })
    await settle(350)
    expect(api.searchPickable).toHaveBeenLastCalledWith('kurta')
    fireEvent.click(screen.getByRole('checkbox', { name: /Indigo Kurta/ }))
    expect(screen.getByRole('heading', { name: '2 products picked' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: e.save }))
    await settle()
    expect(api.saveCollection).toHaveBeenCalledWith('c2', 3, expect.objectContaining({ kind: 'manual', productIds: ['p1', 'p2'], rules: [] }))
  })

  it('keeps the form and says why when the save is refused', async () => {
    api.loadCollection.mockResolvedValue(full({ id: 'c2', name: 'Men' }))
    api.saveCollection.mockRejectedValue(new ApiError('STALE_REVISION', 'stale'))
    await show(owner, '/collections?edit=c2')
    fireEvent.change(screen.getByLabelText(e.name), { target: { value: 'Menswear' } })
    fireEvent.click(screen.getByRole('button', { name: e.save }))
    await settle()
    expect(screen.getByRole('alert').textContent).toBe(words.refused.STALE_REVISION)
    expect((screen.getByLabelText(e.name) as HTMLInputElement).value).toBe('Menswear')
  })

  it('narrows a child to its parent, saying how the counts flow', async () => {
    api.previewCollection.mockResolvedValue({ count: 3, products: [] })
    await show(owner, '/collections?edit=new')
    fireEvent.change(screen.getByLabelText(e.name), { target: { value: 'Linen shirts' } })
    fireEvent.change(screen.getByRole('combobox', { name: e.parentTitle }), { target: { value: 'c2' } })
    await settle(350)
    expect((screen.getByRole('checkbox', { name: 'Only show products that are also in Men' }) as HTMLInputElement).checked).toBe(true)
    expect(screen.getByText('Men · 42 → narrowed by your rules → Linen shirts · 3')).toBeTruthy()
    expect(api.previewCollection).toHaveBeenLastCalledWith(expect.objectContaining({ parentId: 'c2', inheritParent: true }))
    // Only top-level collections, and never itself, can be its parent.
    expect(within(screen.getByRole('combobox', { name: e.parentTitle })).getAllByRole('option').map((o) => o.textContent)).toEqual([e.topLevel, 'Inside Summer edit', 'Inside Men', 'Inside Staff picks'])
  })

  it('deletes after saying the products stay and the menu loses it', async () => {
    api.loadCollection.mockResolvedValue(full({ id: 'c2', name: 'Men' }))
    menuApi.loadMenu.mockResolvedValue({ name: 'Main', revision: 1, items: [{ id: 'm1', parentId: null, kind: 'collection', label: 'Men', collectionId: 'c2', url: null }] })
    api.deleteCollection.mockResolvedValue(undefined)
    await show(owner, '/collections?edit=c2')
    fireEvent.click(screen.getByRole('button', { name: e.delete }))
    const dialog = within(document.querySelector('dialog') as HTMLElement)
    expect(dialog.getByText(`The 42 products stay in your catalogue — only the group goes. ${e.deleteMenu}`)).toBeTruthy()
    fireEvent.click(dialog.getByRole('button', { name: e.deleteConfirm }))
    await settle()
    expect(api.deleteCollection).toHaveBeenCalledWith('c2')
    expect(screen.getByText('“Men” deleted. Its products are untouched.')).toBeTruthy()
  })

  it('says a collection that isn’t there isn’t there, and one that didn’t load can be tried again', async () => {
    api.loadCollection.mockResolvedValueOnce(null)
    await show(owner, '/collections?edit=gone')
    expect(screen.getByRole('heading', { name: e.notFound.title })).toBeTruthy()
    cleanup()
    api.loadCollection.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(full({ id: 'c2', name: 'Men' }))
    await show(owner, '/collections?edit=c2')
    expect(screen.getByText(e.loadFailed.title)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: words.error.retry }))
    await settle()
    expect((screen.getByLabelText(e.name) as HTMLInputElement).value).toBe('Men')
  })
})
