// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { createMemoryHistory, createRootRoute, createRoute, createRouter, Outlet, RouterProvider } from '@tanstack/react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ContentRow } from '../../api/content'
import type { Acting } from '../../api/shell'
import type { StorefrontBrand, StorefrontOverview } from '../../api/storefront'
import { fill, formatTime, messages } from '../../messages'
import { storefrontSearch } from './storefrontSearch'

// Storefront › Pages driven by each seat (StorefrontContent; FIRST-RELEASE §14): the content pages and the AI's.

const c = messages.storefront.content
const p = c.pages

const api = vi.hoisted(() => ({ loadBrand: vi.fn(), loadSeo: vi.fn(), loadDomains: vi.fn(), loadOverview: vi.fn(), loadTemplates: vi.fn(), loadPoweredBy: vi.fn(), loadMeters: vi.fn() }))
vi.mock('../../api/storefront', async (actual) => ({ ...(await actual<typeof import('../../api/storefront')>()), ...api }))
const content = vi.hoisted(() => ({ loadContentList: vi.fn(), loadCustomPaths: vi.fn() }))
vi.mock('../../api/content', async (actual) => ({ ...(await actual<typeof import('../../api/content')>()), ...content }))

const { StorefrontPage } = await import('./StorefrontPage')

const owner: Acting = { store: { id: 's1', name: 'Kesari' }, role: 'owner', tier: null, seller: null, plan: null, permissions: ['catalog.read', 'storefront.read', 'publish'] }
const manager: Acting = { ...owner, role: 'manager', permissions: ['catalog.read', 'storefront.read'] }

const brand: StorefrontBrand = { brandReady: true, shopName: 'Kesari Threads', logoAssetId: 'a-logo', faviconAssetId: null, primaryColour: null, secondaryColour: null, tagline: null, description: null, social: { instagram: null, facebook: null, x: null, youtube: null, tiktok: null, whatsapp: null }, contactEmail: 'hello@kesari.in', contactPhone: null, contactAddress: null, voice: null }
const overview: StorefrontOverview = { status: 'same_as_live', template: 'linen', live: { number: 12, publishedAt: '2026-10-09T10:40:00Z', template: 'linen', portalOrigin: null }, draft: null, lastPublish: null }

const row = (over: Partial<ContentRow> = {}): ContentRow => ({ id: '11111111-1111-4111-8111-111111111111', title: 'Questions we get asked', path: '/faq', status: 'published', inMenu: true, publishAt: null, author: null, waitingForPublish: false, updatedAt: '2026-10-09T10:40:00Z', ...over })
const lookbook = row({ id: '22222222-2222-4222-8222-222222222222', title: 'Lookbook', path: '/lookbook', status: 'draft', inMenu: false })

const settle = () => act(async () => new Promise((resolve) => setTimeout(resolve, 0)))

const show = async ({ acting = owner }: { acting?: Acting } = {}) => {
  const root = createRootRoute({ component: Outlet })
  const app = createRoute({ getParentRoute: () => root, id: '_app', loader: () => ({ acting, state: { readOnly: false } }), component: Outlet })
  const page = createRoute({ getParentRoute: () => app, path: '/storefront', validateSearch: storefrontSearch, component: StorefrontPage })
  const router = createRouter({ routeTree: root.addChildren([app.addChildren([page])]), history: createMemoryHistory({ initialEntries: ['/storefront?tab=pages'] }) })
  await act(async () => {
    render(<RouterProvider router={router} />)
  })
  await settle()
  await settle()
  return router
}

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

  it('shows a Manager every page, with no way to open the studio', async () => {
    await show({ acting: manager })
    expect(screen.getByText('/about')).toBeTruthy()
    expect(screen.queryByRole('button', { name: fill(p.aiOpen, { path: '/about' }) })).toBeNull()
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
    expect(screen.getByText('Questions we get asked')).toBeTruthy()
  })

  it('reads the next fifty on Show more', async () => {
    content.loadContentList.mockResolvedValueOnce({ rows: [row()], next: 'cursor-1' }).mockResolvedValueOnce({ rows: [lookbook], next: null })
    await show()
    fireEvent.click(screen.getByRole('button', { name: c.more }))
    await settle()
    expect(content.loadContentList).toHaveBeenLastCalledWith('page', 'cursor-1')
    expect(screen.getByText('Lookbook')).toBeTruthy()
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
