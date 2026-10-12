// @vitest-environment happy-dom
import { ApiError } from '@dripfunnel/shared/graphql'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { createMemoryHistory, createRootRoute, createRoute, createRouter, Outlet, RouterProvider } from '@tanstack/react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ContentEntry, ContentRow } from '../../api/content'
import type { Acting } from '../../api/shell'
import type { StorefrontBrand, StorefrontOverview } from '../../api/storefront'
import { fill, formatTime, messages } from '../../messages'
import { storefrontSearch } from './storefrontSearch'

// Storefront › Pages driven by each seat (StorefrontContent; FIRST-RELEASE §14): the list with the AI's pages, the editor, the clash.

const c = messages.storefront.content
const e = c.editor
const p = c.pages

const api = vi.hoisted(() => ({ loadBrand: vi.fn(), loadSeo: vi.fn(), loadDomains: vi.fn(), loadOverview: vi.fn(), loadTemplates: vi.fn(), loadPoweredBy: vi.fn(), loadMeters: vi.fn() }))
vi.mock('../../api/storefront', async (actual) => ({ ...(await actual<typeof import('../../api/storefront')>()), ...api }))
const content = vi.hoisted(() => ({ loadContentList: vi.fn(), loadCustomPaths: vi.fn(), loadContentEntry: vi.fn(), saveContent: vi.fn(), deleteContent: vi.fn() }))
vi.mock('../../api/content', async (actual) => ({ ...(await actual<typeof import('../../api/content')>()), ...content }))

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
const lookbook = row({ id: '22222222-2222-4222-8222-222222222222', title: 'Lookbook', path: '/lookbook', status: 'draft', inMenu: false })

const settle = () => act(async () => new Promise((resolve) => setTimeout(resolve, 0)))

const show = async ({ acting = owner, entry }: { acting?: Acting; entry?: string } = {}) => {
  const root = createRootRoute({ component: Outlet })
  const app = createRoute({ getParentRoute: () => root, id: '_app', loader: () => ({ acting, state: { readOnly: false } }), component: Outlet })
  const page = createRoute({ getParentRoute: () => app, path: '/storefront', validateSearch: storefrontSearch, component: StorefrontPage })
  const router = createRouter({ routeTree: root.addChildren([app.addChildren([page])]), history: createMemoryHistory({ initialEntries: [`/storefront?tab=pages${entry ? `&entry=${entry}` : ''}`] }) })
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
