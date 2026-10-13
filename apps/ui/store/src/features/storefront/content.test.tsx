// @vitest-environment happy-dom
import { ApiError } from '@dripfunnel/shared/graphql'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { createMemoryHistory, createRootRoute, createRoute, createRouter, Outlet, RouterProvider } from '@tanstack/react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ContentEntry, ContentRow } from '../../api/content'
import type { Acting } from '../../api/shell'
import type { StorefrontBrand, StorefrontOverview } from '../../api/storefront'
import { fill, formatDay, formatTime, messages } from '../../messages'
import { storefrontSearch } from './storefrontSearch'

// Storefront › Pages driven by each seat (StorefrontContent; FIRST-RELEASE §14): the list with the AI's pages, the editor, the clash.

const c = messages.storefront.content
const e = c.editor
const p = c.pages

const api = vi.hoisted(() => ({ loadBrand: vi.fn(), loadSeo: vi.fn(), loadDomains: vi.fn(), loadOverview: vi.fn(), loadTemplates: vi.fn(), loadPoweredBy: vi.fn(), loadMeters: vi.fn() }))
vi.mock('../../api/storefront', async (actual) => ({ ...(await actual<typeof import('../../api/storefront')>()), ...api }))
const content = vi.hoisted(() => ({ loadContentList: vi.fn(), loadCustomPaths: vi.fn(), loadContentEntry: vi.fn(), saveContent: vi.fn(), deleteContent: vi.fn() }))
vi.mock('../../api/content', async (actual) => ({ ...(await actual<typeof import('../../api/content')>()), ...content }))

const offers = vi.hoisted(() => ({ loadProductNames: vi.fn() }))
vi.mock('../../api/offers', async (actual) => ({ ...(await actual<typeof import('../../api/offers')>()), ...offers }))
const upload = vi.hoisted(() => ({ uploadPhoto: vi.fn() }))
vi.mock('../../api/productEditor', () => upload)
const products = vi.hoisted(() => ({ loadProducts: vi.fn() }))
vi.mock('../../api/products', async (actual) => ({ ...(await actual<typeof import('../../api/products')>()), ...products }))

const { StorefrontPage } = await import('./StorefrontPage')

const owner: Acting = { store: { id: 's1', name: 'Kesari' }, role: 'owner', tier: null, seller: null, plan: null, permissions: ['catalog.read', 'storefront.read', 'publish'] }
const manager: Acting = { ...owner, role: 'manager', permissions: ['catalog.read', 'storefront.read'] }

const brand: StorefrontBrand = { brandReady: true, shopName: 'Kesari Threads', logoAssetId: 'a-logo', faviconAssetId: null, primaryColour: null, secondaryColour: null, tagline: null, description: null, social: { instagram: null, facebook: null, x: null, youtube: null, tiktok: null, whatsapp: null }, contactEmail: 'hello@kesari.in', contactPhone: null, contactAddress: null, voice: null }
const overview: StorefrontOverview = { status: 'same_as_live', template: 'linen', live: { number: 12, publishedAt: '2026-10-09T10:40:00Z', template: 'linen', portalOrigin: null }, draft: null, lastPublish: null }

const row = (over: Partial<ContentRow> = {}): ContentRow => ({ id: '11111111-1111-4111-8111-111111111111', title: 'Questions we get asked', path: '/faq', status: 'published', inMenu: true, publishAt: null, author: null, waitingForPublish: false, updatedAt: '2026-10-09T10:40:00Z', ...over })
const faq: ContentEntry = {
  ...row(),
  kind: 'page',
  slug: 'faq',
  body: [
    { kind: 'heading', text: 'Questions', assetId: null, alt: null, items: null, productIds: null },
    { kind: 'faq', text: null, assetId: null, alt: null, items: [{ question: 'Delivery?', answer: '3–5 days.' }], productIds: null },
    { kind: 'products', text: null, assetId: null, alt: null, items: null, productIds: ['p1', 'p2'] },
  ],
  seoTitle: null,
  seoDescription: 'Delivery and returns.',
  tags: [],
  coverAssetId: null,
  revision: 3,
}
const j = c.journal
const postRow = (over: Partial<ContentRow> = {}): ContentRow => row({ id: '44444444-4444-4444-8444-444444444444', title: 'Caring for linen', path: '/blog/caring-for-linen', inMenu: false, publishAt: '2026-09-14T09:00:00.000Z', author: 'Priya Shah', ...over })
const linen: ContentEntry = { ...faq, ...postRow(), kind: 'post', slug: 'caring-for-linen', body: [{ kind: 'text', text: 'Wash cool.', assetId: null, alt: null, items: null, productIds: null }], tags: ['care'], coverAssetId: null, seoDescription: null }
const lookbook = row({ id: '22222222-2222-4222-8222-222222222222', title: 'Lookbook', path: '/lookbook', status: 'draft', inMenu: false })

const settle = () => act(async () => new Promise((resolve) => setTimeout(resolve, 0)))

const show = async ({ acting = owner, entry, tab = 'pages' }: { acting?: Acting; entry?: string; tab?: 'pages' | 'journal' } = {}) => {
  const root = createRootRoute({ component: Outlet })
  const app = createRoute({ getParentRoute: () => root, id: '_app', loader: () => ({ acting, state: { readOnly: false } }), component: Outlet })
  const page = createRoute({ getParentRoute: () => app, path: '/storefront', validateSearch: storefrontSearch, component: StorefrontPage })
  const router = createRouter({ routeTree: root.addChildren([app.addChildren([page])]), history: createMemoryHistory({ initialEntries: [`/storefront?tab=${tab}${entry ? `&entry=${entry}` : ''}`] }) })
  await act(async () => {
    render(<RouterProvider router={router} />)
  })
  await settle()
  await settle()
  return router
}

const slugInput = () => screen.getByRole('textbox', { name: e.slug }) as HTMLInputElement
const describedBy = (el: HTMLElement) => document.getElementById(el.getAttribute('aria-describedby') ?? '')?.textContent

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 404 })))
  api.loadBrand.mockResolvedValue(brand)
  api.loadSeo.mockResolvedValue({ title: null, description: null, shareImageAssetId: null })
  api.loadDomains.mockResolvedValue({ customDomainAllowed: true, domains: [{ id: null, host: 'kesari.shops.example.com', kind: 'free', status: 'live', primary: true, checkedAt: null, records: [] }] })
  api.loadOverview.mockResolvedValue(overview)
  api.loadTemplates.mockResolvedValue([])
  api.loadPoweredBy.mockResolvedValue({ removed: true, removable: false })
  api.loadMeters.mockRejectedValue(new Error('not under test'))
  content.loadContentList.mockResolvedValue({ rows: [row(), lookbook, row({ id: '33333333-3333-4333-8333-333333333333', title: 'Autumn', path: '/autumn', status: 'scheduled', inMenu: false })], next: null })
  content.loadCustomPaths.mockResolvedValue(['/about'])
  content.loadContentEntry.mockResolvedValue(faq)
  content.saveContent.mockImplementation((_kind: string, id: string | null, _revision: number | null, input: { title: string; slug: string }) => Promise.resolve({ ...faq, id: id ?? 'new-id', title: input.title, slug: input.slug }))
  content.deleteContent.mockResolvedValue(undefined)
  offers.loadProductNames.mockResolvedValue(new Map([['p1', 'Indigo kurta']]))
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.resetAllMocks()
})

describe('the Pages list', () => {
  it('lists the content pages with their status and the AI’s pages, each opening the studio on that page for the Owner', async () => {
    const router = await show()
    expect(screen.getByRole('heading', { name: p.title })).toBeTruthy()
    const rows = screen.getAllByRole('listitem')
    expect(within(rows[0] as HTMLElement).getByText('Questions we get asked')).toBeTruthy()
    expect(within(rows[0] as HTMLElement).getByText(c.status.published)).toBeTruthy()
    expect(within(rows[0] as HTMLElement).getByText('/faq')).toBeTruthy()
    expect(within(rows[0] as HTMLElement).getByText(fill(p.inMenu, { meta: fill(p.edited, { date: formatTime('2026-10-09T10:40:00Z') }) }))).toBeTruthy()
    expect(within(rows[1] as HTMLElement).getByText(c.status.draft)).toBeTruthy()
    expect(within(rows[1] as HTMLElement).getByText(fill(p.edited, { date: formatTime('2026-10-09T10:40:00Z') }))).toBeTruthy()
    expect(within(rows[2] as HTMLElement).getByText(c.status.scheduled)).toBeTruthy()
    expect(within(rows[3] as HTMLElement).getByText(p.ai)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: fill(p.aiOpen, { path: '/about' }) }))
    await settle()
    expect(router.state.location.search).toMatchObject({ view: 'studio', page: '/about' })
  })

  it('shows a Manager every page, with no way to add one or open the studio', async () => {
    await show({ acting: manager })
    expect(screen.getByText('/about')).toBeTruthy()
    expect(screen.queryByRole('button', { name: fill(p.aiOpen, { path: '/about' }) })).toBeNull()
    expect(screen.queryByRole('button', { name: p.add })).toBeNull()
    expect(screen.getByText(messages.storefront.notice.manager)).toBeTruthy()
  })

  it('says so when there are no pages of either kind', async () => {
    content.loadContentList.mockResolvedValue({ rows: [], next: null })
    content.loadCustomPaths.mockResolvedValue([])
    await show()
    expect(screen.getByText(p.empty)).toBeTruthy()
  })

  it('shows the error with a retry that reads the list again', async () => {
    content.loadContentList.mockRejectedValueOnce(new Error('offline'))
    await show()
    expect(screen.getByText(c.error.title)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: c.error.retry }))
    await settle()
    expect(screen.getByRole('button', { name: /Questions we get asked/ })).toBeTruthy()
  })

  it('reads the next fifty on Show more', async () => {
    content.loadContentList.mockResolvedValueOnce({ rows: [row()], next: 'cursor-1' }).mockResolvedValueOnce({ rows: [lookbook], next: null })
    await show()
    fireEvent.click(screen.getByRole('button', { name: c.more }))
    await settle()
    expect(content.loadContentList).toHaveBeenLastCalledWith('page', 'cursor-1')
    expect(screen.getByRole('button', { name: /Lookbook/ })).toBeTruthy()
    expect(screen.queryByRole('button', { name: c.more })).toBeNull()
  })

  it('says Show more failed and lets it be asked again', async () => {
    content.loadContentList.mockResolvedValueOnce({ rows: [row()], next: 'cursor-1' }).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ rows: [lookbook], next: null })
    await show()
    fireEvent.click(screen.getByRole('button', { name: c.more }))
    await settle()
    expect(screen.getByRole('alert').textContent).toBe(c.moreFailed)
    fireEvent.click(screen.getByRole('button', { name: c.more }))
    await settle()
    expect(screen.getByText('Lookbook')).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
  })
})

describe('the studio’s page in the address', () => {
  it('takes a path on the shop and drops anything else, so the studio opens on the home page', () => {
    expect(storefrontSearch.parse({ view: 'studio', page: '/about' }).page).toBe('/about')
    for (const page of ['about', '/a b', '/a\\b', `/${'a'.repeat(501)}`]) expect(storefrontSearch.parse({ view: 'studio', page }).page).toBeUndefined()
  })
})

describe('the page editor', () => {
  it('publishes a new page at the address its title makes, then goes back to the list', async () => {
    await show()
    fireEvent.click(screen.getByRole('button', { name: p.add }))
    await settle()
    expect(screen.getByRole('group', { name: fill(e.blockText, { kind: e.kinds.heading, number: '1' }) })).toBeTruthy()
    fireEvent.change(screen.getByRole('textbox', { name: e.title }), { target: { value: 'Caring for linen' } })
    expect(slugInput().placeholder).toBe('caring-for-linen')
    expect(screen.getByText('kesari.shops.example.com/caring-for-linen')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: e.publish }))
    await settle()
    expect(content.saveContent).toHaveBeenCalledWith('page', null, null, {
      title: 'Caring for linen',
      slug: 'caring-for-linen',
      body: [
        { kind: 'heading', text: '' },
        { kind: 'text', text: '' },
      ],
      seoTitle: null,
      seoDescription: null,
      publish: true,
      inMenu: false,
    })
    expect(screen.getByText(e.published)).toBeTruthy()
    expect(screen.getByRole('heading', { name: p.title })).toBeTruthy()
  })

  it('asks for a title before saving', async () => {
    await show({ entry: 'new' })
    fireEvent.click(screen.getByRole('button', { name: e.draft }))
    await settle()
    expect(screen.getByText(e.needsTitle)).toBeTruthy()
    expect(content.saveContent).not.toHaveBeenCalled()
  })

  it('updates a page at the revision it read, keeping the blocks it doesn’t change', async () => {
    await show({ entry: faq.id })
    fireEvent.change(screen.getByRole('textbox', { name: fill(e.blockText, { kind: e.kinds.heading, number: '1' }) }), { target: { value: 'Your questions' } })
    fireEvent.click(screen.getByRole('button', { name: fill(e.moveUp, { number: '2' }) }))
    fireEvent.click(screen.getByRole('button', { name: e.tools.text }))
    fireEvent.click(screen.getByRole('button', { name: e.update }))
    await settle()
    expect(content.saveContent).toHaveBeenCalledWith('page', faq.id, 3, {
      title: 'Questions we get asked',
      slug: 'faq',
      body: [
        { kind: 'faq', items: [{ question: 'Delivery?', answer: '3–5 days.' }] },
        { kind: 'heading', text: 'Your questions' },
        { kind: 'products', productIds: ['p1', 'p2'] },
        { kind: 'text', text: '' },
      ],
      seoTitle: null,
      seoDescription: 'Delivery and returns.',
      publish: true,
      inMenu: true,
    })
  })

  it('edits questions and products, naming a product no longer in the catalogue', async () => {
    products.loadProducts.mockResolvedValue({ rows: [{ id: 'p3', name: 'Linen scarf' }] })
    await show({ entry: faq.id })
    expect(offers.loadProductNames).toHaveBeenCalledWith(['p1', 'p2'])
    expect(screen.getByText('Indigo kurta')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: fill(e.removeProduct, { name: e.goneProduct }) }))
    fireEvent.change(screen.getByRole('searchbox', { name: e.findProduct }), { target: { value: 'linen' } })
    await act(async () => new Promise((resolve) => setTimeout(resolve, 350)))
    fireEvent.click(screen.getByRole('button', { name: /Linen scarf/ }))
    fireEvent.click(screen.getByRole('button', { name: e.addQuestion }))
    fireEvent.change(screen.getByRole('textbox', { name: fill(e.question, { number: '2' }) }), { target: { value: 'Gift wrap?' } })
    fireEvent.change(screen.getByRole('textbox', { name: fill(e.answer, { number: '2' }) }), { target: { value: 'Yes.' } })
    fireEvent.click(screen.getByRole('button', { name: fill(e.removeQuestion, { number: '1' }) }))
    fireEvent.click(screen.getByRole('button', { name: e.update }))
    await settle()
    expect(content.saveContent.mock.calls[0]?.[3]).toMatchObject({
      body: [{ kind: 'heading' }, { kind: 'faq', items: [{ question: 'Gift wrap?', answer: 'Yes.' }] }, { kind: 'products', productIds: ['p1', 'p3'] }],
    })
  })

  it('adds a photo block from an upload, with its description', async () => {
    upload.uploadPhoto.mockResolvedValue({ ok: true, assetId: '33333333-3333-4333-8333-333333333333' })
    await show({ entry: 'new' })
    await act(async () => {
      fireEvent.change(screen.getByLabelText(e.tools.image), { target: { files: [new File(['x'], 'photo.png', { type: 'image/png' })] } })
    })
    await settle()
    fireEvent.change(screen.getByRole('textbox', { name: fill(e.photoAlt, { number: '3' }) }), { target: { value: 'Printers at work' } })
    fireEvent.change(screen.getByRole('textbox', { name: e.title }), { target: { value: 'About' } })
    fireEvent.click(screen.getByRole('button', { name: e.draft }))
    await settle()
    expect(content.saveContent.mock.calls[0]?.[3]).toMatchObject({ publish: false, body: [{ kind: 'heading' }, { kind: 'text' }, { kind: 'image', assetId: '33333333-3333-4333-8333-333333333333', alt: 'Printers at work' }] })
  })

  it('keeps edits made while a photo uploads', async () => {
    let finish: (value: { ok: true; assetId: string }) => void = () => undefined
    upload.uploadPhoto.mockReturnValue(new Promise((resolve) => (finish = resolve)))
    await show({ entry: 'new' })
    await act(async () => {
      fireEvent.change(screen.getByLabelText(e.tools.image), { target: { files: [new File(['x'], 'photo.png', { type: 'image/png' })] } })
    })
    fireEvent.change(screen.getByRole('textbox', { name: fill(e.blockText, { kind: e.kinds.heading, number: '1' }) }), { target: { value: 'Our story' } })
    fireEvent.click(screen.getByRole('button', { name: fill(e.remove, { number: '2' }) }))
    expect((screen.getByRole('button', { name: e.tools.text }) as HTMLButtonElement).disabled).toBe(true)
    await act(async () => finish({ ok: true, assetId: '33333333-3333-4333-8333-333333333333' }))
    expect((screen.getByRole('button', { name: e.tools.text }) as HTMLButtonElement).disabled).toBe(false)
    fireEvent.change(screen.getByRole('textbox', { name: e.title }), { target: { value: 'About' } })
    fireEvent.click(screen.getByRole('button', { name: e.draft }))
    await settle()
    expect(content.saveContent.mock.calls[0]?.[3]).toMatchObject({ body: [{ kind: 'heading', text: 'Our story' }, { kind: 'image', assetId: '33333333-3333-4333-8333-333333333333' }] })
  })

  it('names a product while its name loads', async () => {
    offers.loadProductNames.mockReturnValue(new Promise(() => undefined))
    await show({ entry: faq.id })
    expect(screen.getAllByText(e.loadingProduct)).toHaveLength(2)
    expect(screen.getAllByRole('button', { name: fill(e.removeProduct, { name: e.loadingProduct }) })).toHaveLength(2)
  })

  it('says why an upload was refused and adds no block', async () => {
    upload.uploadPhoto.mockResolvedValue({ ok: false, code: 'TOO_LARGE' })
    await show({ entry: 'new' })
    await act(async () => {
      fireEvent.change(screen.getByLabelText(e.tools.image), { target: { files: [new File(['x'], 'big.png', { type: 'image/png' })] } })
    })
    await settle()
    expect(screen.getByRole('alert').textContent).toBe(messages.storefront.brand.uploadRefused.TOO_LARGE)
    expect(screen.queryByRole('group', { name: fill(e.blockText, { kind: e.kinds.image, number: '3' }) })).toBeNull()
  })

  it('adds a contact form saying where messages go', async () => {
    await show({ entry: 'new' })
    fireEvent.click(screen.getByRole('button', { name: e.tools.form }))
    expect(screen.getByText(fill(e.form, { email: 'hello@kesari.in' }))).toBeTruthy()
  })

  it('removes a block', async () => {
    await show({ entry: faq.id })
    fireEvent.click(screen.getByRole('button', { name: fill(e.remove, { number: '3' }) }))
    fireEvent.click(screen.getByRole('button', { name: e.draft }))
    await settle()
    expect(content.saveContent.mock.calls[0]?.[3]).toMatchObject({ publish: false, body: [{ kind: 'heading' }, { kind: 'faq' }] })
    expect(screen.getByText(e.savedDraft)).toBeTruthy()
  })

  it('shows a clash next to the web address, naming the AI page that holds it, and stays in the editor', async () => {
    content.saveContent.mockRejectedValue(new ApiError('PATH_TAKEN', 'taken', { path: '/about', heldBy: 'custom_page' }))
    await show({ entry: 'new' })
    fireEvent.change(screen.getByRole('textbox', { name: e.title }), { target: { value: 'About' } })
    fireEvent.click(screen.getByRole('button', { name: e.publish }))
    await settle()
    const words = fill(c.taken.custom, { path: '/about' })
    expect(describedBy(slugInput())).toBe(words)
    expect(slugInput().getAttribute('aria-invalid')).toBe('true')
    expect(screen.queryByText(e.published)).toBeNull()
    fireEvent.change(slugInput(), { target: { value: 'About Us!' } })
    expect(slugInput().value).toBe('aboutus')
    expect(screen.queryByText(words)).toBeNull()
  })

  it('names a core route and another page by its title', async () => {
    content.saveContent.mockRejectedValueOnce(new ApiError('PATH_TAKEN', 'taken', { path: '/cart', heldBy: 'core' })).mockRejectedValueOnce(new ApiError('PATH_TAKEN', 'taken', { path: '/lookbook', heldBy: 'content_page' }))
    await show()
    fireEvent.click(screen.getByRole('button', { name: p.add }))
    await settle()
    fireEvent.change(screen.getByRole('textbox', { name: e.title }), { target: { value: 'Cart' } })
    fireEvent.click(screen.getByRole('button', { name: e.publish }))
    await settle()
    expect(describedBy(slugInput())).toBe(fill(c.taken.coreLine, { path: '/cart', what: c.taken.core.cart }))
    fireEvent.change(slugInput(), { target: { value: 'lookbook' } })
    fireEvent.click(screen.getByRole('button', { name: e.publish }))
    await settle()
    expect(describedBy(slugInput())).toBe(fill(c.taken.page.named, { path: '/lookbook', title: 'Lookbook' }))
  })

  it('says someone else saved it, keeping what was typed', async () => {
    content.saveContent.mockRejectedValue(new ApiError('STALE_REVISION', 'stale', { revision: 4 }))
    await show({ entry: faq.id })
    fireEvent.change(screen.getByRole('textbox', { name: e.title }), { target: { value: 'FAQ' } })
    fireEvent.click(screen.getByRole('button', { name: e.update }))
    await settle()
    expect(screen.getByRole('alert').textContent).toBe(e.refused.STALE_REVISION)
    expect((screen.getByRole('textbox', { name: e.title }) as HTMLInputElement).value).toBe('FAQ')
  })

  it('deletes a page after restating what happens', async () => {
    await show({ entry: faq.id })
    fireEvent.click(screen.getByRole('button', { name: p.delete }))
    const dialog = screen.getByRole('dialog', { name: fill(p.deleteTitle, { title: 'Questions we get asked' }) })
    expect(within(dialog).getByText(p.deleteBodyMenu)).toBeTruthy()
    fireEvent.click(within(dialog).getByRole('button', { name: p.delete }))
    await settle()
    expect(content.deleteContent).toHaveBeenCalledWith('page', faq.id)
    expect(screen.getByText(e.deleted)).toBeTruthy()
  })

  it('is read-only for a Manager', async () => {
    await show({ acting: manager, entry: faq.id })
    expect((screen.getByRole('textbox', { name: e.title }) as HTMLInputElement).readOnly).toBe(true)
    expect(slugInput().readOnly).toBe(true)
    expect(screen.queryByRole('button', { name: e.update })).toBeNull()
    expect(screen.queryByRole('button', { name: p.delete })).toBeNull()
    expect(screen.queryByRole('group', { name: e.toolsLabel })).toBeNull()
  })

  it('shows a reader the list for a new page', async () => {
    await show({ acting: manager, entry: 'new' })
    expect(screen.getByRole('heading', { name: p.title })).toBeTruthy()
    expect(screen.queryByRole('textbox', { name: e.title })).toBeNull()
  })

  it('shows the page’s error with a retry that reads it again', async () => {
    content.loadContentEntry.mockRejectedValueOnce(new Error('offline'))
    await show({ entry: faq.id })
    expect(screen.getByText(c.error.title)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: c.error.retry }))
    await settle()
    expect((screen.getByRole('textbox', { name: e.title }) as HTMLInputElement).value).toBe('Questions we get asked')
  })

  it('shows an address the API finds invalid next to it', async () => {
    content.saveContent.mockRejectedValue(new ApiError('INVALID_INPUT', 'bad', { field: 'slug' }))
    await show({ entry: faq.id })
    fireEvent.click(screen.getByRole('button', { name: e.update }))
    await settle()
    expect(describedBy(slugInput())).toBe(e.needsSlug)
  })

  it('holds a save while the search words are too long', async () => {
    await show({ entry: faq.id })
    fireEvent.change(screen.getByRole('textbox', { name: e.seoTitle }), { target: { value: 'x'.repeat(61) } })
    fireEvent.click(screen.getByRole('button', { name: e.update }))
    await settle()
    expect(screen.getByText(e.seoTooLong)).toBeTruthy()
    expect(content.saveContent).not.toHaveBeenCalled()
  })

  it('says a page that is gone is gone', async () => {
    content.loadContentEntry.mockResolvedValue(null)
    await show({ entry: faq.id })
    expect(screen.getByText(p.notFound)).toBeTruthy()
  })
})

describe('the Journal', () => {
  it('lists posts by their date with who wrote them, and no AI pages', async () => {
    content.loadContentList.mockResolvedValue({ rows: [postRow({ id: '55555555-5555-4555-8555-555555555555', title: 'A Jaipur wedding', path: '/blog/jaipur-wedding', status: 'scheduled', publishAt: '2099-11-02T00:00:00.000Z', author: 'Farhan Ali' }), postRow()], next: null })
    await show({ tab: 'journal' })
    expect(screen.getByRole('heading', { name: j.title })).toBeTruthy()
    expect(content.loadContentList).toHaveBeenCalledWith('post', null)
    expect(content.loadCustomPaths).not.toHaveBeenCalled()
    expect(screen.getByText(fill(j.byline, { when: fill(j.goesLive, { date: formatTime('2099-11-02T00:00:00.000Z') }), author: 'Farhan Ali' }))).toBeTruthy()
    expect(screen.getByText(fill(j.byline, { when: formatTime('2026-09-14T09:00:00.000Z'), author: 'Priya Shah' }))).toBeTruthy()
    expect(screen.getByText(c.status.scheduled)).toBeTruthy()
    expect(screen.queryByText(p.ai)).toBeNull()
  })

  it('says so when there are no posts', async () => {
    content.loadContentList.mockResolvedValue({ rows: [], next: null })
    await show({ tab: 'journal' })
    expect(screen.getByText(j.empty)).toBeTruthy()
  })

  it('schedules a new post for a later day, with its author and cover', async () => {
    upload.uploadPhoto.mockResolvedValue({ ok: true, assetId: '66666666-6666-4666-8666-666666666666' })
    await show({ tab: 'journal' })
    fireEvent.click(screen.getByRole('button', { name: j.add }))
    await settle()
    expect(screen.queryByRole('button', { name: e.tools.form })).toBeNull()
    expect(screen.queryByRole('checkbox', { name: e.inMenu })).toBeNull()
    fireEvent.change(screen.getByRole('textbox', { name: e.title }), { target: { value: 'A capsule for fall' } })
    expect(screen.getByText('kesari.shops.example.com/blog/')).toBeTruthy()
    fireEvent.change(screen.getByLabelText(e.publishOn), { target: { value: '2099-11-02' } })
    fireEvent.change(screen.getByRole('textbox', { name: e.author }), { target: { value: 'Farhan Ali' } })
    await act(async () => {
      fireEvent.change(screen.getByLabelText(e.addCover), { target: { files: [new File(['x'], 'cover.png', { type: 'image/png' })] } })
    })
    await settle()
    expect(screen.getByRole('button', { name: e.removeCover })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: e.schedule }))
    await settle()
    expect(content.saveContent).toHaveBeenCalledWith('post', null, null, {
      title: 'A capsule for fall',
      slug: 'a-capsule-for-fall',
      body: [{ kind: 'text', text: '' }],
      seoTitle: null,
      seoDescription: null,
      publish: true,
      publishAt: '2099-11-02T00:00:00.000Z',
      author: 'Farhan Ali',
      tags: [],
      coverAssetId: '66666666-6666-4666-8666-666666666666',
    })
    expect(screen.getByText(fill(e.scheduled, { date: formatDay('2099-11-02') }))).toBeTruthy()
  })

  it('keeps a post’s own date and tags when it’s updated, and dates a new one only when it’s published', async () => {
    content.loadContentEntry.mockResolvedValue(linen)
    await show({ tab: 'journal', entry: linen.id })
    expect((screen.getByLabelText(e.publishOn) as HTMLInputElement).value).toBe('2026-09-14')
    fireEvent.click(screen.getByRole('button', { name: e.update }))
    await settle()
    expect(content.saveContent.mock.calls[0]?.[3]).toMatchObject({ publishAt: '2026-09-14T09:00:00.000Z', tags: ['care'], author: 'Priya Shah' })
    cleanup()
    content.saveContent.mockClear()
    await show({ tab: 'journal', entry: 'new' })
    fireEvent.change(screen.getByRole('textbox', { name: e.title }), { target: { value: 'Notes' } })
    fireEvent.click(screen.getByRole('button', { name: e.publish }))
    await settle()
    expect(content.saveContent.mock.calls[0]?.[3]).not.toHaveProperty('publishAt')
  })

  it('says the plan has no Journal when the API refuses it', async () => {
    content.saveContent.mockRejectedValue(new ApiError('PLAN_LIMIT', 'plan', { key: 'blog' }))
    await show({ tab: 'journal', entry: 'new' })
    fireEvent.change(screen.getByRole('textbox', { name: e.title }), { target: { value: 'Notes' } })
    fireEvent.click(screen.getByRole('button', { name: e.draft }))
    await settle()
    expect(screen.getByRole('alert').textContent).toBe(j.planLimit)
  })

  it('names the plan in general, not the Journal, when a page is refused for it', async () => {
    content.saveContent.mockRejectedValue(new ApiError('PLAN_LIMIT', 'plan', {}))
    await show({ entry: 'new' })
    fireEvent.change(screen.getByRole('textbox', { name: e.title }), { target: { value: 'Notes' } })
    fireEvent.click(screen.getByRole('button', { name: e.draft }))
    await settle()
    expect(screen.getByRole('alert').textContent).toBe(e.refused.PLAN_LIMIT)
  })

  it('takes the cover photo off a post', async () => {
    content.loadContentEntry.mockResolvedValue({ ...linen, coverAssetId: '66666666-6666-4666-8666-666666666666' })
    await show({ tab: 'journal', entry: linen.id })
    fireEvent.click(screen.getByRole('button', { name: e.removeCover }))
    expect(screen.getByLabelText(e.addCover)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: e.update }))
    await settle()
    expect(content.saveContent.mock.calls[0]?.[3]).toMatchObject({ coverAssetId: null })
  })

  it('is read-only for a Manager: no new post, no cover picker and no buttons', async () => {
    content.loadContentList.mockResolvedValue({ rows: [postRow()], next: null })
    await show({ acting: manager, tab: 'journal' })
    expect(screen.queryByRole('button', { name: j.add })).toBeNull()
    cleanup()
    content.loadContentEntry.mockResolvedValue(linen)
    await show({ acting: manager, tab: 'journal', entry: linen.id })
    expect((screen.getByLabelText(e.publishOn) as HTMLInputElement).readOnly).toBe(true)
    expect((screen.getByRole('textbox', { name: e.author }) as HTMLInputElement).readOnly).toBe(true)
    expect(screen.getByText(e.noCover)).toBeTruthy()
    expect(screen.queryByLabelText(e.addCover)).toBeNull()
    for (const name of [e.schedule, e.update, e.publish, e.draft, j.delete]) expect(screen.queryByRole('button', { name })).toBeNull()
  })

  it('deletes a post after restating what happens', async () => {
    content.loadContentEntry.mockResolvedValue(linen)
    await show({ tab: 'journal', entry: linen.id })
    fireEvent.click(screen.getByRole('button', { name: j.delete }))
    const dialog = screen.getByRole('dialog', { name: fill(j.deleteTitle, { title: 'Caring for linen' }) })
    expect(within(dialog).getByText(j.deleteBody)).toBeTruthy()
    fireEvent.click(within(dialog).getByRole('button', { name: j.delete }))
    await settle()
    expect(content.deleteContent).toHaveBeenCalledWith('post', linen.id)
  })
})
