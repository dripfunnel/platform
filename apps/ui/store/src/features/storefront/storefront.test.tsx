// @vitest-environment happy-dom
import { ApiError } from '@dripfunnel/shared/graphql'
import { optionalParam } from '@dripfunnel/shared/search'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { createMemoryHistory, createRootRoute, createRoute, createRouter, Outlet, RouterProvider } from '@tanstack/react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import type { Acting } from '../../api/shell'
import type { StorefrontBrand, StorefrontDomains, StorefrontOverview, StorefrontSeo, StorefrontTemplate } from '../../api/storefront'
import { setBrand } from '../../brand/current'
import { fill, messages } from '../../messages'
import { storefrontTabs } from './storefrontAccess'

// Storefront driven by each seat (FIRST-RELEASE §14): the brand step, the gallery, the overview, the tabs, and Site settings' three cards.

const words = messages.storefront
const b = words.brand
const d = words.domains
const s = words.seo
const o = words.overview
const g = words.gallery
const [warm = ''] = b.voices

const api = vi.hoisted(() => ({ loadBrand: vi.fn(), saveBrand: vi.fn(), loadSeo: vi.fn(), saveSeo: vi.fn(), loadDomains: vi.fn(), connectDomain: vi.fn(), checkDomain: vi.fn(), makeDomainPrimary: vi.fn(), removeDomain: vi.fn(), loadShareImages: vi.fn(), loadOverview: vi.fn(), loadTemplates: vi.fn(), chooseTemplate: vi.fn(), discardDraft: vi.fn(), loadPoweredBy: vi.fn() }))
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
const free = { id: null, host: 'kesari.shops.example.com', kind: 'free' as const, checkedAt: null, records: [] }
const records = [
  { type: 'CNAME', name: 'www.kesari.in', value: 'shops.edge.example.com', found: null },
  { type: 'TXT', name: '_df-verify.www.kesari.in', value: 'df-verify=abc', found: null },
]
const onlyFree: StorefrontDomains = { customDomainAllowed: true, domains: [{ ...free, status: 'live', primary: true }] }
const waiting: StorefrontDomains = { customDomainAllowed: true, domains: [{ ...free, status: 'live', primary: true }, { id: 'd1', host: 'www.kesari.in', kind: 'custom', status: 'waiting', primary: false, checkedAt: null, records }] }
const live: StorefrontDomains = { customDomainAllowed: true, domains: [{ ...free, status: 'live', primary: true }, { id: 'd1', host: 'www.kesari.in', kind: 'custom', status: 'live', primary: false, checkedAt: null, records }] }

const live12 = { number: 12, publishedAt: '2026-10-09T10:40:00Z', template: 'linen' }
const sameAsLive: StorefrontOverview = { status: 'same_as_live', template: 'linen', live: live12, draft: null }
const withDraft: StorefrontOverview = { status: 'unpublished_changes', template: 'linen', live: live12, draft: { template: 'linen', changedAt: null, previewReady: true } }
const notStarted: StorefrontOverview = { status: 'not_started', template: null, live: null, draft: null }
const template = (key: string, name: string, current = false): StorefrontTemplate => ({ key, name, tag: 'Tag', description: `${name} look`, demoUrl: `https://${key}.demo.example.com`, current })
const templates = [template('baseline', 'Start from scratch'), template('linen', 'Linen', true), template('bloom', 'Bloom'), { ...template('market', 'Market'), demoUrl: 'http://market.demo.example.com' }]

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
  api.loadDomains.mockResolvedValue(onlyFree)
  api.loadShareImages.mockResolvedValue([])
  api.saveSeo.mockImplementation((input: StorefrontSeo) => Promise.resolve(input))
  api.saveBrand.mockImplementation((input: StorefrontBrand) => Promise.resolve({ ...input, brandReady: true }))
  api.checkDomain.mockResolvedValue(undefined)
  api.removeDomain.mockResolvedValue(undefined)
  api.makeDomainPrimary.mockResolvedValue(undefined)
  api.loadOverview.mockResolvedValue(sameAsLive)
  api.loadTemplates.mockResolvedValue(templates)
  api.loadPoweredBy.mockResolvedValue({ removed: false, removable: true })
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
    expect(screen.getByRole('region', { name: fill(o.liveLabel, { number: '12' }) })).toBeTruthy()
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
  it('comes first for the Owner, waits for the name and the logo, then opens the gallery', async () => {
    api.loadBrand.mockResolvedValue(firstVisit)
    api.loadOverview.mockResolvedValue(notStarted)
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
    expect(screen.getByRole('heading', { level: 1, name: g.first })).toBeTruthy()
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
    api.loadOverview.mockResolvedValue(notStarted)
    await show({ acting: manager, tab: 'settings' })
    expect(screen.queryByRole('heading', { name: b.title })).toBeNull()
    expect(screen.getByText(words.notice.manager)).toBeTruthy()
    expect(field(/Shop name/).readOnly).toBe(true)
    expect(screen.queryByRole('button', { name: b.card.save })).toBeNull()
    expect(screen.queryByLabelText(d.connectLabel)).toBeNull()
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
    expect(field(s.pageTitle).readOnly).toBe(true)
    expect(screen.queryByRole('button', { name: d.makePrimary })).toBeNull()
  })
})

describe('the overview', () => {
  const onPlan: Acting = { ...owner, plan: { id: 'p1', name: 'Starter' } }
  const brandWith = (poweredBy: boolean) => setBrand({ productName: 'Northstar', primaryColor: null, accentColor: null, font: null, corner: null, background: null, files: { logoLight: null, logoDark: null, mark: null, favicon: null }, supportEmail: null, supportUrl: null, helpUrl: null, poweredBy })
  afterEach(() => setBrand(null))

  it('gives the Owner the live line, View live site, Change template and the live version', async () => {
    api.loadDomains.mockResolvedValue({ ...live, domains: live.domains.map((x) => ({ ...x, primary: x.kind === 'custom' })) })
    await show()
    expect(screen.getByText(fill(o.liveLine, { host: 'www.kesari.in', number: '12', template: 'Linen' }))).toBeTruthy()
    const site = screen.getByRole('link', { name: o.viewLive })
    expect(site.getAttribute('href')).toBe('https://www.kesari.in')
    expect(site.getAttribute('target')).toBe('_blank')
    expect(site.getAttribute('rel')).toContain('noopener')
    expect(screen.getByRole('button', { name: o.changeTemplate })).toBeTruthy()
    expect(screen.getByText(fill(o.liveAt, { host: 'www.kesari.in' }))).toBeTruthy()
    expect(screen.queryByText(o.draftTitle)).toBeNull()
  })

  it('says "Not published yet" before the first publish, with nothing to view', async () => {
    api.loadOverview.mockResolvedValue({ status: 'not_published', template: 'linen', live: null, draft: { template: 'linen', changedAt: null, previewReady: false } })
    await show()
    expect(screen.getByText(o.notLive)).toBeTruthy()
    expect(screen.queryByRole('link', { name: o.viewLive })).toBeNull()
    expect(screen.getByRole('heading', { name: o.notPublishedTitle })).toBeTruthy()
  })

  it('discards unpublished changes only after asking, and reads the design again', async () => {
    api.loadOverview.mockResolvedValueOnce(withDraft).mockResolvedValue(sameAsLive)
    api.discardDraft.mockResolvedValue(undefined)
    await show()
    expect(screen.getByText(o.draftTitle)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: o.discard }))
    expect(api.discardDraft).not.toHaveBeenCalled()
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: o.discardConfirm }))
    await settle()
    expect(api.discardDraft).toHaveBeenCalledTimes(1)
    expect(screen.queryByText(o.draftTitle)).toBeNull()
    expect(screen.getByText(o.discarded)).toBeTruthy()
  })

  it('moves "Your current look" back to the live template after a discard', async () => {
    api.loadOverview.mockResolvedValueOnce({ ...withDraft, template: 'bloom', draft: { template: 'bloom', changedAt: null, previewReady: true } }).mockResolvedValue(sameAsLive)
    api.loadTemplates.mockResolvedValueOnce(templates.map((t) => ({ ...t, current: t.key === 'bloom' }))).mockResolvedValue(templates)
    api.discardDraft.mockResolvedValue(undefined)
    await show()
    fireEvent.click(screen.getByRole('button', { name: o.discard }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: o.discardConfirm }))
    await settle()
    fireEvent.click(screen.getByRole('button', { name: o.changeTemplate }))
    await settle()
    const current = screen.getByText(g.current).closest('li') as HTMLElement
    expect(within(current).getByRole('heading', { name: 'Linen' })).toBeTruthy()
  })

  it('shows a refused discard in the notice, and only there', async () => {
    api.loadOverview.mockResolvedValue(withDraft)
    api.discardDraft.mockRejectedValue(new ApiError('SUPPORT_READ_ONLY', 'No.'))
    await show()
    fireEvent.click(screen.getByRole('button', { name: o.discard }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: o.discardConfirm }))
    await settle()
    expect(screen.getAllByRole('alert').map((a) => a.textContent)).toEqual([o.refused.SUPPORT_READ_ONLY])
    fireEvent.click(screen.getByRole('button', { name: o.discard }))
    expect(screen.queryAllByRole('alert')).toHaveLength(0)
  })

  it('shows the Manager the draft notice and the live version, with nothing to change', async () => {
    api.loadOverview.mockResolvedValue(withDraft)
    await show({ acting: manager })
    expect(screen.getByText(words.notice.manager)).toBeTruthy()
    expect(screen.getByText(o.draftTitle)).toBeTruthy()
    expect(screen.queryByRole('button', { name: o.discard })).toBeNull()
    expect(screen.queryByRole('button', { name: o.changeTemplate })).toBeNull()
    expect(screen.getByRole('link', { name: o.viewLive })).toBeTruthy()
    expect(api.loadPoweredBy).not.toHaveBeenCalled()
  })

  it('shows a Manager "No storefront yet" before anything is live', async () => {
    api.loadOverview.mockResolvedValue({ status: 'not_published', template: 'linen', live: null, draft: null })
    await show({ acting: manager })
    expect(screen.getByRole('heading', { name: words.design.noSiteTitle })).toBeTruthy()
    expect(screen.queryByRole('link', { name: o.viewLive })).toBeNull()
  })

  it('is view-only while past due: no Discard, no Change template, no gallery', async () => {
    api.loadOverview.mockResolvedValue({ ...withDraft })
    await show({ readOnly: true })
    expect(screen.getByText(words.notice.readOnly)).toBeTruthy()
    expect(screen.queryByRole('button', { name: o.discard })).toBeNull()
    expect(screen.queryByRole('button', { name: o.changeTemplate })).toBeNull()
  })

  it('shows "Powered by" with Remove it on a plan that keeps it, and not on one that removes it', async () => {
    brandWith(true)
    await show({ acting: onPlan })
    expect(screen.getByText(fill(o.powered, { brand: 'Northstar', plan: 'Starter' }))).toBeTruthy()
    expect(screen.getByRole('link', { name: o.poweredRemove }).getAttribute('href')).toBe('/billing')
    cleanup()
    api.loadPoweredBy.mockResolvedValue({ removed: true, removable: true })
    await show({ acting: onPlan })
    expect(screen.queryByText(fill(o.powered, { brand: 'Northstar', plan: 'Starter' }))).toBeNull()
  })

  it('never asks for the plan when the partner shows no "Powered by"', async () => {
    brandWith(false)
    await show({ acting: onPlan })
    expect(api.loadPoweredBy).not.toHaveBeenCalled()
  })

  it('reads a site being made again until it is ready', async () => {
    api.loadOverview.mockResolvedValueOnce({ status: 'creating', template: 'linen', live: null, draft: null }).mockResolvedValue({ status: 'not_published', template: 'linen', live: null, draft: null })
    await show()
    expect(api.loadOverview.mock.calls.length).toBeGreaterThanOrEqual(2)
    expect(screen.getByRole('heading', { name: o.notPublishedTitle })).toBeTruthy()
  })

  it('shows "Setting up your storefront…" while it is made', async () => {
    api.loadOverview.mockResolvedValue({ status: 'creating', template: 'linen', live: null, draft: null })
    await show()
    expect(screen.getByRole('heading', { name: o.creatingTitle })).toBeTruthy()
    expect(screen.queryByRole('button', { name: o.changeTemplate })).toBeNull()
  })
})

describe('the template gallery', () => {
  it('comes first for the Owner and starts the site with the template picked, without asking about words', async () => {
    api.loadOverview.mockResolvedValueOnce(notStarted).mockResolvedValue({ status: 'creating', template: 'bloom', live: null, draft: null })
    api.chooseTemplate.mockResolvedValue('creating')
    await show()
    expect(screen.getByRole('heading', { level: 1, name: g.first })).toBeTruthy()
    expect(screen.queryByRole('tab')).toBeNull()
    expect(screen.queryByRole('button', { name: g.back })).toBeNull()
    expect(screen.getAllByRole('listitem')).toHaveLength(4)
    expect(screen.getByRole('button', { name: g.scratch })).toBeTruthy()
    // Only an https demo is a link.
    expect(screen.getAllByRole('link', { name: g.demo }).map((a) => a.getAttribute('href'))).toEqual(['https://baseline.demo.example.com', 'https://linen.demo.example.com', 'https://bloom.demo.example.com'])
    const bloom = screen.getAllByRole('button', { name: g.use })[1] as HTMLElement
    fireEvent.click(bloom)
    fireEvent.click(bloom)
    await settle()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(api.chooseTemplate).toHaveBeenCalledTimes(1)
    expect(api.chooseTemplate).toHaveBeenCalledWith('bloom', true)
    expect(screen.getByRole('heading', { name: o.creatingTitle })).toBeTruthy()
    expect(screen.getByText(fill(g.switched, { name: 'Bloom' }))).toBeTruthy()
  })

  it('asks to keep the words when the template changes, and marks the current look', async () => {
    api.chooseTemplate.mockResolvedValue('unpublished_changes')
    await show()
    fireEvent.click(screen.getByRole('button', { name: o.changeTemplate }))
    await settle()
    expect(screen.getByRole('heading', { level: 1, name: g.change })).toBeTruthy()
    const current = screen.getByText(g.current).closest('li') as HTMLElement
    expect(within(current).getByRole('heading', { name: 'Linen' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: g.scratch }))
    const ask = screen.getByRole('dialog')
    expect(within(ask).getByRole('heading', { name: g.keepScratchTitle })).toBeTruthy()
    fireEvent.click(within(ask).getByRole('button', { name: g.cancel }))
    expect(api.chooseTemplate).not.toHaveBeenCalled()
    fireEvent.click(screen.getAllByRole('button', { name: g.use })[1] as HTMLElement)
    expect(within(screen.getByRole('dialog')).getByRole('heading', { name: fill(g.keepTitle, { name: 'Bloom' }) })).toBeTruthy()
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: g.templateWords }))
    await settle()
    expect(api.chooseTemplate).toHaveBeenCalledWith('bloom', false)
    expect(screen.getByRole('tab', { name: words.tabs.design })).toBeTruthy()
  })

  it('keeps the words when asked to', async () => {
    api.chooseTemplate.mockResolvedValue('unpublished_changes')
    await show()
    fireEvent.click(screen.getByRole('button', { name: o.changeTemplate }))
    await settle()
    fireEvent.click(screen.getAllByRole('button', { name: g.use })[0] as HTMLElement)
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: g.keepWords }))
    await settle()
    expect(api.chooseTemplate).toHaveBeenCalledWith('linen', true)
  })

  it('says where the studio queue stands when it refuses, and stays open', async () => {
    api.chooseTemplate.mockRejectedValue(new ApiError('STUDIO_QUEUED', 'Waiting.', { place: 2 }))
    await show()
    fireEvent.click(screen.getByRole('button', { name: o.changeTemplate }))
    await settle()
    fireEvent.click(screen.getAllByRole('button', { name: g.use })[1] as HTMLElement)
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: g.keepWords }))
    await settle()
    expect(screen.getAllByRole('alert').map((a) => a.textContent)).toEqual([fill(g.refused.STUDIO_QUEUED, { place: '2' })])
    expect(screen.getByRole('heading', { level: 1, name: g.change })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: g.back }))
    await settle()
    expect(screen.getByRole('tab', { name: words.tabs.design })).toBeTruthy()
  })

  it('offers the templates again when the site couldn’t be made', async () => {
    api.loadOverview.mockResolvedValue({ status: 'create_failed', template: 'linen', live: null, draft: null })
    await show()
    expect(screen.getByRole('heading', { level: 1, name: g.first })).toBeTruthy()
    expect(screen.getByRole('alert').textContent).toBe(g.failed)
  })

  it('isn’t the Manager’s, even by its address', async () => {
    api.loadOverview.mockResolvedValue(notStarted)
    await show({ acting: manager })
    expect(screen.queryByRole('heading', { name: g.first })).toBeNull()
    expect(screen.getByRole('heading', { name: words.design.noSiteTitle })).toBeTruthy()
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

describe('site settings › domains', () => {
  it('connects a domain, and shows the refusal in its own card only', async () => {
    api.connectDomain.mockRejectedValueOnce(new ApiError('APEX_NOT_AVAILABLE', 'Use a subdomain.', { suggested: 'www.kesari.in' }))
    await show({ tab: 'settings' })
    const domains = card(d.title)
    fireEvent.click(domains.getByRole('button', { name: d.connect }))
    expect(domains.getByRole('alert').textContent).toBe(d.hostMissing)
    fireEvent.change(domains.getByLabelText(d.connectLabel), { target: { value: 'kesari.in' } })
    fireEvent.click(domains.getByRole('button', { name: d.connect }))
    await settle()
    expect(api.connectDomain).toHaveBeenCalledWith('kesari.in')
    expect(domains.getByRole('alert').textContent).toBe(fill(d.refused.APEX_NOT_AVAILABLE, { suggested: 'www.kesari.in' }))
    expect(card(s.title).queryByRole('alert')).toBeNull()
    expect(card(b.card.title).queryByRole('alert')).toBeNull()

    api.connectDomain.mockResolvedValueOnce(waiting.domains[1])
    api.loadDomains.mockResolvedValue(waiting)
    fireEvent.change(domains.getByLabelText(d.connectLabel), { target: { value: 'www.kesari.in' } })
    fireEvent.click(domains.getByRole('button', { name: d.connect }))
    await settle()
    expect(domains.queryByRole('alert')).toBeNull()
    expect(domains.getByText(fill(d.records.title, { host: 'www.kesari.in' }))).toBeTruthy()
    expect(domains.queryByLabelText(d.connectLabel)).toBeNull()
  })

  it('sends one connect however often Enter is pressed while it is on its way', async () => {
    let answer: (value: unknown) => void = () => undefined
    api.connectDomain.mockImplementationOnce(() => new Promise((resolve) => (answer = resolve)))
    await show({ tab: 'settings' })
    const input = card(d.title).getByLabelText(d.connectLabel)
    fireEvent.change(input, { target: { value: 'www.kesari.in' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(api.connectDomain).toHaveBeenCalledTimes(1)
    api.loadDomains.mockResolvedValue(waiting)
    await act(async () => answer(waiting.domains[1]))
    await settle()
    expect(card(d.title).queryByRole('alert')).toBeNull()
  })

  it('says so when a write went through but the list couldn’t be read again', async () => {
    api.connectDomain.mockResolvedValueOnce(waiting.domains[1])
    await show({ tab: 'settings' })
    api.loadDomains.mockRejectedValueOnce(new Error('offline'))
    const domains = card(d.title)
    fireEvent.change(domains.getByLabelText(d.connectLabel), { target: { value: 'www.kesari.in' } })
    fireEvent.click(domains.getByRole('button', { name: d.connect }))
    await settle()
    expect(domains.getByRole('alert').textContent).toBe(d.notRefreshed)
  })

  it('waits for DNS with the records to copy, Check now and Cancel', async () => {
    api.loadDomains.mockResolvedValue(waiting)
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    await show({ tab: 'settings' })
    const domains = card(d.title)
    expect(domains.getByText(d.status.waiting)).toBeTruthy()
    expect(domains.getByText(d.ownPending)).toBeTruthy()
    fireEvent.click(domains.getByRole('button', { name: fill(d.records.copyNamed, { type: 'CNAME' }) }))
    await settle()
    expect(writeText).toHaveBeenCalledWith('shops.edge.example.com')
    expect(screen.getByText(d.records.copied)).toBeTruthy()

    fireEvent.click(domains.getByRole('button', { name: d.check }))
    await settle()
    expect(api.checkDomain).toHaveBeenCalledWith('d1')
    expect(domains.getByText(d.notYet)).toBeTruthy()

    api.checkDomain.mockRejectedValueOnce(new ApiError('TOO_SOON', 'We just checked.'))
    fireEvent.click(domains.getByRole('button', { name: d.check }))
    await settle()
    expect(domains.getByRole('alert').textContent).toBe(d.refused.TOO_SOON)

    api.loadDomains.mockResolvedValue(onlyFree)
    fireEvent.click(domains.getByRole('button', { name: fill(d.cancelNamed, { host: 'www.kesari.in' }) }))
    await settle()
    expect(api.removeDomain).toHaveBeenCalledWith('d1')
    expect(domains.queryByText('www.kesari.in')).toBeNull()
  })

  it('shows what DNS answers when a domain failed', async () => {
    api.loadDomains.mockResolvedValue({ ...waiting, domains: [waiting.domains[0], { ...waiting.domains[1], status: 'failed', records: [{ ...records[0], found: 'other.example.net' }, records[1]] }] })
    await show({ tab: 'settings' })
    const domains = card(d.title)
    expect(domains.getByText(d.status.failed)).toBeTruthy()
    expect(domains.getByText(fill(d.records.failed, { host: 'www.kesari.in' }))).toBeTruthy()
    expect(domains.getByText(fill(d.records.found, { found: 'other.example.net' }))).toBeTruthy()
  })

  it('never cancels a broken domain, which was live, without asking', async () => {
    api.loadDomains.mockResolvedValue({ ...live, domains: [{ ...live.domains[0], primary: false }, { ...waiting.domains[1], status: 'broken', primary: true }] })
    await show({ tab: 'settings' })
    const domains = card(d.title)
    expect(domains.getByText(fill(d.records.broken, { host: 'www.kesari.in' }))).toBeTruthy()
    expect(domains.getByRole('button', { name: d.check })).toBeTruthy()
    expect(domains.queryByRole('button', { name: fill(d.cancelNamed, { host: 'www.kesari.in' }) })).toBeNull()
    fireEvent.click(domains.getByRole('button', { name: fill(d.removeNamed, { host: 'www.kesari.in' }) }))
    expect(within(document.querySelector('dialog') as HTMLElement).getByText(d.removeBody)).toBeTruthy()
    expect(api.removeDomain).not.toHaveBeenCalled()
  })

  it('makes a live domain primary, and removes one only after asking', async () => {
    api.loadDomains.mockResolvedValue(live)
    await show({ tab: 'settings' })
    const domains = card(d.title)
    expect(domains.getAllByText(d.status.live)).toHaveLength(2)
    expect(domains.queryByRole('button', { name: d.check })).toBeNull()
    fireEvent.click(domains.getByRole('button', { name: fill(d.makePrimaryNamed, { host: 'www.kesari.in' }) }))
    await settle()
    expect(api.makeDomainPrimary).toHaveBeenCalledWith('d1')
    expect(screen.getByText(fill(d.primaryDone, { host: 'www.kesari.in' }))).toBeTruthy()

    fireEvent.click(domains.getByRole('button', { name: fill(d.removeNamed, { host: 'www.kesari.in' }) }))
    const ask = within(document.querySelector('dialog') as HTMLElement)
    expect(ask.getByText(d.removeBody)).toBeTruthy()
    expect(api.removeDomain).not.toHaveBeenCalled()
    fireEvent.click(ask.getByRole('button', { name: d.removeConfirm }))
    await settle()
    expect(api.removeDomain).toHaveBeenCalledWith('d1')
  })

  it('points a plan without an own domain to the plans', async () => {
    api.loadDomains.mockResolvedValue({ ...onlyFree, customDomainAllowed: false })
    await show({ tab: 'settings' })
    const domains = card(d.title)
    expect(domains.getByText(d.planNote, { exact: false })).toBeTruthy()
    expect(domains.getByRole('link', { name: d.plans })).toBeTruthy()
    expect(domains.queryByRole('textbox')).toBeNull()
  })

  it('never lets a late answer put back a domain just removed', async () => {
    let late: (value: StorefrontDomains) => void = () => undefined
    api.loadDomains
      .mockResolvedValueOnce(waiting)
      .mockImplementationOnce(() => new Promise<StorefrontDomains>((resolve) => (late = resolve)))
      .mockResolvedValueOnce(onlyFree)
      // A list going back to waiting would be read again; that read never answers here, so only the guard keeps it out.
      .mockImplementation(() => new Promise<StorefrontDomains>(() => undefined))
    await show({ tab: 'settings' })
    const domains = card(d.title)
    fireEvent.click(domains.getByRole('button', { name: fill(d.cancelNamed, { host: 'www.kesari.in' }) }))
    await settle()
    expect(domains.queryByText('www.kesari.in')).toBeNull()
    await act(async () => late(waiting))
    await settle()
    expect(domains.queryByText('www.kesari.in')).toBeNull()
  })
})

describe('site settings › search and sharing', () => {
  it('counts each field, refuses past the limit, and saves or cancels', async () => {
    api.loadShareImages.mockResolvedValue(['p1', 'p2'])
    await show({ tab: 'settings' })
    const box = card(s.title)
    expect(box.getByText(fill(s.count, { count: '14', limit: '60' }))).toBeTruthy()
    expect(box.queryByRole('button', { name: s.save })).toBeNull()
    fireEvent.change(box.getByRole('textbox', { name: s.pageTitle }), { target: { value: 'x'.repeat(61) } })
    expect(box.getByText(fill(s.countOver, { count: '61', limit: '60' }))).toBeTruthy()
    expect((box.getByRole('button', { name: s.save }) as HTMLButtonElement).disabled).toBe(true)
    expect(box.getByText(s.tooLong)).toBeTruthy()
    fireEvent.click(box.getByRole('button', { name: s.cancel }))
    expect((box.getByRole('textbox', { name: s.pageTitle }) as HTMLInputElement).value).toBe('Kesari Threads')

    fireEvent.change(box.getByRole('textbox', { name: s.pageTitle }), { target: { value: 'Kesari Threads — handloom' } })
    fireEvent.click(box.getByRole('button', { name: fill(s.usePhoto, { number: '2' }) }))
    expect(box.getAllByText('Kesari Threads — handloom').length).toBe(2)
    fireEvent.click(box.getByRole('button', { name: s.save }))
    await settle()
    expect(api.saveSeo).toHaveBeenCalledWith({ title: 'Kesari Threads — handloom', description: 'Handloom from Jaipur', shareImageAssetId: 'p2' })
    expect(screen.getByText(s.saved)).toBeTruthy()
    expect(box.queryByRole('button', { name: s.save })).toBeNull()
  })

  it('shows a refusal in its own card', async () => {
    api.saveSeo.mockRejectedValueOnce(new ApiError('READ_ONLY', 'Read-only.'))
    await show({ tab: 'settings' })
    const box = card(s.title)
    fireEvent.change(box.getByRole('textbox', { name: s.description }), { target: { value: 'New words' } })
    fireEvent.click(box.getByRole('button', { name: s.save }))
    await settle()
    expect(box.getByRole('alert').textContent).toBe(s.refused.READ_ONLY)
    expect(card(d.title).queryByRole('alert')).toBeNull()
  })
})
