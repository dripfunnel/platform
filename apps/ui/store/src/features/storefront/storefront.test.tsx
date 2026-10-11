// @vitest-environment happy-dom
import { ApiError } from '@dripfunnel/shared/graphql'
import { optionalParam } from '@dripfunnel/shared/search'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { createMemoryHistory, createRootRoute, createRoute, createRouter, Outlet, RouterProvider } from '@tanstack/react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import type { Acting } from '../../api/shell'
import type { StorefrontBrand, StorefrontSeo } from '../../api/storefront'
import { fill, messages } from '../../messages'
import { storefrontTabs } from './storefrontAccess'

// Storefront driven by each seat (FIRST-RELEASE §14): the brand step, the tabs, and Site settings › Brand.

const words = messages.storefront
const b = words.brand
const [warm = ''] = b.voices

const api = vi.hoisted(() => ({ loadBrand: vi.fn(), saveBrand: vi.fn(), loadSeo: vi.fn(), saveSeo: vi.fn() }))
vi.mock('../../api/storefront', async (actual) => ({ ...(await actual<typeof import('../../api/storefront')>()), ...api }))
const upload = vi.hoisted(() => ({ uploadPhoto: vi.fn() }))
vi.mock('../../api/productEditor', () => upload)

const { StorefrontPage } = await import('./StorefrontPage')

const owner: Acting = { store: { id: 's1', name: 'Kesari' }, role: 'owner', tier: null, seller: null, plan: null, permissions: ['catalog.read', 'storefront.read', 'publish', 'billing'] }
const manager: Acting = { ...owner, role: 'manager', permissions: ['catalog.read', 'storefront.read'] }
const staff: Acting = { ...owner, role: 'staff', permissions: ['catalog.read', 'orders.read'] }

const none = { instagram: null, facebook: null, x: null, youtube: null, tiktok: null, whatsapp: null }
const firstVisit: StorefrontBrand = { brandReady: false, shopName: 'Kesari Threads', logoAssetId: null, faviconAssetId: null, primaryColour: null, secondaryColour: null, tagline: null, description: null, social: none, contactEmail: 'hello@kesari.in', contactPhone: null, contactAddress: null, voice: null }
const ready: StorefrontBrand = { ...firstVisit, brandReady: true, logoAssetId: 'a-logo', tagline: 'Handloom from Jaipur' }
const seo: StorefrontSeo = { title: 'Kesari Threads', description: 'Handloom from Jaipur', shareImageAssetId: null }
const settle = () => act(async () => new Promise((resolve) => setTimeout(resolve, 0)))

const show = async ({ acting = owner, readOnly = false, tab }: { acting?: Acting; readOnly?: boolean; tab?: string } = {}) => {
  const root = createRootRoute({ component: Outlet })
  const app = createRoute({ getParentRoute: () => root, id: '_app', loader: () => ({ acting, state: { readOnly } }), component: Outlet })
  const page = createRoute({ getParentRoute: () => app, path: '/storefront', validateSearch: z.looseObject({ tab: optionalParam(z.enum(storefrontTabs)) }), component: StorefrontPage })
  const router = createRouter({ routeTree: root.addChildren([app.addChildren([page])]), history: createMemoryHistory({ initialEntries: [tab ? `/storefront?tab=${tab}` : '/storefront'] }) })
  await act(async () => {
    render(<RouterProvider router={router} />)
  })
  await settle()
  await settle()
}

const card = (title: string) => within(screen.getByRole('region', { name: title }))
const field = (name: RegExp | string) => screen.getByRole('textbox', { name }) as HTMLInputElement

beforeEach(() => {
  // The images' own reads (AssetImage): none of them is under test.
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 404 })))
  api.loadBrand.mockResolvedValue(ready)
  api.loadSeo.mockResolvedValue(seo)
  api.saveSeo.mockImplementation((input: StorefrontSeo) => Promise.resolve(input))
  api.saveBrand.mockImplementation((input: StorefrontBrand) => Promise.resolve({ ...input, brandReady: true }))
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.resetAllMocks()
})

describe('storefront', () => {
  it('is not for Staff: they are told so and nothing is read', async () => {
    await show({ acting: staff })
    expect(screen.getByRole('heading', { name: words.denied.title })).toBeTruthy()
    expect(api.loadBrand).not.toHaveBeenCalled()
  })

  it('shows the error with a retry that reads it again', async () => {
    api.loadBrand.mockRejectedValueOnce(new Error('offline'))
    await show()
    expect(screen.getByText(words.error.title)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: words.error.retry }))
    await settle()
    expect(screen.getByRole('heading', { name: words.design.nextTitle })).toBeTruthy()
  })

  it('has four tabs in the ARIA pattern: one tab stop, arrows, Home and End', async () => {
    await show()
    const tabs = screen.getAllByRole('tab')
    expect(tabs.map((t) => t.textContent)).toEqual([words.tabs.design, words.tabs.pages, words.tabs.journal, words.tabs.settings])
    expect(tabs.filter((t) => t.tabIndex === 0)).toHaveLength(1)
    expect(screen.getByRole('tabpanel').getAttribute('aria-labelledby')).toBe(tabs[0]?.id)
    fireEvent.keyDown(tabs[0] as HTMLElement, { key: 'ArrowRight' })
    await settle()
    expect(screen.getByRole('tab', { name: words.tabs.pages }).getAttribute('aria-selected')).toBe('true')
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: words.tabs.pages }))
    expect(screen.getByRole('heading', { name: words.pages.title })).toBeTruthy()
    fireEvent.keyDown(screen.getByRole('tab', { name: words.tabs.pages }), { key: 'End' })
    await settle()
    expect(screen.getByRole('tab', { name: words.tabs.settings }).getAttribute('aria-selected')).toBe('true')
    fireEvent.keyDown(screen.getByRole('tab', { name: words.tabs.settings }), { key: 'ArrowRight' })
    await settle()
    expect(screen.getByRole('tab', { name: words.tabs.design }).getAttribute('aria-selected')).toBe('true')
    fireEvent.keyDown(screen.getByRole('tab', { name: words.tabs.design }), { key: 'ArrowLeft' })
    await settle()
    expect(screen.getByRole('tab', { name: words.tabs.settings }).getAttribute('aria-selected')).toBe('true')
    fireEvent.keyDown(screen.getByRole('tab', { name: words.tabs.settings }), { key: 'Home' })
    await settle()
    expect(screen.getByRole('tab', { name: words.tabs.design }).getAttribute('aria-selected')).toBe('true')
  })

  it('shows Journal as an empty state until its screens are built', async () => {
    await show({ tab: 'journal' })
    expect(screen.getByRole('heading', { name: words.journal.title })).toBeTruthy()
  })
})

describe('the brand step', () => {
  it('comes first for the Owner, and waits for the name and the logo', async () => {
    api.loadBrand.mockResolvedValue(firstVisit)
    upload.uploadPhoto.mockResolvedValue({ ok: true, assetId: 'a-new-logo' })
    await show({ tab: 'settings' })
    expect(screen.getByRole('heading', { level: 1, name: b.title })).toBeTruthy()
    expect(screen.queryByRole('tab')).toBeNull()
    const go = screen.getByRole('button', { name: b.continue }) as HTMLButtonElement
    expect(go.disabled).toBe(true)
    expect(screen.getByText(b.needed)).toBeTruthy()
    fireEvent.change(field(/Shop name/), { target: { value: '  ' } })
    fireEvent.change(screen.getByLabelText(b.logo), { target: { files: [new File(['x'], 'logo.png', { type: 'image/png' })] } })
    await settle()
    expect(go.disabled).toBe(true)
    fireEvent.change(field(/Shop name/), { target: { value: 'Kesari Threads' } })
    expect(go.disabled).toBe(false)
    fireEvent.change(field(b.homeTitle), { target: { value: 'Kesari Threads — handloom' } })
    fireEvent.change(field(b.social.instagram), { target: { value: '@kesari' } })
    fireEvent.click(screen.getByRole('button', { name: warm }))
    fireEvent.click(go)
    await settle()
    expect(api.saveSeo).toHaveBeenCalledWith({ title: 'Kesari Threads — handloom', description: 'Handloom from Jaipur', shareImageAssetId: null })
    expect(api.saveBrand).toHaveBeenCalledWith(expect.objectContaining({ shopName: 'Kesari Threads', logoAssetId: 'a-new-logo', voice: warm, social: expect.objectContaining({ instagram: '@kesari' }), contactEmail: 'hello@kesari.in' }))
    expect(screen.getByRole('heading', { name: words.design.nextTitle })).toBeTruthy()
    expect(screen.getByRole('tab', { name: words.tabs.design }).getAttribute('aria-selected')).toBe('true')
  })

  it('shows a refusal at the field it names, and keeps the step', async () => {
    api.loadBrand.mockResolvedValue({ ...firstVisit, logoAssetId: 'a-logo' })
    api.saveBrand.mockRejectedValueOnce(new ApiError('INVALID_INPUT', 'Something here isn’t valid.', { field: 'social.instagram' }))
    await show()
    fireEvent.change(field(b.social.instagram), { target: { value: 'https://example.com/me' } })
    fireEvent.click(screen.getByRole('button', { name: b.continue }))
    await settle()
    const instagram = field(b.social.instagram)
    expect(instagram.getAttribute('aria-invalid')).toBe('true')
    expect(screen.getByText(fill(b.invalid.social, { network: b.social.instagram }))).toBeTruthy()
    expect(screen.getAllByRole('alert')).toHaveLength(1)
    expect(screen.getByRole('heading', { level: 1, name: b.title })).toBeTruthy()

    api.saveBrand.mockRejectedValueOnce(new ApiError('INVALID_EMAIL', 'That doesn’t look like an email address.'))
    fireEvent.click(screen.getByRole('button', { name: b.continue }))
    await settle()
    expect(field(b.email).getAttribute('aria-invalid')).toBe('true')
    expect(field(b.social.instagram).getAttribute('aria-invalid')).toBeNull()
    expect(screen.getAllByRole('alert')).toHaveLength(1)
  })

  it('says why an upload was refused, at the logo', async () => {
    api.loadBrand.mockResolvedValue(firstVisit)
    upload.uploadPhoto.mockResolvedValue({ ok: false, code: 'UNSUPPORTED_TYPE' })
    await show()
    fireEvent.change(screen.getByLabelText(b.logo), { target: { files: [new File(['x'], 'logo.gif', { type: 'image/gif' })] } })
    await settle()
    expect(screen.getByRole('alert').textContent).toBe(b.uploadRefused.UNSUPPORTED_TYPE)
    expect((screen.getByRole('button', { name: b.continue }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('isn’t the Manager’s: they see the tabs read-only, with the notice', async () => {
    api.loadBrand.mockResolvedValue(firstVisit)
    await show({ acting: manager, tab: 'settings' })
    expect(screen.queryByRole('heading', { name: b.title })).toBeNull()
    expect(screen.getByText(words.notice.manager)).toBeTruthy()
    expect(field(/Shop name/).readOnly).toBe(true)
    expect(screen.queryByRole('button', { name: b.card.save })).toBeNull()
    expect(screen.queryByLabelText(b.logo)).toBeNull()
    fireEvent.click(screen.getByRole('tab', { name: words.tabs.design }))
    await settle()
    expect(screen.getByRole('heading', { name: words.design.noSiteTitle })).toBeTruthy()
  })

  it('isn’t shown while the store is past due: everything is view-only', async () => {
    api.loadBrand.mockResolvedValue(firstVisit)
    await show({ readOnly: true, tab: 'settings' })
    expect(screen.queryByRole('heading', { name: b.title })).toBeNull()
    expect(screen.getByText(words.notice.readOnly)).toBeTruthy()
    expect(field(b.tagline).readOnly).toBe(true)
    expect(screen.queryByLabelText(b.logo)).toBeNull()
  })
})

describe('site settings › brand', () => {
  it('saves the section, with Save and Cancel only once something changed', async () => {
    await show({ tab: 'settings' })
    const brand = card(b.card.title)
    expect(brand.queryByRole('button', { name: b.card.save })).toBeNull()
    fireEvent.change(brand.getByRole('textbox', { name: /Tagline/ }), { target: { value: 'Block print' } })
    fireEvent.click(brand.getByRole('button', { name: b.card.cancel }))
    expect((brand.getByRole('textbox', { name: /Tagline/ }) as HTMLInputElement).value).toBe('Handloom from Jaipur')
    fireEvent.change(brand.getByRole('textbox', { name: /Tagline/ }), { target: { value: 'Block print' } })
    fireEvent.click(brand.getByRole('button', { name: b.card.save }))
    await settle()
    expect(api.saveBrand).toHaveBeenCalledWith(expect.objectContaining({ tagline: 'Block print', logoAssetId: 'a-logo' }))
    expect(screen.getByText(b.card.saved)).toBeTruthy()
  })
})
